import { useEffect, useMemo, useState } from "react";
import { MonacoEditor } from "./monaco/MonacoEditor";
import {
  listProjectEntries,
  readProjectFile,
  saveProjectFile,
  type ProjectFile,
} from "../../services/projectFilesystem";

type WorkspaceProps = {
  projectName: string;
  projectPath: string;
  onBackToHome: () => void;
};

type FileContent = {
  content: string;
  language: string;
};

function getLanguage(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
      return "typescript";
    case "tsx":n      return "typescript";
    case "js":
      return "javascript";
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "html":
    case "htm":
      return "html";
    case "xml":
      return "xml";
    case "md":
    case "markdown":
      return "markdown";
    case "py":
      return "python";
    case "java":
      return "java";
    case "rs":
      return "rust";
    case "c":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
      return "cpp";
    case "h":
    case "hpp":
      return "cpp";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "ini";
    case "sql":
      return "sql";
    case "sh":
      return "shell";
    case "bat":
    case "cmd":
      return "bat";
    case "ps1":
      return "powershell";
    case "txt":
      return "plaintext";
    default:
      return "plaintext";
  }
}

function getFileIcon(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
    case "tsx":
      return "TS";
    case "js":
    case "jsx":
      return "JS";
    case "json":
      return "{}";
    case "css":
      return "#";
    case "md":
      return "M";
    case "html":
    case "htm":
      return "<>";
    case "rs":
      return "RS";
    case "py":
      return "PY";
    default:
      return "•";
  }
}

