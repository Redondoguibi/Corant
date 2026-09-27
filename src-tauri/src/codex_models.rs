use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    process::{Child, Command, Stdio},
    ptr::{null, null_mut},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use windows_sys::Win32::System::{
    JobObjects::*, Pipes::PeekNamedPipe, Threading::CREATE_NO_WINDOW,
};

// A short-lived discovery process: no threads, turns, tools or project access.
// Closing the job also terminates the native child of npm's Node launcher.
struct Discovery {
    child: Child,
    job: Option<OwnedHandle>,
}
impl Drop for Discovery {
    fn drop(&mut self) {
        self.child.stdin.take();
        self.job.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn send(child: &mut Child, value: Value) -> Result<(), String> {
    let input = child
        .stdin
        .as_mut()
        .ok_or("Entrada do Codex indisponível.")?;
    let line = format!("{value}\n");
    input
        .write_all(line.as_bytes())
        .map_err(|_| "Falha ao consultar Codex.".to_string())
}

pub(super) fn list(command: &mut Command, stop: &AtomicBool) -> Result<String, String> {
    if stop.load(Ordering::SeqCst) {
        return Err("Consulta cancelada.".into());
    }
    let handle = unsafe { CreateJobObjectW(null(), null()) };
    if handle.is_null() {
        return Err("Não foi possível preparar a consulta ao Codex.".into());
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
        return Err("Não foi possível proteger o processo de consulta.".into());
    }
    let child = command
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Não foi possível iniciar a consulta ao Codex.".to_string())?;
    let mut process = Discovery {
        child,
        job: Some(job),
    };
    if unsafe { AssignProcessToJobObject(handle, process.child.as_raw_handle()) } == 0 {
        return Err("Não foi possível proteger o processo de consulta.".into());
    }
    send(
        &mut process.child,
        json!({"id": 1, "method": "initialize", "params": {
            "clientInfo": {"name": "corant", "title": "Corant", "version": "0.1.0"}
        }}),
    )?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut pending = Vec::new();
    let mut total = 0usize;
    let mut expected_id = 1u64;
    let mut models = Vec::<Value>::new();
    loop {
        if stop.load(Ordering::SeqCst) {
            return Err("Consulta cancelada.".into());
        }
        if Instant::now() >= deadline {
            return Err("A consulta de modelos demorou demais. Tente atualizar a lista.".into());
        }
        let stdout = process
            .child
            .stdout
            .as_mut()
            .ok_or("Saída do Codex indisponível.")?;
        let mut available = 0u32;
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
            return Err(
                "O Codex encerrou a consulta. Verifique a versão do CLI e tente novamente.".into(),
            );
        }
        if available == 0 {
            std::thread::sleep(Duration::from_millis(25));
            continue;
        }
        let mut bytes = [0u8; 8192];
        let length = stdout
            .read(&mut bytes[..(available as usize).min(8192)])
            .map_err(|_| "Falha ao ler a lista de modelos.".to_string())?;
        if length == 0 {
            return Err("O Codex encerrou a consulta.".into());
        }
        total += length;
        if total > 8 * 1024 * 1024 {
            return Err("Resposta de modelos excede o limite.".into());
        }
        pending.extend_from_slice(&bytes[..length]);
        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<_> = pending.drain(..=end).collect();
            let message: Value = serde_json::from_slice(&line)
                .map_err(|_| "Resposta inválida do Codex.".to_string())?;
            if message.get("id").and_then(Value::as_u64) != Some(expected_id) {
                continue;
            }
            if message.get("error").is_some() {
                return Err(
                    "O Codex não conseguiu listar modelos. Confira o login e atualize o CLI."
                        .into(),
                );
            }
            let result = message
                .get("result")
                .ok_or("Resposta de modelos inválida.")?;
            let mut cursor = Value::Null;
            if expected_id == 1 {
                send(
                    &mut process.child,
                    json!({"method": "initialized", "params": {}}),
                )?;
            } else {
                for entry in result
                    .get("data")
                    .and_then(Value::as_array)
                    .ok_or("Lista de modelos inválida.")?
                {
                    if entry.get("hidden").and_then(Value::as_bool) == Some(true) {
                        continue;
                    }
                    let Some(model) = entry
                        .get("model")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty() && s.len() <= 160)
                    else {
                        continue;
                    };
                    if models.iter().any(|item| item["model"] == model) {
                        continue;
                    }
                    models.push(json!({"model": model,
                        "displayName": entry.get("displayName").and_then(Value::as_str).unwrap_or(model),
                        "isDefault": entry.get("isDefault").and_then(Value::as_bool).unwrap_or(false)}));
                }
                cursor = result.get("nextCursor").cloned().unwrap_or(Value::Null);
                if cursor.is_null() {
                    return serde_json::to_string(&models).map_err(|_| "Lista inválida.".into());
                }
                if !cursor.is_string() {
                    return Err("Paginação inválida do Codex.".into());
                }
            }
            expected_id += 1;
            if expected_id > 32 {
                return Err("A lista de modelos excedeu o limite de páginas.".into());
            }
            send(
                &mut process.child,
                json!({"id": expected_id, "method": "model/list",
                "params": {"limit": 100, "includeHidden": false, "cursor": cursor}}),
            )?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_handshake_pagination_and_hidden_models() {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", r#"
            $init = [Console]::ReadLine() | ConvertFrom-Json
            if ($init.method -ne 'initialize') { exit 1 }
            [Console]::WriteLine('{"id":1,"result":{}}')
            $ready = [Console]::ReadLine() | ConvertFrom-Json
            if ($ready.method -ne 'initialized') { exit 2 }
            $page = [Console]::ReadLine() | ConvertFrom-Json
            if ($page.method -ne 'model/list' -or $page.params.includeHidden) { exit 3 }
            [Console]::WriteLine('{"id":2,"result":{"data":[{"model":"visible","displayName":"Visible","isDefault":true},{"model":"secret","hidden":true}],"nextCursor":"page2"}}')
            $page = [Console]::ReadLine() | ConvertFrom-Json
            if ($page.params.cursor -ne 'page2') { exit 4 }
            [Console]::WriteLine('{"id":3,"result":{"data":[{"model":"visible"},{"model":"second"}],"nextCursor":null}}')
            Start-Sleep -Seconds 60
        "#]);
        let result = list(&mut command, &AtomicBool::new(false)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&result).unwrap(),
            json!([
                {"model":"visible","displayName":"Visible","isDefault":true},
                {"model":"second","displayName":"second","isDefault":false}
            ])
        );
    }

    #[test]
    fn cancellation_terminates_a_waiting_discovery_process() {
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let cancel = stop.clone();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            cancel.store(true, Ordering::SeqCst);
        });
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 60",
        ]);
        let started = Instant::now();
        assert!(list(&mut command, &stop).unwrap_err().contains("cancelada"));
        worker.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
