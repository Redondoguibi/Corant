use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{ipc::Channel, Manager};

#[cfg(windows)]
pub(crate) mod windows;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output {
        #[serde(rename = "sessionId")]
        session_id: String,
        data: Vec<u8>,
    },
    Exit {
        #[serde(rename = "sessionId")]
        session_id: String,
        code: Option<u32>,
        error: Option<String>,
    },
}

pub(super) type Output = Arc<dyn Fn(Vec<u8>) -> bool + Send + Sync>;
pub(super) type Exit = Box<dyn FnOnce(Option<u32>, Option<String>) + Send>;

#[derive(Default)]
pub struct TerminalManager {
    inner: Mutex<State>,
    generation: Arc<AtomicU64>,
}

#[derive(Default)]
struct State {
    project: Option<PathBuf>,
    closed: bool,
    #[cfg(windows)]
    session: Option<(String, windows::Session)>,
}

pub(super) fn dimensions(cols: u16, rows: u16) -> Result<(), String> {
    if cols == 0 || rows == 0 || cols > i16::MAX as u16 || rows > i16::MAX as u16 {
        return Err("Dimensões do terminal inválidas.".into());
    }
    Ok(())
}

fn project_directory(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.contains('\0') || !Path::new(path).is_absolute() {
        return Err("O caminho do projeto deve ser absoluto.".into());
    }
    let path = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Pasta do projeto inválida: {e}"))?;
    if !path.is_dir() {
        return Err("O projeto deve ser uma pasta.".into());
    }
    Ok(path)
}

impl State {
    fn stop(&mut self) -> Result<(), String> {
        #[cfg(windows)]
        if let Some((_, mut session)) = self.session.take() {
            session.stop()?;
        }
        Ok(())
    }
}

impl TerminalManager {
    pub fn activate_project(&self, path: PathBuf) -> Result<(), String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Estado do terminal indisponível.")?;
        if state.closed {
            return Err("A janela está sendo encerrada.".into());
        }
        if state.project.as_ref() == Some(&path) {
            return Ok(());
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        state.stop()?;
        state.project = Some(path);
        Ok(())
    }

    pub fn shutdown(&self) {
        // Poisoning must not skip process cleanup during application shutdown.
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        state.closed = true;
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Err(error) = state.stop() {
            log::error!("{error}");
        }
    }

    fn start(
        &self,
        project_path: String,
        cols: u16,
        rows: u16,
        events: Channel<TerminalEvent>,
    ) -> Result<String, String> {
        dimensions(cols, rows)?;
        let project = project_directory(&project_path)?;
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Estado do terminal indisponível.")?;
        if state.closed || state.project.as_ref() != Some(&project) {
            return Err("O projeto não está ativo nesta janela.".into());
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        state.stop()?;
        #[cfg(windows)]
        {
            let session_id = generation.to_string();
            let id = session_id.clone();
            let active = Arc::clone(&self.generation);
            let output_events = events.clone();
            let output: Output = Arc::new(move |data| {
                active.load(Ordering::SeqCst) != generation
                    || output_events
                        .send(TerminalEvent::Output {
                            session_id: id.clone(),
                            data,
                        })
                        .is_ok()
            });
            let id = session_id.clone();
            let active = Arc::clone(&self.generation);
            let exit: Exit = Box::new(move |code, error| {
                if active.load(Ordering::SeqCst) == generation {
                    let _ = events.send(TerminalEvent::Exit {
                        session_id: id,
                        code,
                        error,
                    });
                }
            });
            let session = windows::Session::start(&project, cols, rows, output, exit)?;
            state.session = Some((session_id.clone(), session));
            Ok(session_id)
        }
        #[cfg(not(windows))]
        {
            let _ = (generation, events);
            Err("O terminal integrado requer Windows nesta versão.".into())
        }
    }

    fn stop(&self, session_id: &str) -> Result<(), String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Estado do terminal indisponível.")?;
        #[cfg(windows)]
        if state.session.as_ref().map(|(id, _)| id.as_str()) == Some(session_id) {
            self.generation.fetch_add(1, Ordering::SeqCst);
            state.stop()?;
        }
        Ok(())
    }

