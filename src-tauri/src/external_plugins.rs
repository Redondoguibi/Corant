use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Default)]
pub struct PluginCatalog(Mutex<()>);
#[derive(Serialize)]
pub struct Catalog {
    directory: String,
    plugins: Vec<CatalogEntry>,
}
#[derive(Serialize)]
pub struct CatalogEntry {
    folder: String,
    manifest: Option<Value>,
    fingerprint: Option<String>,
    error: Option<String>,
}
#[derive(Serialize)]
pub struct Package {
    manifest: Value,
    source: String,
    fingerprint: String,
}
fn err(e: impl std::fmt::Display) -> String {
    format!("Plugins: {e}")
}
fn valid_id(id: &str) -> bool {
    id.len() <= 100
        && id.contains('.')
        && !id.starts_with("corant.")
        && id.split('.').all(|part| {
            part.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}
fn plain(path: &Path, directory: bool) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(err)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Links e junctions não são permitidos nos plugins.".into());
        }
    }
    if meta.file_type().is_symlink()
        || (if directory {
            !meta.is_dir()
        } else {
            !meta.is_file()
        })
    {
        return Err("O pacote contém um caminho inválido ou link simbólico.".into());
    }
    Ok(())
}
fn read_text(path: &Path, limit: u64) -> Result<String, String> {
    plain(path, false)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(err)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > limit {
        return Err("Arquivo do plugin excede o limite de tamanho.".into());
    }
    String::from_utf8(bytes).map_err(err)
}
fn entry_path(value: &Value) -> Result<PathBuf, String> {
    let entry = value
        .get("entrypoint")
        .and_then(Value::as_str)
        .ok_or("Manifesto sem entrypoint.")?;
    if entry.len() > 200
        || !entry.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        return Err("Use um entrypoint relativo ao plugin, sem .., barras invertidas ou caminhos absolutos.".into());
    }
    let path = PathBuf::from(entry);
    if !matches!(
        path.extension().and_then(|s| s.to_str()),
        Some("js" | "mjs")
    ) {
        return Err("O entrypoint deve ser um módulo JavaScript .js ou .mjs.".into());
    }
    Ok(path)
}
fn read_package(directory: &Path) -> Result<Package, String> {
    plain(directory, true)?;
    let manifest_text = read_text(&directory.join("manifest.json"), 32 * 1024)?;
    let manifest: Value =
        serde_json::from_str(manifest_text.trim_start_matches('\u{feff}')).map_err(err)?;
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Manifesto sem id.")?;
    if !valid_id(id) {
        return Err("ID inválido ou reservado. Use autor.nome; corant.* é reservado.".into());
    }
    let entry = entry_path(&manifest)?;
    let mut path = directory.to_path_buf();
    let parts: Vec<_> = entry.components().collect();
    for (i, part) in parts.iter().enumerate() {
        path.push(part);
        plain(&path, i + 1 < parts.len())?;
    }
    let source = read_text(&path, 8 * 1024 * 1024)?;
    let mut hash = Sha256::new();
    hash.update((manifest_text.len() as u64).to_le_bytes());
    hash.update(manifest_text.as_bytes());
    hash.update(source.as_bytes());
    Ok(Package {
        manifest,
        source,
        fingerprint: format!("{:x}", hash.finalize()),
    })
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(err)?.join("plugins");
    fs::create_dir_all(&root).map_err(err)?;
    plain(&root, true)?;
    root.canonicalize().map_err(err)
}
fn plugin_dir(root: &Path, folder: &str) -> Result<PathBuf, String> {
    if !valid_id(folder) {
        return Err("Pasta de plugin inválida ou reservada.".into());
    }
    let path = root.join(folder);
    plain(&path, true)?;
    let canonical = path.canonicalize().map_err(err)?;
    if canonical.parent() != Some(root) {
        return Err("Plugin fora da pasta gerenciada.".into());
    }
    Ok(canonical)
}
fn discover(root: &Path) -> Result<Catalog, String> {
    let mut plugins = Vec::new();
    for item in fs::read_dir(root).map_err(err)? {
        let item = item.map_err(err)?;
        let folder = item.file_name().to_string_lossy().into_owned();
        if folder.starts_with('.') {
            continue;
        }
        if plugins.len() >= 128 {
            return Err("O catálogo excede 128 plugins.".into());
        }
        let package = plugin_dir(root, &folder)
            .and_then(|path| read_package(&path))
            .and_then(|p| {
                if p.manifest["id"].as_str() != Some(&folder) {
                    return Err("O nome da pasta deve ser igual ao id do manifesto.".into());
                }
                Ok(p)
            });
        plugins.push(match package {
            Ok(p) => CatalogEntry {
                folder,
                manifest: Some(p.manifest),
                fingerprint: Some(p.fingerprint),
                error: None,
            },
            Err(e) => CatalogEntry {
                folder,
                manifest: None,
                fingerprint: None,
                error: Some(e),
            },
        });
    }
    plugins.sort_by(|a, b| a.folder.cmp(&b.folder));
    Ok(Catalog {
        directory: root.to_string_lossy().into_owned(),
        plugins,
    })
}
fn install(root: &Path, source: &Path) -> Result<String, String> {
    let package = read_package(source)?;
    let id = package.manifest["id"]
        .as_str()
        .ok_or("ID ausente.")?
        .to_string();
    if root.join(&id).exists() {
        return Err(
            "Este plugin já está instalado. Remova-o antes de instalar outra versão.".into(),
        );
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    let staging = root.join(format!(".install-{}-{stamp}", std::process::id()));
    fs::create_dir(&staging).map_err(err)?;
    let result = (|| {
        let entry = entry_path(&package.manifest)?;
        let target = staging.join(&entry);
        fs::create_dir_all(target.parent().ok_or("Entry inválido.")?).map_err(err)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(err)?
            .write_all(package.source.as_bytes())
            .map_err(err)?;
        // Preserve exact manifest bytes, so the approval fingerprint remains stable.
        let manifest = read_text(&source.join("manifest.json"), 32 * 1024)?;
        fs::write(staging.join("manifest.json"), manifest).map_err(err)?;
        if read_package(&staging)?.fingerprint != package.fingerprint {
            return Err("O pacote mudou durante a instalação. Tente novamente.".into());
        }
        fs::rename(&staging, root.join(&id)).map_err(err)?;
        Ok(id.clone())
    })();
    // Staging is a newly created, fixed child of our canonical plugin root.
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}
fn remove(root: &Path, folder: &str) -> Result<(), String> {
    let path = plugin_dir(root, folder)?;
    // remove_dir_all does not follow symlinks; the root itself was checked above.
    fs::remove_dir_all(path).map_err(err)
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Janela não autorizada.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn external_plugins_list(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Catalog, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginCatalog>();
        let _guard = state.0.lock().map_err(err)?;
        discover(&root(&app)?)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn external_plugins_install(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    source: String,
) -> Result<String, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginCatalog>();
        let _guard = state.0.lock().map_err(err)?;
        install(&root(&app)?, Path::new(&source))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn external_plugins_remove(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    folder: String,
) -> Result<(), String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginCatalog>();
        let _guard = state.0.lock().map_err(err)?;
        remove(&root(&app)?, &folder)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn external_plugins_load(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    folder: String,
    fingerprint: String,
) -> Result<Package, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginCatalog>();
        let _guard = state.0.lock().map_err(err)?;
        let p = read_package(&plugin_dir(&root(&app)?, &folder)?)?;
        if p.fingerprint != fingerprint || p.manifest["id"].as_str() != Some(&folder) {
            return Err("O plugin mudou. Atualize o catálogo e autorize a nova versão.".into());
        }
        Ok(p)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "corant-plugin-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        path.canonicalize().unwrap()
    }
    fn package(root: &Path) {
        fs::write(root.join("manifest.json"),r#"{"id":"test.example","name":"Example","version":"1.0.0","apiVersion":1,"permissions":[],"entrypoint":"index.js"}"#).unwrap();
        fs::write(root.join("index.js"), "export function activate() {}").unwrap();
    }
    #[test]
    fn installation_discovery_fingerprint_and_removal() {
        let source = temp();
        package(&source);
        let root = temp();
        let before = read_package(&source).unwrap().fingerprint;
        assert_eq!(install(&root, &source).unwrap(), "test.example");
        assert!(install(&root, &source).is_err());
        let catalog = discover(&root).unwrap();
        assert_eq!(catalog.plugins.len(), 1);
        assert_eq!(catalog.plugins[0].fingerprint.as_ref(), Some(&before));
        fs::write(
            root.join("test.example/index.js"),
            "export function activate() { throw 1; }",
        )
        .unwrap();
        assert_ne!(
            read_package(&root.join("test.example"))
                .unwrap()
                .fingerprint,
            before
        );
        assert!(remove(&root, "../test.example").is_err());
        assert!(remove(&root, "corant.copilot").is_err());
        remove(&root, "test.example").unwrap();
        assert!(source.join("index.js").exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(source).unwrap();
    }
    #[test]
    fn invalid_manifests_and_paths_are_never_loaded() {
        let root = temp();
        package(&root);
        for entry in [
            "../outside.js",
            "/outside.js",
            "C:/outside.js",
            "dir\\outside.js",
            "index.ts",
        ] {
            let text = format!(
                r#"{{"id":"test.example","entrypoint":{}}}"#,
                serde_json::to_string(entry).unwrap()
            );
            fs::write(root.join("manifest.json"), text).unwrap();
            assert!(read_package(&root).is_err());
        }
        for id in ["corant.copilot", "..", "test", "TEST.plugin", "test/other"] {
            assert!(!valid_id(id));
        }
        fs::remove_dir_all(root).unwrap();
    }
}
