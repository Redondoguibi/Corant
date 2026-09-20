import { useEffect, useMemo, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { MonacoEditor } from "./monaco/MonacoEditor";
import { ExplorerNameDialog } from "./ExplorerNameDialog";
import { GlobalSearchPanel } from "./GlobalSearchPanel";
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
import {
  clearRecoverySnapshot,
  getRecoverySnapshot,
  saveRecoverySnapshot,
} from "../../services/recoveryStore";

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

type EditorSearchLocation = {
  path: string;
  lineNumber: number;
  column: number;
};

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

function getParentDirectoryPath(entry: ProjectFile, projectPath: string) {
  if (entry.kind === "directory") {
    return entry.path;
  }

  const separator = entry.path.includes("\\") ? "\\" : "/";
  return entry.path.slice(0, entry.path.lastIndexOf(separator)) || projectPath;
}

function collectDirectoryPaths(entries: ProjectFile[]) {
  return new Set(
    entries
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.relativePath),
  );
}

export function Workspace({ projectName, projectPath, onBackToHome }: WorkspaceProps) {
  const [entries, setEntries] = useState<ProjectFile[]>([]);
  const [openTabPaths, setOpenTabPaths] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, FileContent>>({});
  const [originalContents, setOriginalContents] = useState<Record<string, string>>({});
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingActivePath, setPendingActivePath] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [sidebarMode, setSidebarMode] = useState<"explorer" | "search">("explorer");
  const [editorLocation, setEditorLocation] = useState<EditorSearchLocation | null>(null);
  const sidebarWidth = 248;

  const files = useMemo(
    () => entries.filter((entry) => entry.kind === "file"),
    [entries],
  );

  const openTabs = useMemo(
    () => openTabPaths
      .map((path) => files.find((file) => file.path === path))
      .filter((file): file is ProjectFile => Boolean(file)),
    [files, openTabPaths],
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

  function markDirty(path: string) {
    setDirtyPaths((current) => {
      if (current.has(path)) return current;
      const next = new Set(current);
      next.add(path);
      return next;
    });
  }

  function markSaved(path: string, content: string) {
    setOriginalContents((current) => ({
      ...current,
      [path]: content,
    }));
    setDirtyPaths((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }

  function activateFile(
    file: ProjectFile,
    location?: { lineNumber: number; column: number },
  ) {
    setSelectedEntryPath(file.path);
    setActiveFilePath(file.path);
    setOpenTabPaths((current) =>
      current.includes(file.path) ? current : [...current, file.path],
    );
    setEditorLocation(
      location
        ? {
            path: file.path,
            lineNumber: location.lineNumber,
            column: location.column,
          }
        : null,
    );
  }

  function openFile(file: ProjectFile) {
    activateFile(file);
  }

  function openSearchEntry(entry: ProjectFile) {
    if (entry.kind === "file") {
      activateFile(entry);
      return;
    }

    setSelectedEntryPath(entry.path);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      const parts = entry.relativePath.split("/");
      let currentPath = "";

      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        next.add(currentPath);
      }

      return next;
    });
    setSidebarMode("explorer");
  }

  function openSearchMatch(file: ProjectFile, lineNumber: number, column: number) {
    activateFile(file, { lineNumber, column });
  }

  async function closeTab(path: string) {
    const isDirty = dirtyPaths.has(path);

    if (isDirty) {
      const file = files.find((entry) => entry.path === path);
      const confirmed = await confirm(
        `“${file?.name ?? "Arquivo"}” possui alterações recentes que ainda não foram confirmadas como salvas. Fechar a aba mesmo assim?`,
        {
          title: "Fechar arquivo",
          kind: "warning",
          okLabel: "Fechar mesmo assim",
          cancelLabel: "Cancelar",
        },
      );

      if (!confirmed) return;
    }

    setOpenTabPaths((current) => {
      const index = current.indexOf(path);
      const next = current.filter((item) => item !== path);

      if (activeFilePath === path) {
        const fallback = next[index] ?? next[index - 1] ?? next.at(-1) ?? null;
        setActiveFilePath(fallback);
        setSelectedEntryPath(fallback);
      }

      return next;
    });
  }

  async function closeAllDirtyTabsAndLeave() {
    if (dirtyPaths.size === 0) {
      onBackToHome();
      return;
    }

    const confirmed = await confirm(
      `Existem ${dirtyPaths.size} arquivo(s) com alterações recentes. Voltar para a tela inicial mesmo assim?`,
      {
        title: "Alterações pendentes",
        kind: "warning",
        okLabel: "Voltar mesmo assim",
        cancelLabel: "Continuar editando",
      },
    );

    if (confirmed) {
      onBackToHome();
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      setIsLoading(true);
      setError(null);

      try {
        const projectEntries = await listProjectEntries(projectPath);

        if (cancelled) return;

        setEntries(projectEntries);
        setExpandedDirectories((current) => {
          const available = collectDirectoryPaths(projectEntries);
          return new Set([...current].filter((path) => available.has(path)));
        });

        const firstFile = projectEntries.find((entry) => entry.kind === "file");
        const firstPath = pendingActivePath && projectEntries.some((entry) => entry.path === pendingActivePath)
          ? pendingActivePath
          : activeFilePath && projectEntries.some((entry) => entry.path === activeFilePath)
            ? activeFilePath
            : firstFile?.path ?? null;

        if (pendingActivePath && projectEntries.some((entry) => entry.path === pendingActivePath)) {
          setPendingActivePath(null);
        }

        setActiveFilePath(firstPath);
        setSelectedEntryPath((currentPath) =>
          currentPath && projectEntries.some((entry) => entry.path === currentPath)
            ? currentPath
            : firstPath,
        );

        if (openTabPaths.length === 0 && firstPath) {
          setOpenTabPaths([firstPath]);
        } else {
          setOpenTabPaths((current) => current.filter((path) => projectEntries.some((entry) => entry.kind === "file" && entry.path === path)));
        }
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
        const diskContent = await readProjectFile(activeFile.path);
        if (cancelled) return;

        const recovery = getRecoverySnapshot(projectPath, activeFile.path);
        let content = diskContent;
        let recovered = false;

        if (recovery && recovery.content !== diskContent) {
          const restore = await confirm(
            `O Corant encontrou uma versão recuperável de “${activeFile.name}” criada em ${new Date(recovery.updatedAt).toLocaleString()}. Deseja restaurar essa versão?`,
            {
              title: "Recuperar alterações",
              kind: "warning",
              okLabel: "Restaurar",
              cancelLabel: "Usar arquivo salvo",
            },
          );

          if (cancelled) return;

          if (restore) {
            content = recovery.content;
            recovered = true;
          } else {
            clearRecoverySnapshot(projectPath, activeFile.path);
          }
        } else if (recovery) {
          clearRecoverySnapshot(projectPath, activeFile.path);
        }

        setFileContents((current) => ({
          ...current,
          [activeFile.path]: {
            content,
            language: getLanguage(activeFile.name),
          },
        }));
        setOriginalContents((current) => ({
          ...current,
          [activeFile.path]: diskContent,
        }));
        setDirtyPaths((current) => {
          const next = new Set(current);
          if (recovered) next.add(activeFile.path);
          else next.delete(activeFile.path);
          return next;
        });
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
  }, [activeFile, fileContents, projectPath]);

  useEffect(() => {
    if (!activeFile || !activeContent) return;

    const original = originalContents[activeFile.path];
    if (original !== undefined && original === activeContent.content) {
      setDirtyPaths((current) => {
        if (!current.has(activeFile.path)) return current;
        const next = new Set(current);
        next.delete(activeFile.path);
        return next;
      });
      return;
    }

    markDirty(activeFile.path);
    setSaveState("saving");

    const timer = window.setTimeout(() => {
      void saveProjectFile(activeFile.path, activeContent.content)
        .then(() => {
          markSaved(activeFile.path, activeContent.content);
          clearRecoverySnapshot(projectPath, activeFile.path);
          setSaveState("saved");
        })
        .catch(() => {
          markDirty(activeFile.path);
          setSaveState("error");
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeFile, activeContent, originalContents, projectPath]);

  function updateActiveFile(value: string) {
    if (!activeFile) return;

    markDirty(activeFile.path);
    saveRecoverySnapshot(projectPath, activeFile.path, value);
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

    try {
      if (nameDialog.mode === "file") {
        const newPath = await createProjectFile(nameDialog.parentPath, name);
        setPendingActivePath(newPath);
      } else if (nameDialog.mode === "folder") {
        const newPath = await createProjectDirectory(nameDialog.parentPath, name);
        const parentPath = nameDialog.parentPath.replace(/[\\/]$/, "");
        const relativeParent = parentPath === projectPath.replace(/[\\/]$/, "")
          ? ""
          : entries.find((entry) => entry.path === nameDialog.parentPath)?.relativePath ?? "";
        const relativePath = relativeParent ? `${relativeParent}/${name}` : name;
        setExpandedDirectories((current) => new Set(current).add(relativePath));
        setSelectedEntryPath(newPath);
      } else if (nameDialog.target) {
        const oldPath = nameDialog.target.path;
        const newPath = await renameProjectEntry(oldPath, name);

        setFileContents((current) => {
          const previousContent = current[oldPath];
          if (!previousContent) return current;
          const next = { ...current };
          delete next[oldPath];
          next[newPath] = previousContent;
          return next;
        });

        setOriginalContents((current) => {
          if (!(oldPath in current)) return current;
          const next = { ...current };
          next[newPath] = next[oldPath];
          delete next[oldPath];
          return next;
        });

        setDirtyPaths((current) => {
          if (!current.has(oldPath)) return current;
          const next = new Set(current);
          next.delete(oldPath);
          next.add(newPath);
          return next;
        });

        setOpenTabPaths((current) => current.map((path) => path === oldPath ? newPath : path));
        setActiveFilePath((current) => current === oldPath ? newPath : current);
        setEditorLocation((current) =>
          current?.path === oldPath ? { ...current, path: newPath } : current,
        );
        setSelectedEntryPath(newPath);
      }

      setNameDialog(null);
      setRefreshKey((current) => current + 1);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    }
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
      const separator = deletedPath.includes("\\") ? "\\" : "/";
      const affectsPath = (path: string) =>
        path === deletedPath ||
        (selectedEntry.kind === "directory" && path.startsWith(`${deletedPath}${separator}`));

      const deletedTabs = openTabPaths.filter(affectsPath);
      const nextTabs = openTabPaths.filter((path) => !affectsPath(path));

      for (const path of deletedTabs) {
        clearRecoverySnapshot(projectPath, path);
      }

      setOpenTabPaths(nextTabs);
      setFileContents((current) => {
        const next = { ...current };
        for (const path of Object.keys(next)) {
          if (affectsPath(path)) delete next[path];
        }
        return next;
      });
      setOriginalContents((current) => {
        const next = { ...current };
        for (const path of Object.keys(next)) {
          if (affectsPath(path)) delete next[path];
        }
        return next;
      });
      setDirtyPaths((current) => {
        const next = new Set(current);
        for (const path of deletedTabs) next.delete(path);
        return next;
      });

      if (activeFilePath && affectsPath(activeFilePath)) {
        const fallback = nextTabs[0] ?? null;
        setActiveFilePath(fallback);
        setSelectedEntryPath(fallback);
      }

      setEditorLocation((current) => current && affectsPath(current.path) ? null : current);
      setSelectedEntryPath((current) => current === deletedPath ? null : current);
      setRefreshKey((current) => current + 1);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-titlebar">
        <div className="workspace-brand">
          <button className="workspace-back-button" type="button" onClick={closeAllDirtyTabsAndLeave}>
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
          {sidebarMode === "explorer" ? (
            <>
              <div className="sidebar-heading">
                <span>EXPLORADOR</span>
                <div className="sidebar-heading-actions">
                  <button
                    type="button"
                    aria-label="Busca global"
                    title="Busca global"
                    onClick={() => setSidebarMode("search")}
                  >
                    ⌕
                  </button>
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
                            openFile(entry);
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
                        {entry.kind === "file" && dirtyPaths.has(entry.path) && (
                          <span className="tree-dirty-dot" aria-label="Alterações pendentes">●</span>
                        )}
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
            </>
          ) : (
            <>
              <div className="sidebar-heading">
                <span>BUSCA</span>
                <div className="sidebar-heading-actions">
                  <button
                    type="button"
                    aria-label="Voltar ao Explorer"
                    title="Voltar ao Explorer"
                    onClick={() => setSidebarMode("explorer")}
                  >
                    ‹
                  </button>
                </div>
              </div>

              <GlobalSearchPanel
                entries={entries}
                contentOverrides={fileContents}
                onOpenEntry={openSearchEntry}
                onOpenMatch={openSearchMatch}
              />
            </>
          )}
        </aside>

        <div className="workspace-sidebar-resizer" aria-hidden="true" />

        <section className="workspace-editor-area">
          <div className="editor-tabs" role="tablist" aria-label="Arquivos abertos">
            {openTabs.map((file) => {
              const isActive = file.path === activeFilePath;
              const isDirty = dirtyPaths.has(file.path);

              return (
                <div
                  className={`editor-tab ${isActive ? "is-active" : ""} ${isDirty ? "is-dirty" : ""}`}
                  key={file.path}
                >
                  <button
                    className="editor-tab-main"
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => openFile(file)}
                    title={file.relativePath}
                  >
                    <span className="file-icon">{getFileIcon(file.name)}</span>
                    <span className="editor-tab-name">{file.name}</span>
                    {isDirty && <span className="tab-dot" aria-label="Alterações pendentes" />}
                  </button>
                  <button
                    className="editor-tab-close"
                    type="button"
                    aria-label={`Fechar ${file.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(file.path);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
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
                  targetLocation={editorLocation?.path === activeFile.path ? editorLocation : undefined}
                />
              </div>

              <footer className="workspace-statusbar">
                <div className="status-left">
                  <span>Local</span>
                  <span>✓</span>
                  <span>{dirtyPaths.has(activeFile.path) ? "Alterações pendentes" : "0 erros"}</span>
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
                {error ?? "Abra um arquivo pelo Explorer para começar a editar."}
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
