use super::native_plugins::{AccessMode, Operation};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::Path,
    process::{Child, Command, Stdio},
    ptr::{null, null_mut},
    sync::{atomic::Ordering, mpsc::Receiver},
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use windows_sys::Win32::System::{
    JobObjects::*, Pipes::PeekNamedPipe, Threading::CREATE_NO_WINDOW,
};

// Own the server and its complete process tree for exactly one request.
struct Server {
    child: Child,
    job: Option<OwnedHandle>,
    bytes: Vec<u8>,
    total: usize,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.child.stdin.take();
        self.job.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Server {
    fn start(command: &mut Command) -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err("Não foi possível proteger o processo Codex.".into());
        }
        let job = unsafe { OwnedHandle::from_raw_handle(handle) };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err("Não foi possível proteger o processo Codex.".into());
        }
        let child = command
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Falha ao iniciar Codex: {e}"))?;
        let server = Self {
            child,
            job: Some(job),
            bytes: Vec::new(),
            total: 0,
        };
        if unsafe { AssignProcessToJobObject(handle, server.child.as_raw_handle()) } == 0 {
            return Err("Não foi possível proteger a árvore de processos Codex.".into());
        }
        Ok(server)
    }
    fn send(&mut self, value: Value) -> Result<(), String> {
        let line = format!("{value}\n");
        self.child
            .stdin
            .as_mut()
            .ok_or("Entrada Codex encerrada.")?
            .write_all(line.as_bytes())
            .map_err(|_| "Falha ao enviar ao Codex.".into())
    }
    fn next(&mut self) -> Result<Option<Value>, String> {
        if let Some(end) = self.bytes.iter().position(|b| *b == b'\n') {
            let line: Vec<_> = self.bytes.drain(..=end).collect();
            return serde_json::from_slice(&line)
                .map(Some)
                .map_err(|_| "Protocolo Codex inválido.".into());
        }
        let stdout = self.child.stdout.as_mut().ok_or("Saída Codex encerrada.")?;
        let mut available = 0;
        if unsafe {
            PeekNamedPipe(
                stdout.as_raw_handle(),
                null_mut(),
                0,
                null_mut(),
                &mut available,
                null_mut(),
            )
        } == 0
        {
            return Err("O Codex encerrou a conexão.".into());
        }
        if available == 0 {
            return Ok(None);
        }
        let mut bytes = [0; 8192];
        let size = stdout
            .read(&mut bytes[..(available as usize).min(8192)])
            .map_err(|_| "Falha na leitura Codex.")?;
        if size == 0 {
            return Err("O Codex encerrou a conexão.".into());
        }
        self.total += size;
        if self.total > 64 * 1024 * 1024 || self.bytes.len() + size > 4 * 1024 * 1024 {
            return Err("A saída Codex excedeu o limite.".into());
        }
        self.bytes.extend_from_slice(&bytes[..size]);
        Ok(None)
    }
}

fn policy(mode: &AccessMode) -> (&'static str, &'static str, &'static str, &'static str) {
    match mode {
        AccessMode::Ask => ("read-only", "readOnly", "on-request", "user"),
        AccessMode::Auto => (
            "workspace-write",
            "workspaceWrite",
            "on-request",
            "auto_review",
        ),
        AccessMode::Full => ("danger-full-access", "dangerFullAccess", "never", "user"),
    }
}

