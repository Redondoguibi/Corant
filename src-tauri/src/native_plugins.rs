use serde::Deserialize;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, Manager};

#[derive(Default)]
struct Context {
    project: Option<PathBuf>,
    operation: Option<(String, Arc<AtomicBool>)>,
    authenticated: bool,
    closed: bool,
    cancelled: std::collections::VecDeque<String>,
}
#[derive(Default)]
pub struct NativePlugins(Mutex<Context>);
impl NativePlugins {
    pub fn activate(&self, project: PathBuf) {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if state.project.as_ref() != Some(&project) {
            if let Some((_, stop)) = &state.operation {
                stop.store(true, Ordering::SeqCst);
            }
        }
        state.project = Some(project);
    }
    pub fn shutdown(&self) {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        state.closed = true;
        if let Some((_, stop)) = &state.operation {
            stop.store(true, Ordering::SeqCst);
        }
    }
    fn project(&self, path: &str) -> Result<PathBuf, String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "Estado dos plugins indisponível.")?;
        let root = state.project.as_ref().ok_or("Nenhum projeto ativo.")?;
        if state.closed || Path::new(path).canonicalize().ok().as_ref() != Some(root) {
            return Err("O projeto mudou.".into());
        }
        Ok(root.clone())
    }
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Janela não autorizada.".into());
    }
    Ok(())
}
fn relative_file(root: &Path, path: &str) -> Result<PathBuf, String> {
    if path.is_empty()
        || path
            .split(['/', '\\'])
            .any(|part| part.is_empty() || part == "." || part == ".." || part.contains(':'))
        || Path::new(path).is_absolute()
    {
        return Err("Caminho relativo inválido.".into());
    }
    let file = root
        .join(path)
        .canonicalize()
        .map_err(|_| "Arquivo não encontrado.")?;
    if !file.starts_with(root) || !file.is_file() {
        return Err("Arquivo fora do projeto ou inválido.".into());
    }
    Ok(file)
}
fn limited_text(path: &Path, limit: u64) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|_| "Não foi possível ler o arquivo.")?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Falha ao ler o arquivo.")?;
    if bytes.len() as u64 > limit {
        return Err("Arquivo excede o limite de tamanho.".into());
    }
    if bytes.contains(&0) {
        return Err("Arquivo binário não pode ser incluído como texto.".into());
    }
    String::from_utf8(bytes).map_err(|_| "O arquivo não contém texto UTF-8 válido.".into())
}
#[tauri::command]
pub async fn plugin_read_text(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_path: String,
    path: String,
) -> Result<String, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.state::<NativePlugins>().project(&project_path)?;
        limited_text(&relative_file(&root, &path)?, 1024 * 1024)
    })
    .await
    .map_err(|_| "Falha ao ler arquivo.".to_string())?
}
fn export_file(root: &Path, name: &str, text: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 160
        || name != name.trim()
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || !["md", "txt", "json"].contains(&name.rsplit('.').next().unwrap_or(""))
    {
        return Err("Use um nome de arquivo .md, .txt ou .json, sem pastas.".into());
    }
    if text.len() > 8 * 1024 * 1024 {
        return Err("A exportação excede 8 MiB.".into());
    }
    let path = root.join(name);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| {
            "Não foi possível criar a exportação. Verifique se o nome já existe.".to_string()
        })?;
    if file
        .write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
        .is_err()
    {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err("Falha ao gravar exportação.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn plugin_export_text(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_path: String,
    name: String,
    text: String,
) -> Result<(), String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Serialize against project switching for the entire create-new operation.
        let state = app.state::<NativePlugins>();
        let root = state.project(&project_path)?;
        let guard = state.0.lock().map_err(|_| "Estado indisponível.")?;
        if guard.closed || guard.project.as_ref() != Some(&root) {
            return Err("O projeto mudou.".into());
        }
        export_file(&root, &name, &text)
    })
    .await
    .map_err(|_| "Falha ao exportar.".to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    provider: String,
    model: String,
    api_key: String,
    prompt: String,
}
struct Operation {
    app: tauri::AppHandle,
    id: String,
    stop: Arc<AtomicBool>,
}
impl Drop for Operation {
    fn drop(&mut self) {
        let state = self.app.state::<NativePlugins>();
        let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if state
            .operation
            .as_ref()
            .is_some_and(|(id, _)| id == &self.id)
        {
            state.operation = None;
        }
    }
}
fn begin(app: &tauri::AppHandle, project: &str, id: String) -> Result<Operation, String> {
    let state = app.state::<NativePlugins>();
    let root = state.project(project)?;
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Identificador inválido.".into());
    }
    let mut context = state.0.lock().map_err(|_| "Estado indisponível.")?;
    if context.closed || context.project.as_ref() != Some(&root) {
        return Err("O projeto mudou.".into());
    }
    if context.cancelled.contains(&id) {
        return Err("Operação cancelada.".into());
    }
    if context.operation.is_some() {
        return Err("Aguarde a operação anterior do Copilot terminar.".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    context.operation = Some((id.clone(), stop.clone()));
    Ok(Operation {
        app: app.clone(),
        id,
        stop,
    })
}
#[tauri::command]
pub fn copilot_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<NativePlugins>,
    request_id: String,
) -> Result<(), String> {
    main_window(&window)?;
    let mut state = state.0.lock().map_err(|_| "Estado indisponível.")?;
    if request_id.len() > 80 {
        return Err("Identificador inválido.".into());
    }
    state.cancelled.push_back(request_id.clone());
    if state.cancelled.len() > 256 {
        state.cancelled.pop_front();
    }
    if let Some((id, stop)) = &state.operation {
        if *id == request_id {
            stop.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}
async fn openrouter(request: &AiRequest) -> Result<String, String> {
    if request.api_key.trim().is_empty()
        || request.api_key.len() > 4096
        || request.model.trim().is_empty()
    {
        return Err("Informe a chave OpenRouter e o modelo.".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "Não foi possível iniciar a conexão.".to_string())?;
    let mut response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(request.api_key.trim())
        .json(&serde_json::json!({ "model": request.model,
            "messages": [{ "role": "user", "content": request.prompt }], "stream": false }))
        .send()
        .await
        .map_err(|_| {
            "Falha de conexão com OpenRouter. Verifique a rede e tente novamente.".to_string()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "OpenRouter retornou HTTP {}. Verifique chave, modelo e saldo da conta.",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Falha ao receber resposta.")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("Resposta excede 2 MiB.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let json: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "Resposta JSON inválida.")?;
    json.pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or("O provedor não retornou uma resposta textual.".into())
}
#[tauri::command]
pub async fn copilot_request(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_path: String,
    request_id: String,
    request: AiRequest,
) -> Result<String, String> {
    main_window(&window)?;
    if request.prompt.trim().is_empty()
        || request.prompt.len() > 100_000
        || request.model.len() > 160
        || request.prompt.contains('\0')
        || request.model.contains('\0')
    {
        return Err("Prompt vazio ou contexto muito grande.".into());
    }
    let operation = begin(&app, &project_path, request_id)?;
    match request.provider.as_str() {
        "openrouter" => {
            tokio::select! {
                result = openrouter(&request) => result,
                _ = async { while !operation.stop.load(Ordering::SeqCst) { tokio::time::sleep(Duration::from_millis(50)).await; } } => Err("Operação cancelada.".into()),
            }
        }
        "codex" => {
            if !app
                .state::<NativePlugins>()
                .0
                .lock()
                .map_err(|_| "Estado indisponível.")?
                .authenticated
            {
                return Err("Entre com Codex antes de enviar.".into());
            }
            tauri::async_runtime::spawn_blocking(move || {
                codex_run(&operation, "exec", Some(request), None)
            })
            .await
            .map_err(|_| "Falha no Codex.".to_string())?
        }
        _ => Err("Provedor desconhecido.".into()),
    }
}
#[derive(serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    model: String,
    display_name: String,
    #[serde(default)]
    is_default: bool,
}

#[tauri::command]
pub async fn copilot_models(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_path: String,
    request_id: String,
) -> Result<Vec<AiModel>, String> {
    main_window(&window)?;
    let operation = begin(&app, &project_path, request_id)?;
    if !app
        .state::<NativePlugins>()
        .0
        .lock()
        .map_err(|_| "Estado indisponível.")?
        .authenticated
    {
        return Err("Entre com Codex para consultar os modelos.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let json = codex_run(&operation, "models", None, None)?;
        serde_json::from_str(&json).map_err(|_| "Lista de modelos inválida.".into())
    })
    .await
    .map_err(|_| "Falha ao consultar modelos.".to_string())?
}

#[tauri::command]
pub async fn copilot_account(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_path: String,
    request_id: String,
    action: String,
    on_output: Channel<Vec<u8>>,
) -> Result<bool, String> {
    main_window(&window)?;
    if action == "status" {
        return Ok(app
            .state::<NativePlugins>()
            .0
            .lock()
            .map_err(|_| "Estado indisponível.")?
            .authenticated);
    }
    if action != "login" && action != "login-device" && action != "logout" {
        return Err("Ação inválida.".into());
    }
    let operation = begin(&app, &project_path, request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativePlugins>()
            .0
            .lock()
            .map_err(|_| "Estado indisponível.")?
            .authenticated = false;
        codex_run(&operation, &action, None, Some(on_output))?;
        if operation.stop.load(Ordering::SeqCst) {
            return Err("Operação cancelada.".into());
        }
        let authenticated = action == "login" || action == "login-device";
        app.state::<NativePlugins>()
            .0
            .lock()
            .map_err(|_| "Estado indisponível.")?
            .authenticated = authenticated;
        Ok(authenticated)
    })
    .await
    .map_err(|_| "Falha no login Codex.".to_string())?
}

#[cfg(not(windows))]
fn codex_run(
    _: &Operation,
    _: &str,
    _: Option<AiRequest>,
    _: Option<Channel<Vec<u8>>>,
) -> Result<String, String> {
    Err("Codex integrado disponível no Windows nesta versão.".into())
}

#[cfg(windows)]
fn codex_run(
    operation: &Operation,
    action: &str,
    request: Option<AiRequest>,
    output: Option<Channel<Vec<u8>>>,
) -> Result<String, String> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt, sync::mpsc, time::Instant};
    let paths: Vec<_> = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .filter(|p| p.is_absolute())
        .collect();
    let (executable, launcher) = codex_launcher(&paths)
        .ok_or("Codex CLI não encontrado. Instale o Codex CLI e reinicie o Corant.")?;
    let data = operation
        .app
        .path()
        .app_data_dir()
        .map_err(|_| "Pasta de dados indisponível.")?;
    let home = data.join("codex");
    let work = data.join("copilot-work");
    std::fs::create_dir_all(&home)
        .and_then(|_| std::fs::create_dir_all(&work))
        .map_err(|_| "Não foi possível preparar Codex.")?;
    let mut environment: Vec<(std::ffi::OsString, std::ffi::OsString)> = std::env::vars_os()
        .filter(|(key, _)| {
            ![
                "CODEX_HOME",
                "OPENAI_API_KEY",
                "CODEX_API_KEY",
                "CODEX_ACCESS_TOKEN",
            ]
            .iter()
            .any(|name| key.eq_ignore_ascii_case(name))
        })
        .collect();
    environment.push(("CODEX_HOME".into(), home.into_os_string()));
    environment.sort_by_key(|(key, _)| key.to_string_lossy().to_uppercase());
    let block: Vec<u16> = environment
        .iter()
        .flat_map(|(k, v)| {
            k.encode_wide()
                .chain(Some(61))
                .chain(v.encode_wide())
                .chain(Some(0))
        })
        .chain(Some(0))
        .collect();
    let mut args = vec![
        "-c".to_string(),
        "cli_auth_credentials_store=\"keyring\"".into(),
        "-c".into(),
        "forced_login_method=\"chatgpt\"".into(),
        if action == "models" {
            "app-server".into()
        } else if action == "login-device" {
            "login".into()
        } else {
            action.into()
        },
    ];
    if let Some(script) = launcher {
        args.insert(0, script.to_string_lossy().into_owned());
    }
    if action == "models" {
        args.extend(["--listen".to_string(), "stdio://".to_string()]);
        let mut command = std::process::Command::new(&executable);
        command
            .args(&args)
            .current_dir(&work)
            .env_clear()
            .envs(environment);
        return super::codex_models::list(&mut command, &operation.stop);
    }
    let result_path = work.join(format!("response-{}.txt", operation.id));
    if action == "login-device" {
        args.push("--device-auth".into());
    }
    if let Some(request) = request {
        args.extend(
            [
                "--sandbox",
                "read-only",
                "--ephemeral",
                "--skip-git-repo-check",
                "--ignore-user-config",
                "--ignore-rules",
                "--color",
                "never",
                "--output-last-message",
            ]
            .map(str::to_string),
        );
        args.push(result_path.to_string_lossy().into_owned());
        if !request.model.trim().is_empty() {
            args.extend(["--model".into(), request.model]);
        }
        args.extend(["--".into(), request.prompt]);
    }
    let arguments = args
        .iter()
        .map(|arg| quote_arg(arg))
        .collect::<Vec<_>>()
        .join(" ");
    if OsStr::new(&arguments).encode_wide().count() > 28_000 {
        return Err(
            "Contexto muito grande para Codex. Reduza o documento ou envie sem anexá-lo.".into(),
        );
    }
    let (tx, rx) = mpsc::channel();
    let stop = operation.stop.clone();
    let mut session = crate::terminal::windows::Session::with_environment(
        &work,
        240,
        40,
        &executable,
        &arguments,
        Arc::new(move |bytes| {
            if stop.load(Ordering::SeqCst) {
                return false;
            }
            if let Some(channel) = &output {
                return channel.send(bytes).is_ok();
            }
            true
        }),
        Box::new(move |code, error| {
            let _ = tx.send((code, error));
        }),
        Some(&block),
    )?;
    let deadline = Instant::now()
        + Duration::from_secs(if action == "login" || action == "login-device" {
            900
        } else {
            180
        });
    let result = loop {
        if operation.stop.load(Ordering::SeqCst) {
            break Err("Operação cancelada.".into());
        }
        if Instant::now() >= deadline {
            break Err(if action == "login" || action == "login-device" {
                "O login expirou. Clique em Entrar com Codex para iniciar uma nova tentativa; o link anterior não deve ser reutilizado.".into()
            } else {
                "O Codex excedeu o tempo limite.".into()
            });
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok((Some(0), None)) => {
                break if action == "exec" {
                    limited_text(&result_path, 2 * 1024 * 1024)
                } else {
                    Ok(String::new())
                }
            }
            Ok(_) => {
                break Err(
                    "O Codex não concluiu a operação. Verifique o login e a versão do CLI.".into(),
                )
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break Err("O processo Codex foi interrompido.".into()),
        }
    };
    let stopped = session.stop();
    let _ = std::fs::remove_file(&result_path);
    stopped?;
    result
}
// Invoke the native binary or npm's Node entry point directly, never a cmd shim.
#[cfg(windows)]
fn codex_launcher(paths: &[PathBuf]) -> Option<(PathBuf, Option<PathBuf>)> {
    let node = paths
        .iter()
        .map(|p| p.join("node.exe"))
        .find(|p| p.is_file());
    for path in paths {
        let native = path.join("codex.exe");
        if native.is_file() {
            return Some((native, None));
        }
        let script = path.join("node_modules/@openai/codex/bin/codex.js");
        if path.join("codex.cmd").is_file() && script.is_file() {
            if let Some(node) = &node {
                return Some((node.clone(), Some(script)));
            }
        }
    }
    None
}

#[cfg(windows)]
fn quote_arg(arg: &str) -> String {
    let mut quoted = String::from("\"");
    let mut slashes = 0;
    for c in arg.chars() {
        if c == '\\' {
            slashes += 1;
            continue;
        }
        quoted.extend(std::iter::repeat('\\').take(if c == '"' {
            slashes * 2 + 1
        } else {
            slashes
        }));
        quoted.push(c);
        slashes = 0;
    }
    quoted.extend(std::iter::repeat('\\').take(slashes * 2));
    quoted.push('"');
    quoted
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_never_overwrite_and_paths_stay_relative() {
        let root = std::env::temp_dir().join(format!("corant-plugins-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let name = "commands-test.json";
        let _ = std::fs::remove_file(root.join(name));
        export_file(&root, name, "original").unwrap();
        assert!(export_file(&root, name, "overwrite").is_err());
        assert_eq!(limited_text(&root.join(name), 100).unwrap(), "original");
        assert!(relative_file(&root, "../outside").is_err());
        assert!(relative_file(&root, "C:\\outside").is_err());
        assert!(export_file(&root, "../bad.txt", "bad").is_err());
        assert!(limited_text(&root.join(name), 2).is_err());
        std::fs::remove_file(root.join(name)).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn windows_arguments_quote_metacharacters_without_shell_interpretation() {
        assert_eq!(quote_arg("a\"b\\"), "\"a\\\"b\\\\\"");
        assert_eq!(quote_arg("x & y"), "\"x & y\"");
    }
}
