use std::path::Path;

#[tauri::command]
fn allow_project_directory(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let directory = Path::new(&path);

    if !directory.exists() {
        return Err("A pasta do projeto não existe.".to_string());
    }

    if !directory.is_dir() {
        return Err("O caminho selecionado não é uma pasta.".to_string());
    }

    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("Não foi possível validar a pasta: {error}"))?;

    app.fs_scope()
        .allow_directory(&canonical, true)
        .map_err(|error| format!("Não foi possível liberar a pasta: {error}"))?;

    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_project_directory(
    app: tauri::AppHandle,
    parent_path: String,
    project_name: String,
) -> Result<String, String> {
    let trimmed_name = project_name.trim();

    if trimmed_name.is_empty() {
        return Err("O nome do projeto não pode estar vazio.".to_string());
    }

    if trimmed_name == "." || trimmed_name == ".." {
        return Err("Nome de projeto inválido.".to_string());
    }

    if trimmed_name.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )
    }) {
        return Err("O nome do projeto contém caracteres inválidos.".to_string());
    }

    let parent = Path::new(&parent_path);

    if !parent.exists() || !parent.is_dir() {
        return Err("A pasta escolhida para o projeto não é válida.".to_string());
    }

    let project_directory = parent.join(trimmed_name);

    if project_directory.exists() {
        return Err("Já existe uma pasta com esse nome nesse local.".to_string());
    }

    std::fs::create_dir(&project_directory)
        .map_err(|error| format!("Não foi possível criar o projeto: {error}"))?;

    let canonical = project_directory
        .canonicalize()
        .map_err(|error| format!("Não foi possível validar o projeto criado: {error}"))?;

    app.fs_scope()
        .allow_directory(&canonical, true)
        .map_err(|error| format!("Não foi possível liberar o projeto: {error}"))?;

    Ok(canonical.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            allow_project_directory,
            create_project_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