fn validate_policy(result: &Value, mode: &AccessMode, root: &Path) -> Result<(), String> {
    let (_, sandbox, approval, reviewer) = policy(mode);
    if result["approvalPolicy"] != approval
        || result["approvalsReviewer"] != reviewer
        || result["sandbox"]["type"] != sandbox
        || result["cwd"]
            .as_str()
            .and_then(|p| Path::new(p).canonicalize().ok())
            .as_deref()
            != Some(root)
    {
        return Err("Esta versão/configuração do Codex não confirmou o modo de segurança escolhido. Atualize o CLI ou escolha outro modo.".into());
    }
    if !matches!(mode, AccessMode::Full) {
        if result["sandbox"]["networkAccess"]
            .as_bool()
            .unwrap_or(false)
        {
            return Err("Codex retornou acesso à rede incompatível com o modo escolhido.".into());
        }
        if let Some(roots) = result["sandbox"]["writableRoots"].as_array() {
            if roots.iter().any(|r| {
                r.as_str()
                    .and_then(|p| Path::new(p).canonicalize().ok())
                    .as_deref()
                    != Some(root)
            }) {
                return Err("Codex retornou pastas graváveis fora do projeto.".into());
            }
        }
    }
    Ok(())
}

struct Pending {
    wire_id: Value,
    method: String,
    params: Value,
    answer: Receiver<bool>,
    can_approve: bool,
}
fn decision(method: &str, params: &Value, approved: bool) -> Value {
    if method == "item/permissions/requestApproval" {
        json!({"permissions": if approved { params["permissions"].clone() } else { json!({}) }, "scope":"turn"})
    } else {
        json!({"decision": if approved { "accept" } else { "decline" }})
    }
}

pub(super) trait ApprovalContext {
    fn stopped(&self) -> bool;
    fn approval(&self, id: String) -> Result<Receiver<bool>, String>;
    fn clear_approval(&self, id: &str);
}
impl ApprovalContext for Operation {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
    fn approval(&self, id: String) -> Result<Receiver<bool>, String> {
        Operation::approval(self, id)
    }
    fn clear_approval(&self, id: &str) {
        Operation::clear_approval(self, id);
    }
}

