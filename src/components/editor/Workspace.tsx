import "../../styles/plugins.css";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import { MonacoEditor } from "./monaco/MonacoEditor";
import { ImageSurface } from "./image/ImageEditor";
import { ImageSessions } from "../../services/imageEditor";
import { imageMimeType } from "../../services/projectImages";
import { ExplorerNameDialog } from "./ExplorerNameDialog";
import { GlobalSearchPanel } from "./GlobalSearchPanel";
import { WorkspaceMenuBar, type WorkspaceMenu, type WorkspaceMenuItem } from "./WorkspaceMenuBar";
import { WorkspaceHelpDialog } from "./WorkspaceHelpDialog";
import { createFileSaveQueue } from "../../services/fileSaveQueue";
import { runEditorCommand } from "../../services/editorCommands";
import { WorkspaceTerminal } from "../../services/workspaceTerminal";
import { useWorkspacePlugins } from "../../plugins/useWorkspacePlugins";
import { ExternalPluginsPanel } from "../../plugins/ExternalPluginsPanel";
import { PluginPanelView } from "../../plugins/PluginPanelView";
import { affectsProjectPath, remapProjectPath } from "../../services/projectPaths";
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
  clearRecoverySnapshotsForPath,
  moveRecoverySnapshotsForPath,
  getRecoverySnapshot,
  saveRecoverySnapshot,
} from "../../services/recoveryStore";

type WorkspaceProps = {
  projectName: string;
  projectPath: string;
  onBackToHome: () => void;
  onOpenProject: () => Promise<void>;
};

const TerminalPanel = lazy(() => import("./TerminalPanel").then((module) => ({ default: module.TerminalPanel })));

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
    case "svg":
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
  if (imageMimeType(name)) return "▧";
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

function disposeObsoleteModel(model: editor.ITextModel) {
  if (model.isDisposed()) return;
  // Monaco can restore a disposed model's undo stack by URI. setValue clears that
  // stack through its public API, even when the text itself has not changed.
  model.setValue(model.getValue());
  model.dispose();
}