    fn input(&self, session_id: &str, data: Vec<u8>) -> Result<(), String> {
        if data.len() > 16 * 1024 {
            return Err("Envie no máximo 16 KiB por vez ao terminal.".into());
        }
        let state = self
            .inner
            .lock()
            .map_err(|_| "Estado do terminal indisponível.")?;
        #[cfg(windows)]
        if let Some((id, session)) = &state.session {
            if id == session_id {
                return session.input(data);
            }
        }
        Err("A sessão do terminal não está ativa.".into())
    }

    fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        dimensions(cols, rows)?;
        let state = self
            .inner
            .lock()
            .map_err(|_| "Estado do terminal indisponível.")?;
        #[cfg(windows)]
        if let Some((id, session)) = &state.session {
            if id == session_id {
                return session.resize(cols, rows);
            }
        }
        Err("A sessão do terminal não está ativa.".into())
    }
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

async fn command<T: Send + 'static>(
    window: tauri::WebviewWindow,
    action: impl FnOnce(&TerminalManager) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    if window.label() != "main" {
        return Err("Janela não autorizada a usar o terminal.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || action(&app.state::<TerminalManager>()))
        .await
        .map_err(|e| format!("Falha na operação do terminal: {e}"))?
}

#[tauri::command]
pub async fn terminal_start(
    window: tauri::WebviewWindow,
    project_path: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<String, String> {
    command(window, move |manager| {
        manager.start(project_path, cols, rows, on_event)
    })
    .await
}

#[tauri::command]
pub async fn terminal_input(
    window: tauri::WebviewWindow,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    command(window, move |manager| manager.input(&session_id, data)).await
}

#[tauri::command]
pub async fn terminal_resize(
    window: tauri::WebviewWindow,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    command(window, move |manager| {
        manager.resize(&session_id, cols, rows)
    })
    .await
}

#[tauri::command]
pub async fn terminal_stop(window: tauri::WebviewWindow, session_id: String) -> Result<(), String> {
    command(window, move |manager| manager.stop(&session_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_dimensions_and_paths() {
        assert!(dimensions(80, 24).is_ok());
        for (cols, rows) in [(0, 24), (80, 0), (32768, 24), (80, 65535)] {
            assert!(dimensions(cols, rows).is_err());
        }
        assert!(project_directory("").is_err());
        assert!(project_directory("relative").is_err());
        assert!(project_directory(file!()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn restart_and_project_change_reject_old_sessions() {
        let manager = TerminalManager::default();
        let first_project = std::env::temp_dir().canonicalize().unwrap();
        let second_project = std::env::current_dir().unwrap().canonicalize().unwrap();
        let events = || Channel::<TerminalEvent>::new(|_| Ok(()));
        manager.activate_project(first_project.clone()).unwrap();
        let first = manager
            .start(
                first_project.to_string_lossy().into_owned(),
                80,
                24,
                events(),
            )
            .unwrap();
        manager.activate_project(first_project.clone()).unwrap();
        assert!(manager.input(&first, b"echo SAME\r\n".to_vec()).is_ok());
        let second = manager
            .start(
                first_project.to_string_lossy().into_owned(),
                80,
                24,
                events(),
            )
            .unwrap();
        assert_ne!(first, second);
        assert!(manager.input(&first, b"ignored".to_vec()).is_err());
        manager.stop(&first).unwrap();
        assert!(manager.input(&second, b"echo ACTIVE\r\n".to_vec()).is_ok());
        manager.activate_project(second_project.clone()).unwrap();
        assert!(manager.input(&second, b"ignored".to_vec()).is_err());
        assert!(manager
            .start(
                first_project.to_string_lossy().into_owned(),
                80,
                24,
                events()
            )
            .is_err());
        let third = manager
            .start(
                second_project.to_string_lossy().into_owned(),
                80,
                24,
                events(),
            )
            .unwrap();
        manager.shutdown();
        manager.stop(&third).unwrap();
        assert!(manager
            .start(
                second_project.to_string_lossy().into_owned(),
                80,
                24,
                events()
            )
            .is_err());
    }
}
