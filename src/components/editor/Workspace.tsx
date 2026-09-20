import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { editor } from "monaco-editor";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import { MonacoEditor } from "./monaco/MonacoEditor";
import { ExplorerNameDialog } from "./ExplorerNameDialog";
import { GlobalSearchPanel } from "./GlobalSearchPanel";
import { WorkspaceMenuBar, type WorkspaceMenu, type WorkspaceMenuItem } from "./WorkspaceMenuBar";
import { WorkspaceHelpDialog } from "./WorkspaceHelpDialog";
import { createFileSaveQueue } from "../../services/fileSaveQueue";
import { runEditorCommand } from "../../services/editorCommands";
import "../../styles/menus.css";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
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
  onOpenProject: () => Promise<void>;
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

type WorkspaceContextMenuState =
  | {
      kind: "explorer";
      x: number;
      y: number;
      targetPath: string | null;
    }
  | {
      kind: "tab";
      x: number;
      y: number;
      targetPath: string;
    }
  | null;

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

export function Workspace({ projectName, projectPath, onBackToHome, onOpenProject }: WorkspaceProps) {
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
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenuState>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [minimap, setMinimap] = useState(true);
  const [helpPage, setHelpPage] = useState<"about" | "help" | null>(null);
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const leavingRef = useRef(false);
  const contentsRef = useRef(fileContents);
  const originalsRef = useRef(originalContents);
  contentsRef.current = fileContents;
  originalsRef.current = originalContents;
  const saveQueue = useRef(createFileSaveQueue(saveProjectFile));
  const editorModels = useRef(new Set<editor.ITextModel>());
  const modelListener = useRef<{ dispose: () => void } | null>(null);
  const onEditorReady = useCallback((instance: editor.IStandaloneCodeEditor | null) => {
    modelListener.current?.dispose();
    modelListener.current = null;
    setEditorInstance(instance);
    if (!instance) return;
    const trackModel = () => {
      const model = instance.getModel();
      if (model) editorModels.current.add(model);
    };
    trackModel();
    modelListener.current = instance.onDidChangeModel(trackModel);
  }, []);
  useEffect(() => () => {
    modelListener.current?.dispose();
    for (const model of editorModels.current) model.dispose();
    editorModels.current.clear();
  }, []);
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
    originalsRef.current = { ...originalsRef.current, [path]: content };
    setOriginalContents((current) => ({
      ...current,
      [path]: content,
    }));
    setDirtyPaths((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      if (contentsRef.current[path]?.content === content) next.delete(path);
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

  async function confirmTabClose(path: string) {
    if (!dirtyPaths.has(path)) {
      return true;
    }

    const file = files.find((entry) => entry.path === path);
    return confirm(
      `“${file?.name ?? "Arquivo"}” possui alterações recentes que ainda não foram confirmadas como salvas. Fechar a aba mesmo assim?`,
      {
        title: "Fechar arquivo",
        kind: "warning",
        okLabel: "Fechar mesmo assim",
        cancelLabel: "Cancelar",
      },
    );
  }

  async function closeTabs(paths: string[]) {
    const targets = [...new Set(paths)].filter((path) => openTabPaths.includes(path));

    for (const path of targets) {
      const confirmed = await confirmTabClose(path);
      if (!confirmed) {
        return false;
      }
    }

    const pathsToClose = new Set(targets);

    setOpenTabPaths((current) => {
      const activeIndex = activeFilePath ? current.indexOf(activeFilePath) : -1;
      const next = current.filter((path) => !pathsToClose.has(path));

      if (activeFilePath && pathsToClose.has(activeFilePath)) {
        const fallback = next[activeIndex] ?? next[activeIndex - 1] ?? next.at(-1) ?? null;
        setActiveFilePath(fallback);
        setSelectedEntryPath(fallback);
        setEditorLocation(null);
      }

      return next;
    });

    return true;
  }

  async function closeTab(path: string) {
    return closeTabs([path]);
  }

  function openExplorerContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    entry: ProjectFile | null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedEntryPath(entry?.path ?? null);
    setContextMenu({
      kind: "explorer",
      x: event.clientX,
      y: event.clientY,
      targetPath: entry?.path ?? null,
    });
  }

  function openTabContextMenu(event: ReactMouseEvent<HTMLElement>, path: string) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "tab",
      x: event.clientX,
      y: event.clientY,
      targetPath: path,
    });
  }

  function getContextMenuItems(): ContextMenuItem[] {
    if (!contextMenu) {
      return [];
    }

    if (contextMenu.kind === "explorer") {
      const entry = contextMenu.targetPath
        ? entries.find((item) => item.path === contextMenu.targetPath) ?? null
        : null;

      if (!entry) {
        return [
          {
            id: "new-file",
            label: "Novo Arquivo",
            onSelect: () => openNameDialog("file"),
          },
          {
            id: "new-folder",
            label: "Nova Pasta",
            onSelect: () => openNameDialog("folder"),
          },
          {
            id: "refresh",
            label: "Atualizar",
            separatorBefore: true,
            onSelect: () => setRefreshKey((current) => current + 1),
          },
        ];
      }

      if (entry.kind === "directory") {
        return [
          {
            id: "new-file",
            label: "Novo Arquivo",
            onSelect: () => openNameDialog("file"),
          },
          {
            id: "new-folder",
            label: "Nova Pasta",
            onSelect: () => openNameDialog("folder"),
          },
          {
            id: "rename",
            label: "Renomear",
            separatorBefore: true,
            onSelect: openRenameDialog,
          },
          {
            id: "delete",
            label: "Excluir",
            danger: true,
            onSelect: handleDeleteSelected,
          },
          {
            id: "refresh",
            label: "Atualizar",
            separatorBefore: true,
            onSelect: () => setRefreshKey((current) => current + 1),
          },
        ];
      }

      return [
        {
          id: "open",
          label: "Abrir",
          onSelect: () => openFile(entry),
        },
        {
          id: "rename",
          label: "Renomear",
          separatorBefore: true,
          onSelect: openRenameDialog,
        },
        {
          id: "delete",
          label: "Excluir",
          danger: true,
          onSelect: handleDeleteSelected,
        },
      ];
    }

    const tabIndex = openTabPaths.indexOf(contextMenu.targetPath);
    const pathsToRight = tabIndex >= 0 ? openTabPaths.slice(tabIndex + 1) : [];

    return [
      {
        id: "close",
        label: "Fechar",
        onSelect: () => closeTab(contextMenu.targetPath),
      },
      {
        id: "close-others",
        label: "Fechar Outras",
        separatorBefore: true,
        disabled: openTabPaths.length <= 1,
        onSelect: () => closeTabs(
          openTabPaths.filter((path) => path !== contextMenu.targetPath),
        ),
      },
      {
        id: "close-right",
        label: "Fechar à Direita",
        disabled: pathsToRight.length === 0,
        onSelect: () => closeTabs(pathsToRight),
      },
      {
        id: "close-all",
        label: "Fechar Todas",
        onSelect: () => closeTabs(openTabPaths),
      },
    ];
  }

  function reportError(error: unknown) {
    setError(error instanceof Error ? error.message : String(error));
  }

  async function saveFile(path: string) {
    const content = contentsRef.current[path]?.content;
    if (content === undefined) return;
    setError(null);
    setSaveState("saving");
    try {
      await saveQueue.current.save(path, content);
      markSaved(path, content);
      if (contentsRef.current[path]?.content === content) clearRecoverySnapshot(projectPath, path);
      setSaveState("saved");
    } catch (error) {
      markDirty(path);
      setSaveState("error");
      throw new Error(`Não foi possível salvar ${path}: ${error}`);
    }
  }

  async function saveAll() {
    const paths = Object.keys(contentsRef.current).filter(
      (path) => contentsRef.current[path].content !== originalsRef.current[path] || saveQueue.current.isPending(path),
    );
    const results = await Promise.allSettled(paths.map(saveFile));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      setSaveState("error");
      throw new Error(failures.map((result) => String(result.reason)).join("\n"));
    }
  }

  async function leaveWorkspace(action: () => void | Promise<void>) {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setIsLeaving(true);
    try {
      const pending = Object.keys(contentsRef.current).some(
        (path) => contentsRef.current[path].content !== originalsRef.current[path] || saveQueue.current.isPending(path),
      );
      if (pending && !await confirm("Salvar as alterações pendentes antes de continuar?", {
        title: "Alterações pendentes", kind: "warning", okLabel: "Salvar e continuar", cancelLabel: "Cancelar",
      })) return;
      await saveAll();
      await action();
    } catch (error) { reportError(error); }
    finally { leavingRef.current = false; setIsLeaving(false); }
  }

  const closeAllDirtyTabsAndLeave = () => leaveWorkspace(onBackToHome);
  const exitWorkspace = () => leaveWorkspace(() => getCurrentWindow().destroy());
  const exitRef = useRef(exitWorkspace);
  exitRef.current = exitWorkspace;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void exitRef.current();
    }).then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    }).catch(reportError);
    return () => { disposed = true; unlisten?.(); };
  }, []);

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
          setOpenTabPaths((current) => {
            const next = current.filter((path) => projectEntries.some((entry) => entry.kind === "file" && entry.path === path));
            if (pendingActivePath && firstPath === pendingActivePath && !next.includes(firstPath)) next.push(firstPath);
            return next;
          });
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

    const file = activeFile;
    async function loadFile() {
      setError(null);

      try {
        const diskContent = await readProjectFile(file.path);
        if (cancelled) return;

        const recovery = getRecoverySnapshot(projectPath, file.path);
        let content = diskContent;
        let recovered = false;

        if (recovery && recovery.content !== diskContent) {
          const restore = await confirm(
            `O Corant encontrou uma versão recuperável de “${file.name}” criada em ${new Date(recovery.updatedAt).toLocaleString()}. Deseja restaurar essa versão?`,
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
            clearRecoverySnapshot(projectPath, file.path);
          }
        } else if (recovery) {
          clearRecoverySnapshot(projectPath, file.path);
        }

        setFileContents((current) => ({
          ...current,
          [file.path]: {
            content,
            language: getLanguage(file.name),
          },
        }));
        setOriginalContents((current) => ({
          ...current,
          [file.path]: diskContent,
        }));
        setDirtyPaths((current) => {
          const next = new Set(current);
          if (recovered) next.add(file.path);
          else next.delete(file.path);
          return next;
        });
      } catch (readError) {
        if (!cancelled) {
          setError(`Não foi possível abrir ${file.name}: ${readError}`);
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
      void saveFile(activeFile.path).catch(reportError);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeFile, activeContent, originalContents, projectPath]);

  function updateActiveFile(value: string) {
    if (!activeFile || leavingRef.current) return;

    markDirty(activeFile.path);
    saveRecoverySnapshot(projectPath, activeFile.path, value);
    contentsRef.current = { ...contentsRef.current, [activeFile.path]: { content: value, language: getLanguage(activeFile.name) } };
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

  function showSidebar(mode: "explorer" | "search") {
    setSidebarVisible(true);
    setSidebarMode(mode);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(mode === "search" ? ".global-search-panel input" : ".tree-project-name")?.focus();
    });
  }

  function switchTab(direction: 1 | -1) {
    const index = openTabPaths.indexOf(activeFilePath ?? "");
    const path = openTabPaths[(index + direction + openTabPaths.length) % openTabPaths.length];
    const file = files.find((entry) => entry.path === path);
    if (file) openFile(file);
  }

  function editorCommand(id: string, label: string, shortcut?: string, separatorBefore = false): WorkspaceMenuItem {
    return { id, label, shortcut, separatorBefore, disabled: !activeContent || !editorInstance,
      onSelect: () => { if (editorInstance) return runEditorCommand(editorInstance, id); } };
  }

  const menus: WorkspaceMenu[] = [
    { label: "Arquivo", items: [
      { id: "new-file", label: "Novo arquivo…", shortcut: "Ctrl+N", onSelect: () => openNameDialog("file") },
      { id: "new-folder", label: "Nova pasta…", onSelect: () => openNameDialog("folder") },
      { id: "open-project", label: "Abrir projeto…", shortcut: "Ctrl+O", separatorBefore: true, onSelect: () => leaveWorkspace(onOpenProject) },
      { id: "save", label: "Salvar", shortcut: "Ctrl+S", separatorBefore: true, disabled: !activeContent, onSelect: () => activeFile ? saveFile(activeFile.path) : undefined },
      { id: "save-all", label: "Salvar tudo", shortcut: "Ctrl+Shift+S", disabled: dirtyPaths.size === 0, onSelect: saveAll },
      { id: "close-tab", label: "Fechar aba", shortcut: "Ctrl+W", separatorBefore: true, disabled: !activeFile, onSelect: () => activeFile ? closeTab(activeFile.path) : undefined },
      { id: "close-tabs", label: "Fechar todas as abas", disabled: openTabs.length === 0, onSelect: () => closeTabs(openTabPaths) },
      { id: "close-project", label: "Fechar projeto", onSelect: closeAllDirtyTabsAndLeave },
      { id: "exit", label: "Sair", separatorBefore: true, disabled: !isTauri(), onSelect: exitWorkspace },
    ] },
    { label: "Editar", items: [
      editorCommand("undo", "Desfazer", "Ctrl+Z"),
      editorCommand("redo", "Refazer", "Ctrl+Y"),
      editorCommand("cut", "Recortar", "Ctrl+X", true),
      editorCommand("copy", "Copiar", "Ctrl+C"),
      editorCommand("paste", "Colar", "Ctrl+V"),
      editorCommand("deleteRight", "Excluir", "Delete"),
      editorCommand("editor.action.selectAll", "Selecionar tudo", "Ctrl+A", true),
      editorCommand("actions.find", "Localizar…", "Ctrl+F", true),
      editorCommand("editor.action.startFindReplaceAction", "Substituir…", "Ctrl+H"),
    ] },
    { label: "Seleção", items: [
      editorCommand("editor.action.selectAll", "Selecionar tudo", "Ctrl+A"),
      editorCommand("expandLineSelection", "Selecionar linha", "Ctrl+L"),
      editorCommand("editor.action.smartSelect.expand", "Expandir seleção", "Shift+Alt+→", true),
      editorCommand("editor.action.smartSelect.shrink", "Reduzir seleção", "Shift+Alt+←"),
      editorCommand("editor.action.addSelectionToNextFindMatch", "Adicionar próxima ocorrência", "Ctrl+D", true),
      editorCommand("editor.action.selectHighlights", "Selecionar todas as ocorrências", "Ctrl+Shift+L"),
    ] },
    { label: "Exibir", items: [
      { id: "explorer", label: "Explorer", shortcut: "Ctrl+Shift+E", onSelect: () => showSidebar("explorer") },
      { id: "search", label: "Busca global", shortcut: "Ctrl+Shift+F", onSelect: () => showSidebar("search") },
      { id: "sidebar", label: "Barra lateral", shortcut: "Ctrl+B", checked: sidebarVisible, separatorBefore: true, onSelect: () => setSidebarVisible((value) => !value) },
      { id: "minimap", label: "Minimapa", checked: minimap, onSelect: () => setMinimap((value) => !value) },
      { id: "wrap", label: "Quebra automática de linha", shortcut: "Alt+Z", checked: wordWrap, onSelect: () => setWordWrap((value) => !value) },
      { id: "next-tab", label: "Próxima aba", shortcut: "Ctrl+Tab", separatorBefore: true, disabled: openTabs.length < 2, onSelect: () => switchTab(1) },
      { id: "previous-tab", label: "Aba anterior", shortcut: "Ctrl+Shift+Tab", disabled: openTabs.length < 2, onSelect: () => switchTab(-1) },
      { id: "refresh", label: "Atualizar Explorer", onSelect: () => setRefreshKey((value) => value + 1) },
    ] },
    { label: "Executar", items: [
      { id: "run-unavailable", label: "Execução ainda não disponível", disabled: true, onSelect: () => undefined },
    ] },
    { label: "Terminal", items: [
      { id: "terminal-unavailable", label: "Terminal integrado em breve", disabled: true, onSelect: () => undefined },
    ] },
    { label: "Ajuda", items: [
      { id: "help", label: "Guia e atalhos", shortcut: "F1", onSelect: () => setHelpPage("help") },
      { id: "about", label: "Sobre o Corant", onSelect: () => setHelpPage("about") },
    ] },
  ];

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || nameDialog || helpPage || isLeaving) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      let command: (() => unknown) | undefined;
      if (mod && !event.altKey) {
        if (key === "s") command = event.shiftKey ? saveAll : () => activeFile && saveFile(activeFile.path);
        else if (key === "n" && !event.shiftKey) command = () => openNameDialog("file");
        else if (key === "o" && !event.shiftKey) command = () => leaveWorkspace(onOpenProject);
        else if (key === "w" && !event.shiftKey) command = () => activeFile && closeTab(activeFile.path);
        else if (key === "b" && !event.shiftKey) command = () => setSidebarVisible((value) => !value);
        else if (key === "f" && event.shiftKey) command = () => showSidebar("search");
        else if (key === "e" && event.shiftKey) command = () => showSidebar("explorer");
        else if (key === "tab") command = () => switchTab(event.shiftKey ? -1 : 1);
      } else if (!mod && event.altKey && key === "z") command = () => setWordWrap((value) => !value);
      else if (!mod && !event.altKey && key === "f1") command = () => setHelpPage("help");
      if (command) {
        event.preventDefault(); event.stopPropagation();
        try { Promise.resolve(command()).catch(reportError); } catch (error) { reportError(error); }
      }
    }
    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  });

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
            {saveState === "saved" && (dirtyPaths.size ? "● Alterações pendentes" : "● Salvo")}
            {saveState === "error" && "● Erro ao salvar"}
          </span>
        </div>
      </header>

      <div inert={isLeaving || !!nameDialog || !!helpPage}>
        <WorkspaceMenuBar menus={menus} onError={reportError} />
      </div>
      {error && <div role="alert" className="workspace-error-banner">{error}
        <button type="button" aria-label="Dispensar erro" onClick={() => setError(null)}>×</button>
      </div>}

      <section className="workspace-body" inert={isLeaving}>
        <aside className="workspace-sidebar" style={{ width: sidebarWidth, display: sidebarVisible ? undefined : "none" }}>
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

              <div
                className="project-tree"
                onContextMenu={(event) => openExplorerContextMenu(event, null)}
              >
                <button
                  className={`tree-project-name ${selectedEntryPath === null ? "is-root-selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedEntryPath(null)}
                  onContextMenu={(event) => openExplorerContextMenu(event, null)}
                  title="Selecionar a raiz do projeto"
                >
                  <span className="tree-chevron">⌄</span>
                  <span>{projectName}</span>
                </button>

                {isLoading && <div className="tree-message">Carregando arquivos...</div>}

                {!isLoading && !error && entries.length === 0 && (
                  <div className="tree-message">Pasta vazia</div>
                )}

                {!isLoading && entries.length > 0 && (
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
                        onContextMenu={(event) => openExplorerContextMenu(event, entry)}
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

        {sidebarVisible && <div className="workspace-sidebar-resizer" aria-hidden="true" />}

        <section className="workspace-editor-area">
          <div className="editor-tabs" role="tablist" aria-label="Arquivos abertos">
            {openTabs.map((file) => {
              const isActive = file.path === activeFilePath;
              const isDirty = dirtyPaths.has(file.path);

              return (
                <div
                  className={`editor-tab ${isActive ? "is-active" : ""} ${isDirty ? "is-dirty" : ""}`}
                  key={file.path}
                  onContextMenu={(event) => openTabContextMenu(event, file.path)}
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
                  path={activeFile.path}
                  value={activeContent.content}
                  language={activeContent.language}
                  onChange={updateActiveFile}
                  onReady={onEditorReady}
                  wordWrap={wordWrap}
                  minimap={minimap}
                  readOnly={isLeaving}
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {nameDialog && (
        <ExplorerNameDialog
          mode={nameDialog.mode}
          initialName={nameDialog.initialName}
          onClose={() => setNameDialog(null)}
          onSubmit={handleNameSubmit}
        />
      )}
      {helpPage && <WorkspaceHelpDialog page={helpPage} onClose={() => setHelpPage(null)} />}
    </main>
  );
}