export function Workspace({ projectName, projectPath, onBackToHome, onOpenProject }: WorkspaceProps) {
  const [imageSessions] = useState(() => new ImageSessions());
  useSyncExternalStore(imageSessions.subscribe, imageSessions.snapshot);
  async function confirmImageDiscard(matches: (path: string) => boolean) {
    if (imageSessions.hasBusy()) { reportError("Aguarde a exportação da imagem terminar."); return false; }
    const unsaved = imageSessions.dirtyPaths().filter(matches);
    return !unsaved.length || await confirm(`Há ${unsaved.length} imagem(ns) com edições não exportadas. Exporte uma cópia para guardar o resultado. Descartar essas edições?`, {
      title: "Edições de imagem", kind: "warning", okLabel: "Descartar edições", cancelLabel: "Voltar ao editor",
    });
  }
  const terminalRef = useRef<WorkspaceTerminal | null>(null);
  useEffect(() => {
    const terminal = new WorkspaceTerminal(projectPath);
    terminalRef.current = terminal;
    return () => {
      terminalRef.current = null;
      void terminal.dispose().catch((error) => console.error("Falha ao encerrar terminal:", error));
    };
  }, [projectPath]);
  const [entries, setEntries] = useState<ProjectFile[]>([]);
  const [openTabPaths, setOpenTabPaths] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [svgCodePath, setSvgCodePath] = useState<string | null>(null);
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
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const leavingRef = useRef(false);
  const [isMutating, setIsMutating] = useState(false);
  const mutationRef = useRef(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const agentTask = useRef<{ controller: AbortController; done: Promise<string> } | null>(null);
  const autosaveTimers = useRef(new Map<string, { timer: number; content: string }>());
  const contentsRef = useRef(fileContents);
  const originalsRef = useRef(originalContents);
  contentsRef.current = fileContents;
  originalsRef.current = originalContents;
  const saveQueue = useRef(createFileSaveQueue(saveProjectFile));
  const editorModels = useRef(new Set<editor.ITextModel>());
  const obsoleteModels = useRef(new Set<editor.ITextModel>());
  const monacoRef = useRef<Monaco | null>(null);
  const modelListener = useRef<{ dispose: () => void } | null>(null);
  const onEditorReady = useCallback((instance: editor.IStandaloneCodeEditor | null, monaco?: Monaco) => {
    if (monaco) monacoRef.current = monaco;
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
    agentTask.current?.controller.abort();
    for (const { timer } of autosaveTimers.current.values()) window.clearTimeout(timer);
    autosaveTimers.current.clear();
    modelListener.current?.dispose();
    const models = [...editorModels.current];
    // Let the wrapper detach its change listeners before clearing models on exit.
    queueMicrotask(() => models.forEach(disposeObsoleteModel));
    editorModels.current.clear();
  }, []);
  // Dispose only after React/Monaco has switched away from the old model.
  useEffect(() => {
    for (const model of obsoleteModels.current) {
      disposeObsoleteModel(model);
      editorModels.current.delete(model);
    }
    obsoleteModels.current.clear();
  });
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

  const activeImageType = activeFile ? imageMimeType(activeFile.name) : null;
  const previewImage = Boolean(activeImageType && !(activeImageType === "image/svg+xml" && svgCodePath === activeFilePath));
  const activeContent = activeFile && !previewImage ? fileContents[activeFile.path] : null;
  const plugins = useWorkspacePlugins({ name: projectName, path: projectPath }, {
    instance: editorInstance,
    path: activeContent ? activeFilePath : null,
    modelUri: activeContent && activeFilePath && monacoRef.current ? monacoRef.current.Uri.parse(activeFilePath).toString() : null,
    isReadOnly: () => leavingRef.current || mutationRef.current,
  }, reportError, {
    list: () => entries.map((entry) => ({ path: entry.relativePath, kind: entry.kind })),
    selected: () => selectedEntry ? { path: selectedEntry.relativePath, kind: selectedEntry.kind } : null,
    content: (path) => { const entry = entries.find((item) => item.relativePath === path); return entry ? contentsRef.current[entry.path]?.content : undefined; },
    refresh: () => setRefreshKey((value) => value + 1),
    runAgent: runWorkspaceAgent,
  });

  function reconcileDirty(path: string, savedContent = originalsRef.current[path]) {
    setDirtyPaths((current) => {
      const next = new Set(current);
      if (contentsRef.current[path] && contentsRef.current[path].content !== savedContent) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  function markSaved(path: string, content: string) {
    originalsRef.current = { ...originalsRef.current, [path]: content };
    setOriginalContents((current) => ({
      ...current,
      [path]: content,
    }));
    reconcileDirty(path, content);
  }

  function activateFile(
    file: ProjectFile,
    location?: { lineNumber: number; column: number },
  ) {
    setSvgCodePath(location && imageMimeType(file.name) === "image/svg+xml" ? file.path : null);
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
    if (!contentsRef.current[path] || contentsRef.current[path].content === originalsRef.current[path]) {
      return true;
    }

    const file = files.find((entry) => entry.path === path);
    return confirm(
      `Descartar as alterações não salvas de “${file?.name ?? "Arquivo"}” e fechar a aba? A versão já salva no disco será mantida.`,
      {
        title: "Fechar arquivo",
        kind: "warning",
        okLabel: "Descartar e fechar",
        cancelLabel: "Cancelar",
      },
    );
  }

  async function closeTabs(paths: string[]) {
    if (mutationRef.current || leavingRef.current) return false;
    const targets = [...new Set(paths)].filter((path) => openTabPaths.includes(path));
    const pathsToClose = new Set(targets);
    try {
      return await runPathMutation((path) => pathsToClose.has(path), async () => {
        if (!await confirmImageDiscard((path) => pathsToClose.has(path))) return false;
        const discarded = new Set<string>();
        for (const path of targets) {
          if (!await confirmTabClose(path)) return false;
          if (contentsRef.current[path]?.content !== originalsRef.current[path]) discarded.add(path);
        }
        // Commit only after every confirmation; canceling a batch discards nothing.
        imageSessions.remove((path) => pathsToClose.has(path));
        for (const path of discarded) clearRecoverySnapshot(projectPath, path);
        removeLoadedPaths((path) => discarded.has(path));
        const activeIndex = activeFilePath ? openTabPaths.indexOf(activeFilePath) : -1;
        const next = openTabPaths.filter((path) => !pathsToClose.has(path));
        setOpenTabPaths(next);
        if (activeFilePath && pathsToClose.has(activeFilePath)) {
          const fallback = next[activeIndex] ?? next[activeIndex - 1] ?? next.at(-1) ?? null;
          setActiveFilePath(fallback);
          setSelectedEntryPath(fallback);
          setEditorLocation(null);
        }
        return true;
      });
    } catch (error) {
      reportError(error);
      return false;
    }
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
      const folderTools: ContextMenuItem[] = plugins.commands.some((command) => command.id === "corant.commands.tree") ? [{
        id: "commands-tree", label: "Exportar árvore da pasta…", separatorBefore: true,
        onSelect: () => plugins.executeCommand("corant.commands.tree"),
      }] : [];

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
          ...folderTools,
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
          ...folderTools,
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

  function cancelAutosave(path: string) {
    const pending = autosaveTimers.current.get(path);
    if (pending) window.clearTimeout(pending.timer);
    autosaveTimers.current.delete(path);
  }

  function disposeModelsForPaths(matches: (path: string) => boolean) {
    // @monaco-editor/react uses monaco.Uri.parse(path), confirmed in its model factory.
    for (const path of Object.keys(contentsRef.current).filter(matches)) {
      const model = monacoRef.current?.editor.getModel(monacoRef.current.Uri.parse(path));
      if (model) obsoleteModels.current.add(model);
    }
  }

  function removeLoadedPaths(matches: (path: string) => boolean) {
    disposeModelsForPaths(matches);
    contentsRef.current = Object.fromEntries(Object.entries(contentsRef.current).filter(([path]) => !matches(path)));
    originalsRef.current = Object.fromEntries(Object.entries(originalsRef.current).filter(([path]) => !matches(path)));
    setFileContents(contentsRef.current);
    setOriginalContents(originalsRef.current);
    setDirtyPaths((current) => new Set([...current].filter((path) => !matches(path))));
  }

  async function runPathMutation<T>(matches: (path: string) => boolean, operation: () => Promise<T>) {
    if (imageSessions.hasBusy()) throw new Error("Aguarde a exportação da imagem terminar.");
    if (mutationRef.current || leavingRef.current) throw new Error("Aguarde a operação atual terminar.");
    mutationRef.current = true;
    setIsMutating(true);
    for (const path of autosaveTimers.current.keys()) if (matches(path)) cancelAutosave(path);
    try { return await saveQueue.current.withPathsLocked(matches, operation); }
    finally {
      mutationRef.current = false;
      setIsMutating(false);
      scheduleDirtyAutosaves();
    }
  }

  const saveFileRef = useRef(saveFile);
  saveFileRef.current = saveFile;
  function scheduleDirtyAutosaves() {
    for (const [path, file] of Object.entries(contentsRef.current)) {
      if (saveQueue.current.isBlocked(path)) continue;
      if (file.content === originalsRef.current[path]) { cancelAutosave(path); continue; }
      if (autosaveTimers.current.get(path)?.content === file.content) continue;
      cancelAutosave(path);
      const timer = window.setTimeout(() => {
        autosaveTimers.current.delete(path);
        void saveFileRef.current(path).catch(reportError);
      }, 500);
      autosaveTimers.current.set(path, { timer, content: file.content });
    }
  }

  async function saveFile(path: string) {
    if (saveQueue.current.isBlocked(path)) return;
    cancelAutosave(path);
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
      reconcileDirty(path);
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

  function runWorkspaceAgent(work: (signal: AbortSignal) => Promise<string>, signal: AbortSignal): Promise<string> {
    if (imageSessions.hasBusy() || imageSessions.dirtyPaths().length) return Promise.reject(new Error("Exporte as edições de imagem antes de executar o agente."));
    if (mutationRef.current || leavingRef.current || signal.aborted) return Promise.reject(new Error("Workspace ocupado ou operação cancelada."));
    imageSessions.remove(() => true);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    mutationRef.current = true;
    setIsMutating(true);
    setAgentBusy(true);
    const done = (async () => {
      try {
        // Save and drain before granting native tools access to the project.
        await saveAll();
        if (controller.signal.aborted) throw new Error("Operação cancelada.");
        return await saveQueue.current.withPathsLocked(() => true, async () => {
          try { return await work(controller.signal); }
          finally {
            // The native process tree has exited even on cancellation/failure.
            let diskEntries: ProjectFile[];
            try { diskEntries = await listProjectEntries(projectPath); }
            catch (cause) {
              // Stale buffers must never become the source of a later autosave.
              removeLoadedPaths(() => true);
              throw cause;
            }
            const existing = new Set(diskEntries.filter((entry) => entry.kind === "file").map((entry) => entry.path));
            const existingPaths = new Set(diskEntries.map((entry) => entry.path));
            for (const entry of entries) {
              if (!existingPaths.has(entry.path)) clearRecoverySnapshotsForPath(projectPath, entry.path, entry.kind === "directory");
            }
            for (const [path, file] of Object.entries(contentsRef.current)) {
              if (!existing.has(path)) {
                clearRecoverySnapshot(projectPath, path);
                removeLoadedPaths((candidate) => candidate === path);
                continue;
              }
              let content: string;
              try { content = await readProjectFile(path); }
              catch (cause) { removeLoadedPaths((candidate) => candidate === path); reportError(cause); continue; }
              if (content === file.content) continue;
              const model = monacoRef.current?.editor.getModel(monacoRef.current.Uri.parse(path));
              if (model && !model.isDisposed()) {
                model.pushStackElement();
                model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
                model.pushStackElement();
              }
              contentsRef.current = { ...contentsRef.current, [path]: { ...file, content } };
              originalsRef.current = { ...originalsRef.current, [path]: content };
              clearRecoverySnapshot(projectPath, path);
            }
            setFileContents(contentsRef.current);
            setOriginalContents(originalsRef.current);
            setDirtyPaths(new Set());
            setRefreshKey((value) => value + 1);
          }
        });
      } finally {
        signal.removeEventListener("abort", abort);
        agentTask.current = null;
        mutationRef.current = false;
        setIsMutating(false);
        setAgentBusy(false);
        scheduleDirtyAutosaves();
      }
    })();
    agentTask.current = { controller, done };
    return done;
  }

  async function leaveWorkspace(action: () => void | Promise<void>) {
    if (!await confirmImageDiscard(() => true)) return;
    if (agentTask.current) {
      agentTask.current.controller.abort();
      await agentTask.current.done.catch(reportError);
    }
    if (leavingRef.current || mutationRef.current) return;
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

  const closeAllDirtyTabsAndLeave = () => leaveWorkspace(async () => {
    await terminalRef.current?.stop();
    await plugins.dispose();
    onBackToHome();
  });
  const exitWorkspace = () => leaveWorkspace(async () => {
    await terminalRef.current?.stop();
    await plugins.dispose();
    try { await getCurrentWindow().destroy(); } catch (error) { plugins.restart(); throw error; }
  });
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
    if (agentBusy || !activeFile || previewImage || fileContents[activeFile.path]) return;

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
  }, [activeFile, fileContents, projectPath, agentBusy, previewImage]);

  useEffect(() => {
    scheduleDirtyAutosaves();
  }, [fileContents, originalContents]);

  function updateActiveFile(value: string) {
    if (!activeFile || leavingRef.current || mutationRef.current) return;

    saveRecoverySnapshot(projectPath, activeFile.path, value);
    contentsRef.current = { ...contentsRef.current, [activeFile.path]: { content: value, language: getLanguage(activeFile.name) } };
    reconcileDirty(activeFile.path);
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
        const target = nameDialog.target;
        const oldPath = target.path;
        const directory = target.kind === "directory";
        const matches = (path: string) => affectsProjectPath(path, oldPath, directory);
        await runPathMutation(matches, async () => {
          const newPath = await renameProjectEntry(oldPath, name);
          if (newPath === oldPath) return;
          const remap = (path: string) => remapProjectPath(path, oldPath, newPath, directory);
          imageSessions.rename(remap);
          moveRecoverySnapshotsForPath(projectPath, oldPath, newPath, directory);
          disposeModelsForPaths(matches);
          contentsRef.current = Object.fromEntries(Object.entries(contentsRef.current).map(([path, content]) => [
            remap(path), { ...content, language: getLanguage(remap(path).split(/[\\/]/).at(-1) ?? "") },
          ]));
          originalsRef.current = Object.fromEntries(Object.entries(originalsRef.current).map(([path, content]) => [remap(path), content]));
          setFileContents(contentsRef.current);
          setOriginalContents(originalsRef.current);
          setDirtyPaths((current) => new Set([...current].map(remap)));
          setOpenTabPaths((current) => current.map(remap));
          setActiveFilePath((current) => current ? remap(current) : current);
          setPendingActivePath((current) => current ? remap(current) : current);
          setEditorLocation((current) => current ? { ...current, path: remap(current.path) } : current);
          setSelectedEntryPath(newPath);
          const relativePath = target.relativePath.split("/").slice(0, -1).concat(name.trim()).join("/");
          setExpandedDirectories((current) => new Set([...current].map((path) =>
            remapProjectPath(path, target.relativePath, relativePath, directory),
          )));
          setEntries((current) => current.map((entry) => matches(entry.path) ? {
            ...entry, path: remap(entry.path),
            name: entry.path === oldPath ? name.trim() : entry.name,
            relativePath: remapProjectPath(entry.relativePath, target.relativePath, relativePath, directory),
          } : entry));
        });
        setNameDialog(null);
        return;
      }

      setNameDialog(null);
      setRefreshKey((current) => current + 1);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
      throw mutationError;
    }
  }

  async function handleDeleteSelected() {
    if (!selectedEntry || mutationRef.current || leavingRef.current) return;
    const target = selectedEntry;
    const directory = target.kind === "directory";
    const matches = (path: string) => affectsProjectPath(path, target.path, directory);
    try {
      await runPathMutation(matches, async () => {
        const confirmed = await confirm(
          `Excluir ${directory ? "a pasta" : "o arquivo"} “${target.name}”?${directory ? " Todo o conteúdo dentro dela também será excluído." : ""}`,
          { title: "Excluir item", kind: "warning", okLabel: "Excluir", cancelLabel: "Cancelar" },
        );
        if (!confirmed) return;
        if (!await confirmImageDiscard(matches)) return;
        await deleteProjectEntry(target);
        imageSessions.remove(matches);
        clearRecoverySnapshotsForPath(projectPath, target.path, directory);
        removeLoadedPaths(matches);
        const nextTabs = openTabPaths.filter((path) => !matches(path));
        setOpenTabPaths(nextTabs);
        if (activeFilePath && matches(activeFilePath)) {
          const fallback = nextTabs[0] ?? null;
          setActiveFilePath(fallback);
        }
        setEditorLocation((current) => current && matches(current.path) ? null : current);
        setSelectedEntryPath((current) => current && matches(current) ? null : current);
        setPendingActivePath((current) => current && matches(current) ? null : current);
        setExpandedDirectories((current) => new Set([...current].filter((path) =>
          !affectsProjectPath(path, target.relativePath, directory),
        )));
        setEntries((current) => current.filter((entry) => !matches(entry.path)));
        setSaveState("saved");
        setError(null);
      });
    } catch (error) { reportError(error); }
  }

  function showSidebar(mode: "explorer" | "search") {
    setSidebarVisible(true);
    setSidebarMode(mode);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(mode === "search" ? ".global-search-panel input" : ".tree-project-name")?.focus();
    });
  }

  function toggleTerminal() {
    if (!terminalVisible) setTerminalOpened(true);
    setTerminalVisible((current) => !current);
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
    { label: "Executar", items: [{ id: "manage-plugins", label: "Gerenciar plugins…", disabled: !plugins.externalManager, onSelect: () => { plugins.closePanel(); setPluginManagerOpen(true); } }, ...plugins.commands.map((command) => ({
      id: command.id, label: command.title, disabled: isLeaving || isMutating,
      onSelect: () => { setPluginManagerOpen(false); return plugins.executeCommand(command.id); },
    }))] },
    { label: "Terminal", items: [
      { id: "toggle-terminal", label: terminalVisible ? "Ocultar terminal" : "Mostrar terminal", shortcut: "Ctrl+`", checked: terminalVisible, disabled: !isTauri(), onSelect: toggleTerminal },
    ] },
    { label: "Ajuda", items: [
      { id: "help", label: "Guia e atalhos", shortcut: "F1", onSelect: () => setHelpPage("help") },
      { id: "about", label: "Sobre o Corant", onSelect: () => setHelpPage("about") },
    ] },
  ];

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || nameDialog || helpPage || isLeaving || isMutating) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && ["s", "z", "y"].includes(event.key.toLowerCase()) && (event.target as HTMLElement).closest?.(".image-editor")) return;
      const key = event.key.toLowerCase();
      if (isTauri() && mod && !event.shiftKey && !event.altKey && key === "`") {
        event.preventDefault(); event.stopPropagation(); toggleTerminal(); return;
      }
      // Let the shell receive its own control keys when terminal input is focused.
      if ((event.target as HTMLElement).closest(".terminal-host, .plugin-panel")) return;
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
    <main className="workspace-shell" data-theme={plugins.theme}>
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
            {saveState === "saved" && ((dirtyPaths.size || imageSessions.dirtyPaths().length) ? "● Alterações pendentes" : "● Salvo")}
            {saveState === "error" && "● Erro ao salvar"}
          </span>
        </div>
      </header>

      <div inert={isLeaving || isMutating || !!nameDialog || !!helpPage}>
        <WorkspaceMenuBar menus={menus} onError={reportError} />
      </div>
      {error && <div role="alert" className="workspace-error-banner">{error}
        <button type="button" aria-label="Dispensar erro" onClick={() => setError(null)}>×</button>
      </div>}

      <section className="workspace-body" inert={isLeaving || (isMutating && !agentBusy)}>
        <aside className="workspace-sidebar" inert={agentBusy} style={{ width: sidebarWidth, display: sidebarVisible ? undefined : "none" }}>
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

        <section className="workspace-editor-area" inert={agentBusy}>
          <div className="editor-tabs" role="tablist" aria-label="Arquivos abertos">
            {openTabs.map((file) => {
              const isActive = file.path === activeFilePath;
              const isDirty = dirtyPaths.has(file.path) || imageSessions.dirty(file.path);

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

          {activeFile && previewImage ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-breadcrumbs"><span>{projectName}</span><span>/</span><span>{activeFile.relativePath}</span></div>
                {activeImageType === "image/svg+xml" && <button className="image-view-toggle" onClick={() => setSvgCodePath(activeFile.path)}>Editar SVG</button>}
              </div>
              <ImageSurface key={`${activeFile.path}:${refreshKey}`} sessions={imageSessions} projectPath={projectPath} relativePath={activeFile.relativePath} path={activeFile.path} name={activeFile.name} source={activeImageType === "image/svg+xml" ? fileContents[activeFile.path]?.content : undefined} onExport={() => setRefreshKey(value => value + 1)} />
            </>
          ) : activeFile && activeContent ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-breadcrumbs">
                  <span>{projectName}</span>
                  <span>/</span>
                  <span>{activeFile.relativePath}</span>
                </div>
                <div className="editor-toolbar-actions">
                  {activeImageType === "image/svg+xml" && <button className="image-view-toggle" onClick={() => setSvgCodePath(null)}>Visualizar SVG</button>}
                  <span>{activeContent.language}</span>
                  <span>UTF-8</span>
                </div>
              </div>

              <div className="monaco-host">
                <MonacoEditor
                  theme={plugins.theme}
                  path={activeFile.path}
                  value={activeContent.content}
                  language={activeContent.language}
                  onChange={updateActiveFile}
                  onReady={onEditorReady}
                  wordWrap={wordWrap}
                  minimap={minimap}
                  readOnly={isLeaving || isMutating}
                  targetLocation={editorLocation?.path === activeFile.path ? editorLocation : undefined}
                />
              </div>

            </>
          ) : (
            <div className="editor-empty-state">
              <strong>{error ? "Não foi possível carregar o arquivo" : "Nenhum arquivo aberto"}</strong>
              <span>
                {error ?? "Abra um arquivo pelo Explorer para começar a editar."}
              </span>
            </div>
          )}
          {terminalOpened && terminalRef.current && (
            <Suspense fallback={<div className="terminal-loading">Abrindo terminal…</div>}>
              <TerminalPanel theme={plugins.theme} terminal={terminalRef.current} visible={terminalVisible} onHide={() => setTerminalVisible(false)} />
            </Suspense>
          )}
          {activeFile && activeContent && (
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
          )}
        </section>
        {pluginManagerOpen && plugins.externalManager && <aside className="plugin-panel" aria-label="Plugins externos"><header><strong>Plugins externos</strong><button aria-label="Fechar gerenciador de plugins" onClick={() => setPluginManagerOpen(false)}>×</button></header><ExternalPluginsPanel manager={plugins.externalManager}/></aside>}
        {!pluginManagerOpen && plugins.activePanel && <aside className="plugin-panel" key={plugins.activePanelId} aria-label={plugins.activePanel.title}><header><strong>{plugins.activePanel.title}</strong><button aria-label="Fechar plugin" onClick={plugins.closePanel}>×</button></header><PluginPanelView key={plugins.activePanelId} panel={plugins.activePanel}/></aside>}
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