export function Workspace({ projectName, projectPath, onBackToHome }: WorkspaceProps) {
  const [entries, setEntries] = useState<ProjectFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, FileContent>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [refreshKey, setRefreshKey] = useState(0);
  const sidebarWidth = 248;

  const files = useMemo(
    () => entries.filter((entry) => entry.kind === "file"),
    [entries],
  );

  const activeFile = useMemo(
    () => files.find((file) => file.path === activeFilePath) ?? null,
    [activeFilePath, files],
  );

  const activeContent = activeFile ? fileContents[activeFile.path] : null;

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      setIsLoading(true);
      setError(null);

      try {
        const projectEntries = await listProjectEntries(projectPath);

        if (cancelled) return;

        setEntries(projectEntries);
        setActiveFilePath((currentPath) => {
          if (currentPath && projectEntries.some((entry) => entry.path === currentPath)) {
            return currentPath;
          }

          return projectEntries.find((entry) => entry.kind === "file")?.path ?? null;
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadProject();

    return () => {
      cancelled = true;
    };
  }, [projectPath, refreshKey]);

  useEffect(() => {
    if (!activeFile || fileContents[activeFile.path]) return;

    let cancelled = false;

    async function loadFile() {
      setError(null);

      try {
        const content = await readProjectFile(activeFile.path);

        if (cancelled) return;

        setFileContents((current) => ({
          ...current,
          [activeFile.path]: {
            content,
            language: getLanguage(activeFile.name),
          },
        }));
      } catch (readError) {
        if (!cancelled) {
          setError(`Não foi possível abrir ${activeFile.name}: ${readError}`);
        }
      }
    }

    void loadFile();

    return () => {
      cancelled = true;
    };
  }, [activeFile, fileContents]);

  useEffect(() => {
    if (!activeFile || !activeContent) return;

    setSaveState("saving");

    const timer = window.setTimeout(() => {
      void saveProjectFile(activeFile.path, activeContent.content)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeFile, activeContent]);

  function updateActiveFile(value: string) {
    if (!activeFile) return;

    setFileContents((current) => ({
      ...current,
      [activeFile.path]: {
        content: value,
        language: getLanguage(activeFile.name),
      },
    }));
  }

  function getEntryPadding(entry: ProjectFile) {
    const depth = entry.relativePath.split("/").length - 1;
    return { paddingLeft: `${12 + depth * 16}px` };
  }

  async function refreshProject() {
    setRefreshKey((current) => current + 1);
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-titlebar">
        <div className="workspace-brand">
          <button className="workspace-back-button" type="button" onClick={onBackToHome}>
            ‹
          </button>
          <span className="workspace-brand-name">Corant</span>
          <span className="workspace-separator">/</span>
          <span className="workspace-project-name">{projectName}</span>
        </div>

        <div className="workspace-titlebar-center">Local workspace</div>

        <div className="workspace-titlebar-actions">
          <span className={`save-indicator save-indicator-${saveState}`}>
            {saveState === "saving" && "● Salvando..."}
            {saveState === "saved" && "● Salvo"}
            {saveState === "error" && "● Erro ao salvar"}
          </span>
        </div>
      </header>

      <div className="workspace-menubar">
        <button type="button">Arquivo</button>
        <button type="button">Editar</button>
        <button type="button">Seleção</button>
        <button type="button">Exibir</button>
        <button type="button">Executar</button>
        <button type="button">Terminal</button>
        <button type="button">Ajuda</button>
      </div>

      <section className="workspace-body">
        <aside className="workspace-sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-heading">
            <span>EXPLORADOR</span>
            <div className="sidebar-heading-actions">
              <button type="button" aria-label="Atualizar projeto" onClick={refreshProject}>↻</button>
              <button type="button" aria-label="Mais ações">•••</button>
            </div>
          </div>

          <div className="project-tree">
            <div className="tree-project-name">⌄ {projectName}</div>

            {isLoading && <div className="tree-message">Carregando arquivos...</div>}

            {!isLoading && !error && entries.length === 0 && (
              <div className="tree-message">Pasta vazia</div>
            )}

            {!isLoading && !error && entries.length > 0 && (
              <div className="tree-files">
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    className={`tree-file ${entry.path === activeFilePath ? "is-active" : ""}`}
                    type="button"
                    style={getEntryPadding(entry)}
                    disabled={entry.kind === "directory"}
                    onClick={() => {
                      if (entry.kind === "file") {
                        setActiveFilePath(entry.path);
                      }
                    }}
                    title={entry.relativePath}
                  >
                    <span className="file-icon">{entry.kind === "directory" ? "▾" : getFileIcon(entry.name)}</span>
                    <span>{entry.name}</span>
                  </button>
                ))}
              </div>
            )}

            {error && <div className="tree-error">{error}</div>}
          </div>

          <div className="sidebar-footer">
            <span>{files.length} arquivos</span>
            <span>Local</span>
          </div>
        </aside>

        <div className="workspace-sidebar-resizer" aria-hidden="true" />

        <section className="workspace-editor-area">
          <div className="editor-tabs">
            {files.map((file) => (
              <button
                key={file.path}
                className={`editor-tab ${file.path === activeFilePath ? "is-active" : ""}`}
                type="button"
                onClick={() => setActiveFilePath(file.path)}
              >
                <span className="file-icon">{getFileIcon(file.name)}</span>
                <span>{file.name}</span>
                {file.path === activeFilePath && <span className="tab-dot" />}
              </button>
            ))}
          </div>

          {activeFile && activeContent ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-breadcrumbs">
                  <span>{projectName}</span>
                  <span>/</span>
                  <span>{activeFile.relativePath}</span>
                </div>
                <div className="editor-toolbar-actions">
                  <span>{activeContent.language}</span>
                  <span>UTF-8</span>
                </div>
              </div>

              <div className="monaco-host">
                <MonacoEditor
                  value={activeContent.content}
                  language={activeContent.language}
                  onChange={updateActiveFile}
                />
              </div>

              <footer className="workspace-statusbar">
                <div className="status-left">
                  <span>Local</span>
                  <span>✓</span>
                  <span>0 erros</span>
                </div>
                <div className="status-right">
                  <span>Spaces: 2</span>
                  <span>UTF-8</span>
                  <span>{activeContent.language}</span>
                </div>
              </footer>
            </>
          ) : (
            <div className="editor-empty-state">
              <strong>{error ? "Não foi possível carregar o arquivo" : "Nenhum arquivo aberto"}</strong>
              <span>
                {error ?? "Crie ou coloque um arquivo dentro desta pasta para começar a editar."}
              </span>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