pub(super) fn run(
    command: &mut Command,
    operation: &impl ApprovalContext,
    root: &Path,
    mode: &AccessMode,
    model: &str,
    prompt: &str,
    events: &Channel<Value>,
) -> Result<String, String> {
    if operation.stopped() {
        return Err("Operação cancelada.".into());
    }
    let mut server = Server::start(command)?;
    server.send(json!({"id":1,"method":"initialize","params":{
        "clientInfo":{"name":"corant","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}))?;
    let deadline = Instant::now() + Duration::from_secs(1800);
    let mut startup_deadline = Some(Instant::now() + Duration::from_secs(60));
    let mut thread = String::new();
    let mut turn = String::new();
    let mut pending = HashMap::<String, Pending>::new();
    let mut items = HashMap::<String, Value>::new();
    let mut sequence = 0;
    let mut response = String::new();
    loop {
        if operation.stopped() {
            return Err("Operação cancelada.".into());
        }
        if Instant::now() > deadline || startup_deadline.is_some_and(|d| Instant::now() > d) {
            return Err(
                "O Codex excedeu o tempo limite. Nenhuma aprovação pendente foi concedida.".into(),
            );
        }
        let answered: Vec<_> = pending
            .iter()
            .filter_map(|(id, item)| {
                item.answer
                    .try_recv()
                    .ok()
                    .map(|answer| (id.clone(), answer))
            })
            .collect();
        for (id, answer) in answered {
            if let Some(item) = pending.remove(&id) {
                operation.clear_approval(&id);
                server.send(json!({"id":item.wire_id,"result":decision(&item.method, &item.params, answer && item.can_approve)}))?;
                events
                    .send(json!({"type":"resolved","id":id}))
                    .map_err(|_| "Painel Copilot encerrado.")?;
            }
        }
        let Some(message) = server.next()? else {
            std::thread::sleep(Duration::from_millis(10));
            continue;
        };
        let method = message["method"].as_str().unwrap_or("");
        let params = &message["params"];
        if method.is_empty() {
            if let Some(error) = message.get("error") {
                return Err(format!(
                    "Codex: {}",
                    error["message"].as_str().unwrap_or("falha no protocolo")
                ));
            }
            match message["id"].as_u64() {
                Some(1) => {
                    server.send(json!({"method":"initialized","params":{}}))?;
                    let (sandbox, _, approval, reviewer) = policy(mode);
                    server.send(json!({"id":2,"method":"thread/start","params":{
                        "cwd":root,"model":if model.is_empty() { None } else { Some(model) },"ephemeral":true,
                        "sandbox":sandbox,"approvalPolicy":approval,"approvalsReviewer":reviewer,
                        "config":{"windows.sandbox":"unelevated", "sandbox_workspace_write.network_access":false,
                            "sandbox_workspace_write.writable_roots":[], "sandbox_workspace_write.exclude_tmpdir_env_var":true,
                            "sandbox_workspace_write.exclude_slash_tmp":true},
                        "developerInstructions":"Você está integrado ao Corant. Trabalhe somente no pedido do usuário. Respeite as decisões de aprovação. Não execute processos em segundo plano que devam sobreviver à tarefa. Descreva os arquivos alterados ao concluir."
                    }}))?;
                }
                Some(2) => {
                    let result = &message["result"];
                    validate_policy(result, mode, root)?;
                    thread = result["thread"]["id"]
                        .as_str()
                        .ok_or("Thread Codex inválida.")?
                        .to_owned();
                    server.send(
                        json!({"id":3,"method":"turn/start","params":{"threadId":thread,
                        "input":[{"type":"text","text":prompt,"text_elements":[]}]}}),
                    )?;
                }
                Some(3) => {
                    turn = message["result"]["turn"]["id"]
                        .as_str()
                        .ok_or("Turno Codex inválido.")?
                        .to_owned();
                    startup_deadline = None;
                }
                _ => {}
            }
            continue;
        }
        // Requests are matched to this thread; never grant an unknown server request.
        if let Some(wire_id) = message.get("id") {
            if params["threadId"] != thread || (!turn.is_empty() && params["turnId"] != turn) {
                server.send(
                    json!({"id":wire_id,"error":{"code":-32600,"message":"Inactive conversation"}}),
                )?;
                continue;
            }
            if [
                "item/commandExecution/requestApproval",
                "item/fileChange/requestApproval",
                "item/permissions/requestApproval",
            ]
            .contains(&method)
            {
                sequence += 1;
                let id = format!("approval-{sequence}");
                let preview = items.get(params["itemId"].as_str().unwrap_or(""));
                let detail = json!({"request":params,"action":preview});
                let can_approve = params
                    .get("availableDecisions")
                    .and_then(Value::as_array)
                    .map(|choices| choices.iter().any(|d| d == "accept"))
                    .unwrap_or(true);
                let answer = operation.approval(id.clone())?;
                pending.insert(
                    id.clone(),
                    Pending {
                        wire_id: wire_id.clone(),
                        method: method.to_owned(),
                        params: params.clone(),
                        answer,
                        can_approve,
                    },
                );
                events.send(json!({"type":"approval","approval":{"id":id,
                    "title":if method.contains("fileChange") { "Alterar arquivos" } else if method.contains("permissions") { "Ampliar permissões" } else { "Executar comando / acessar rede" },
                    "detail":serde_json::to_string_pretty(&detail).map_err(|_| "Prévia inválida.")?,"canApprove":can_approve}})).map_err(|_| "Painel Copilot encerrado.")?;
            } else {
                server.send(json!({"id":wire_id,"error":{"code":-32601,"message":"This interaction is not supported by Corant; do not execute it."}}))?;
            }
            continue;
        }
        if params.get("threadId").is_some() && params["threadId"] != thread {
            continue;
        }
        match method {
            "item/started" | "item/completed" => {
                let item = &params["item"];
                if let Some(id) = item["id"].as_str() {
                    if items.len() > 1000 {
                        return Err("Muitas ações em uma única solicitação.".into());
                    }
                    items.insert(id.to_owned(), item.clone());
                }
                if method == "item/completed" && item["type"] == "agentMessage" {
                    if let Some(text) = item["text"].as_str() {
                        response.push_str(text);
                        response.push_str("\n\n");
                    }
                }
            }
            "serverRequest/resolved" => {
                let ids: Vec<_> = pending
                    .iter()
                    .filter(|(_, p)| p.wire_id == params["requestId"])
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in ids {
                    pending.remove(&id);
                    operation.clear_approval(&id);
                    let _ = events.send(json!({"type":"resolved","id":id}));
                }
            }
            "item/autoApprovalReview/started" => {
                let _ = events.send(
                    json!({"type":"status","text":"Codex está revisando a segurança da ação…"}),
                );
            }
            "item/autoApprovalReview/completed" => {
                let _ = events.send(json!({"type":"status","text":format!("Revisão automática: {} — {}", params["review"]["status"].as_str().unwrap_or("concluída"), params["review"]["rationale"].as_str().unwrap_or(""))}));
            }
            "turn/completed" => {
                if params["turn"]["status"] != "completed" {
                    return Err(format!(
                        "Codex: {}",
                        params["turn"]["error"]["message"]
                            .as_str()
                            .unwrap_or("operação interrompida ou recusada")
                    ));
                }
                return Ok(if response.trim().is_empty() {
                    "Operação concluída.".into()
                } else {
                    response.trim().to_owned()
                });
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicBool, Arc, Mutex};

    struct TestApproval {
        stop: Arc<AtomicBool>,
        answer: Option<bool>,
    }
    impl ApprovalContext for TestApproval {
        fn stopped(&self) -> bool {
            self.stop.load(Ordering::SeqCst)
        }
        fn approval(&self, _: String) -> Result<Receiver<bool>, String> {
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            if let Some(answer) = self.answer {
                tx.send(answer).unwrap();
            }
            Ok(rx)
        }
        fn clear_approval(&self, _: &str) {}
    }
    fn fake_server(wrong_policy: bool) -> Command {
        let mut command = Command::new("powershell.exe");
        command.env(
            "CORANT_TEST_WRONG_POLICY",
            if wrong_policy { "yes" } else { "no" },
        );
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", r#"
            $init = [Console]::ReadLine() | ConvertFrom-Json
            if ($init.method -ne 'initialize') { exit 1 }
            [Console]::WriteLine('{"id":1,"result":{}}')
            $ready = [Console]::ReadLine() | ConvertFrom-Json
            if ($ready.method -ne 'initialized') { exit 2 }
            $start = [Console]::ReadLine() | ConvertFrom-Json
            if ($start.method -ne 'thread/start') { exit 3 }
            $reviewer = $start.params.approvalsReviewer
            if ($env:CORANT_TEST_WRONG_POLICY -eq 'yes') { $reviewer = 'unexpected' }
            $sandbox = @{ 'read-only'='readOnly'; 'workspace-write'='workspaceWrite'; 'danger-full-access'='dangerFullAccess' }[$start.params.sandbox]
            [Console]::WriteLine((@{id=2;result=@{thread=@{id='thread-test'};cwd=$start.params.cwd;approvalPolicy=$start.params.approvalPolicy;approvalsReviewer=$reviewer;sandbox=@{type=$sandbox;networkAccess=$false}}} | ConvertTo-Json -Depth 8 -Compress))
            $turn = [Console]::ReadLine() | ConvertFrom-Json
            if ($turn.method -ne 'turn/start') { exit 4 }
            [Console]::WriteLine('{"id":3,"result":{"turn":{"id":"turn-test"}}}')
            [Console]::WriteLine('{"method":"item/started","params":{"threadId":"thread-test","turnId":"turn-test","item":{"id":"file-1","type":"fileChange","changes":[{"path":"test.txt","diff":"-old\n+new"}]}}}')
            [Console]::WriteLine('{"id":"server-1","method":"item/fileChange/requestApproval","params":{"threadId":"thread-test","turnId":"turn-test","itemId":"file-1","reason":"Change requested"}}')
            $answer = [Console]::ReadLine() | ConvertFrom-Json
            if ($answer.id -ne 'server-1') { exit 5 }
            [Console]::WriteLine((@{method='item/completed';params=@{threadId='thread-test';turnId='turn-test';item=@{id='message-1';type='agentMessage';text=$answer.result.decision}}} | ConvertTo-Json -Depth 8 -Compress))
            [Console]::WriteLine('{"method":"turn/completed","params":{"threadId":"thread-test","turn":{"id":"turn-test","status":"completed"}}}')
            Start-Sleep -Seconds 60
        "#]);
        command
    }
    #[test]
    fn protocol_waits_for_exact_approval_and_preserves_denial() {
        for approved in [false, true] {
            let context = TestApproval {
                stop: Arc::new(AtomicBool::new(false)),
                answer: Some(approved),
            };
            let events = Arc::new(Mutex::new(Vec::<Value>::new()));
            let captured = events.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                    captured
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str(&text).unwrap());
                }
                Ok(())
            });
            let result = run(
                &mut fake_server(false),
                &context,
                &std::env::temp_dir().canonicalize().unwrap(),
                &AccessMode::Ask,
                "",
                "test",
                &channel,
            )
            .unwrap();
            assert_eq!(result, if approved { "accept" } else { "decline" });
            let events = events.lock().unwrap();
            assert_eq!(events[0]["type"], "approval");
            assert!(events[0]["approval"]["detail"]
                .as_str()
                .unwrap()
                .contains("test.txt"));
            assert_eq!(events[1]["type"], "resolved");
        }
    }
    #[test]
    fn protocol_rejects_policy_downgrades_before_sending_a_turn() {
        let context = TestApproval {
            stop: Arc::new(AtomicBool::new(false)),
            answer: Some(true),
        };
        let error = run(
            &mut fake_server(true),
            &context,
            &std::env::temp_dir().canonicalize().unwrap(),
            &AccessMode::Auto,
            "",
            "must not execute",
            &Channel::new(|_| Ok(())),
        )
        .unwrap_err();
        assert!(error.contains("não confirmou"));
    }
    #[test]
    fn cancellation_while_waiting_for_approval_kills_the_server() {
        let stop = Arc::new(AtomicBool::new(false));
        let cancel = stop.clone();
        let context = TestApproval { stop, answer: None };
        let channel = Channel::new(move |_| {
            cancel.store(true, Ordering::SeqCst);
            Ok(())
        });
        let started = Instant::now();
        let error = run(
            &mut fake_server(false),
            &context,
            &std::env::temp_dir().canonicalize().unwrap(),
            &AccessMode::Ask,
            "",
            "test",
            &channel,
        )
        .unwrap_err();
        assert!(error.contains("cancelada"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }
    #[test]
    fn modes_require_the_selected_native_policy() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        for mode in [AccessMode::Ask, AccessMode::Auto, AccessMode::Full] {
            let (_, sandbox, approval, reviewer) = policy(&mode);
            let mut result = json!({"cwd":root,"approvalPolicy":approval,"approvalsReviewer":reviewer,"sandbox":{"type":sandbox}});
            assert!(validate_policy(&result, &mode, &root).is_ok());
            result["approvalsReviewer"] = json!("unknown");
            assert!(validate_policy(&result, &mode, &root).is_err());
        }
        let extra = json!({"cwd":root,"approvalPolicy":"on-request","approvalsReviewer":"auto_review",
            "sandbox":{"type":"workspaceWrite","networkAccess":true}});
        assert!(validate_policy(&extra, &AccessMode::Auto, &root).is_err());
    }
    #[test]
    fn denial_does_not_grant_permissions() {
        let params = json!({"permissions":{"network":{"enabled":true}}});
        assert_eq!(
            decision("item/permissions/requestApproval", &params, false),
            json!({"permissions":{},"scope":"turn"})
        );
        assert_eq!(
            decision("item/fileChange/requestApproval", &params, false),
            json!({"decision":"decline"})
        );
        assert_eq!(
            decision("item/commandExecution/requestApproval", &params, true),
            json!({"decision":"accept"})
        );
    }
}
