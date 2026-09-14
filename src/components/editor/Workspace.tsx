import { useEffect, useMemo, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { MonacoEditor } from "./monaco/MonacoEditor";
import { ExplorerNameDialog } from "./ExplorerNameDialog";
import {
  createProjectDirectory,
  createProjectFile,
  deleteProjectEntry,
  listProjectEntries,
  readProjectFile,
  renameProjectEntry,
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

type NameDialogState = {
  mode: "file" | "folder" | "rename";
  parentPath: string;
  initialName?: string;
  target?: ProjectFile;
} | null;

function getLanguage(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
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

function getParentRelativePath(relativePath: string) {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex === -1 ? "" : relativePath.slice(0, separatorIndex);
}

function getParentDirectoryPath(entry: ProjectFile, projectPath: string) {
  if (entry.kind === "directory") {
    return entry.path;
  }

  const separator = entry.path.includes("\\") ? "\\" : "/";
  return entry.path.slice(0, entry.path.lastIndexOf(separator)) || projectPath;
}

function collectDirectoryPaths(entries: ProjectFile[]) {
  return new Set(entries.filter((entry) => entry.kind === "directory").map((entry) => entry.relativePath));
}

export function Workspace({ projectName, projectPath, onBackToHome }: WorkspaceProps) {
  const [entries, setEntries] = useState<ProjectFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, FileContent>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingActivePath, setPendingActivePath] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const sidebarWidth = 248;

  const files = useMemo(
    () => entries.filter((entry) => entry.kind === "file"),
    [entries],
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedEntryPath) ?? null,
    [entries, selectedEntryPath],
  );

  const activeFile = useMemo(
    () => files.find((file) => file.path === activeFilePath) ?? null,
    [activeFilePath, files],
  );

  const activeContent = activeFile ? fileContents[activeFile.path] : null;

  const reloadProject = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const projectEntries = await listProjectEntries(projectPath);
      setEntries(projectEntries);

      const directoryPaths = collectDirectoryPaths(projectEntries);
      setExpandedDirectories((current) => {
        const next = new Set<string>();
        for (const relativePath of current) {
          if (directoryPaths.has(relativePath)) {
            next.add(relativePath);
          }
        }
        return next;
      });

      setActiveFilePath((currentPath) => {
        if (pendingActivePath && projectEntries.some((entry) => entry.path === pendingActivePath)) {
          const nextPath = pendingActivePath;
          setPendingActivePath(null);
          return nextPath;
        }

        if (currentPath && projectEntries.some((entry) => entry.path === currentPath)) {
          return currentPath;
        }

        return projectEntries.find((entry) => entry.kind === "file")?.path ?? null;
      });

      setSelectedEntryPath((currentPath) =>
        currentPath && projectEntries.some((entry) => entry.path === currentPath)
          ? currentPath
          : null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      setIsLoading(true);
      setError(null);

      try {
        const projectEntries = await listProjectEntries(projectPath);

        if (cancelled) return;

        setEntries(projectEntries);
        setExpandedDirectories(collectDirectoryPaths(projectEntries));
        setActiveFilePath((currentPath) => {
          if (pendingActivePath && projectEntries.some((entry) => entry.path === pendingActivePath)) {
            const nextPath = pendingActivePath;
            setPendingActivePath(null);
            return nextPath;
          }

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

  function toggleDirectory(entry: ProjectFile) {
    setSelectedEntryPath(entry.path);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(entry.relativePath)) {
        next.delete(entry.relativePath);
      } else {
        next.add(entry.relativePath);
      }
      return next;
    });
  }

  function isEntryVisible(entry: ProjectFile) {
    const parts = entry.relativePath.split("/");
    if (parts.length === 1) return true;

    let parentPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      parentPath = parentPath ? `${parentPath}/${parts[index]}` : parts[index];
      if (!expandedDirectories.has(parentPath)) {
        return false;
      }
    }

    return true;
  }

  function getEntryPadding(entry: ProjectFile) {
    const depth = entry.relativePath.split("/").length - 1;
    return { paddingLeft: `${12 + depth * 16}px` };
  }

  function getCreationDirectory() {
    if (!selectedEntry) return projectPath;
    return getParentDirectoryPath(selectedEntry, projectPath);
  }

  function openNameDialog(mode: "file" | "folder") {
    setError(null);
    setNameDialog({
      mode,
      parentPath: getCreationDirectory(),
    });
  }

  function openRenameDialog() {
    if (!selectedEntry) return;

    setError(null);
    setNameDialog({
      mode: "rename",
      parentPath: getParentDirectoryPath(selectedEntry, projectPath),
      initialName: selectedEntry.name,
      target: selectedEntry,
    });
  }

  async function handleNameSubmit(name: string) {
    if (!nameDialog) return;

    if (nameDialog.mode === "file") {
      const newPath = await createProjectFile(nameDialog.parentPath, name);
      setPendingActivePath(newPath);
      setSelectedEntryPath(null);
    } else if (nameDialog.mode === "folder") {
      const newPath = await createProjectDirectory(nameDialog.parentPath, name);
      const separator = newPath.includes("\\") ? "\\" : "/";
      const parentPath = nameDialog.parentPath.replace(/[\\/]$/, "");
      const relativeParent = parentPath === projectPath.replace(/[\\/]$/, "")
        ? ""
        : entries.find((entry) => entry.path === nameDialog.parentPath)?.relativePath ?? "";
      const relativePath = relativeParent ? `${relativeParent}/${name}` : name;
      setExpandedDirectories((current) => new Set(current).add(relativePath));
      setSelectedEntryPath(newPath);
      void separator;
    } else if (nameDialog.target) {
      const newPath = await renameProjectEntry(nameDialog.target.path, name);

      if (nameDialog.target.kind === "file" && activeFilePath === nameDialog.target.path) {
        setActiveFilePath(newPath);
      }

      setFileContents((current) => {
        const previousContent = current[nameDialog.target!.path];
        if (!previousContent) return current;
        const next = { ...current };
        delete next[nameDialog.target!.path];
        next[newPath] = previousContent;
        return next;
      });

      setSelectedEntryPath(newPath);
    }

    setNameDialog(null);
    setRefreshKey((current) => current + 1);
  }

  async function handleDeleteSelected() {
    if (!selectedEntry) return;

    const confirmed = await confirm(
      `Excluir ${selectedEntry.kind === "directory" ? "a pasta" : "o arquivo"} “${selectedEntry.name}”?${selectedEntry.kind === "directory" ? " Todo o conteúdo dentro dela também será excluído." : ""}`,
      {
        title: "Excluir item",
        kind: "warning",
        okLabel: "Excluir",
        cancelLabel: "Cancelar",
      },
    );

    if (!confirmed) return;

    try {
      await deleteProjectEntry(selectedEntry);
      const deletedPath = selectedEntry.path;

      if (activeFilePath === deletedPath || (selectedEntry.kind === "directory" && activeFilePath?.startsWith(`${deletedPath}${deletedPath.includes("\\") ? "\\" : "/"}`))) {
        setActiveFilePath(null);
      }

      setFileContents((current) => {
        const next = { ...current };
        const separator = deletedPath.includes("\\") ? "\\" : "/";
        for (const path of Object.keys(next)) {
          if (path === deletedPath || path.startsWith(`${deletedPath}${separator}`)) {
            delete next[path];
          }
        }
        return next;
      });

      setSelectedEntryPath(null);
      setRefreshKey((current) => current + 1);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
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
              <button type="button" aria-label="Novo arquivo" onClick={() => openNameDialog("file")}>＋</button>
              <button type="button" aria-label="Nova pasta" onClick={() => openNameDialog("folder")}>▱</button>
              <button type="button" aria-label="Atualizar projeto" onClick={() => setRefreshKey((current) => current + 1)}>↻</button>
              <button type="button" aria-label="Mais ações" onClick={openRenameDialog} disabled={!selectedEntry}>•••</button>
            </div>
          </div>

          <div className="project-tree">
            <button
              className={`tree-project-name ${selectedEntryPath === null ? "is-root-selected" : ""}`}
              type="button"
              onClick={() => setSelectedEntryPath(null)}
              title="Selecionar a raiz do projeto"
            >
              <span className="tree-chevron">⌄</span>
              <span>{projectName}</span>
            </button>

            {isLoading && <div className="tree-message">Carregando arquivos...</div>}

            {!isLoading && !error && entries.length === 0 && (
              <div className="tree-message">Pasta vazia</div>
            )}

            {!isLoading && !error && entries.length > 0 && (
              <div className="tree-files">
                {entries.filter(isEntryVisible).map((entry) => (
                  <button
                    key={entry.path}
                    className={`tree-file ${entry.path === activeFilePath ? "is-active" : ""} ${entry.path === selectedEntryPath ? "is-selected" : ""}`}
                    type="button"
                    style={getEntryPadding(entry)}
                    onClick={() => {
                      setSelectedEntryPath(entry.path);
                      if (entry.kind === "directory") {
                        toggleDirectory(entry);
                      } else {
                        setActiveFilePath(entry.path);
                      }
                    }}
                    onDoubleClick={() => {
                      if (entry.kind === "file") {
                        setActiveFilePath(entry.path);
                      }
                    }}
                    title={entry.relativePath}
                  >
                    <span className="file-icon">
                      {entry.kind === "directory"
                        ? expandedDirectories.has(entry.relativePath) ? "▾" : "›"
                        : getFileIcon(entry.name)}
                    </span>
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
                onClick={() => {
                  setSelectedEntryPath(file.path);
                  setActiveFilePath(file.path);
                }}
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

      {nameDialog && (
        <ExplorerNameDialog
          mode={nameDialog.mode}
          initialName={nameDialog.initialName}
          onClose={() => setNameDialog(null)}
          onSubmit={handleNameSubmit}
        />
      )}
    </main>
  );
}
