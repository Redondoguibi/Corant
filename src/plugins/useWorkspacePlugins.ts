import { invoke } from "@tauri-apps/api/core";
import { requestAi, codexAccount, codexModels } from "./nativeServices";
import type { PluginFile, PluginPanel, ThemeId } from "./api";
import { useEffect, useRef, useState } from "react";
import type { EditorDocument, PluginCommand, ProjectInfo } from "./api";
import { builtinPlugins } from "./builtins";
import { createPluginEditorBridge, type PluginEditorState } from "./editorBridge";
import { PluginHost } from "./host";
import { createPluginSettings } from "./settings";
import { listProjectEntries } from "../services/projectFilesystem";
import { ExternalPluginManager } from "./externalPlugins";

let previousWorkspaceCleanup: Promise<void> = Promise.resolve();

export function useWorkspacePlugins(project: ProjectInfo, editorState: PluginEditorState, report: (error: unknown) => void, files: { list(): readonly PluginFile[]; selected(): PluginFile | null; content(path: string): string | undefined; refresh(): void; runAgent(work: (signal: AbortSignal) => Promise<string>, signal: AbortSignal): Promise<string> }) {
  const latest = useRef({ project, editorState, report, files });
  latest.current = { project, editorState, report, files };
  const [generation, setGeneration] = useState(0);
  const [theme, setTheme] = useState<ThemeId>("crimson");
  const [panels, setPanels] = useState<Record<string, PluginPanel>>({});
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const hostRef = useRef<PluginHost | null>(null);
  const externalRef = useRef<ExternalPluginManager | null>(null);
  const [externalManager, setExternalManager] = useState<ExternalPluginManager | null>(null);
  const listeners = useRef(new Set<(document: EditorDocument | null) => void>());
  const [commands, setCommands] = useState<readonly PluginCommand[]>([]);
  const bridge = useRef(createPluginEditorBridge(() => latest.current.editorState)).current;

  useEffect(() => {
    let disposed = false;
    const host = new PluginHost({
      getInfo: () => latest.current.project,
      ...bridge,
      onDidChangeActiveDocument: (listener) => {
        listeners.current.add(listener);
        return { dispose: () => { listeners.current.delete(listener); } };
      },
    }, createPluginSettings(project.path, {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    }), (error, id) => { if (!disposed) latest.current.report(new Error(`Plugin ${id}: ${error.message}`, { cause: error })); }, 5000, {
      registerPanel: (id, panel) => { setPanels((current) => ({ ...current, [id]: panel })); return { dispose: () => { setPanels((current) => { const next = { ...current }; delete next[id]; return next; }); setActivePanelId((current) => current === id ? null : current); } }; },
      openPanel: setActivePanelId, setTheme,
      listFiles: () => latest.current.files.list(),
      selectedFile: () => latest.current.files.selected(),
      scanFiles: async () => (await listProjectEntries(project.path)).map((entry) => ({ path: entry.relativePath, kind: entry.kind })),
      readText: async (path) => {
        const disk = await invoke<string>("plugin_read_text", { projectPath: project.path, path });
        const text = latest.current.files.content(path) ?? disk;
        if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error("Arquivo excede 1 MiB.");
        return text;
      },
      exportText: async (name, text) => {
        if (latest.current.editorState.isReadOnly()) throw new Error("Workspace ocupado.");
        await invoke("plugin_export_text", { projectPath: project.path, name, text });
        if (!disposed) latest.current.files.refresh();
      },
      codexModels: (signal) => codexModels(project.path, signal),
      requestAi: (request, signal, onEvent) => request.accessMode
        ? latest.current.files.runAgent((cancel) => requestAi(project.path, request, cancel, onEvent), signal)
        : requestAi(project.path, request, signal, onEvent),
      codexAccount: (action, signal, output) => codexAccount(project.path, action, signal, output),
    });
    hostRef.current = host;
    const external = new ExternalPluginManager(host, project.path);
    externalRef.current = external;
    setExternalManager(external);
    const subscription = host.onDidChangeCommands(() => { if (!disposed) setCommands(host.listCommands()); });
    setCommands([]);
    void previousWorkspaceCleanup.then(() => {
      if (disposed) return;
      for (const { definition, grants } of builtinPlugins) {
        void host.activate(definition, grants).catch((error) => { if (!disposed) latest.current.report(error); });
      }
      void external.refresh().catch((error) => { if (!disposed) latest.current.report(error); });
    });
    return () => {
      disposed = true;
      hostRef.current = null;
      externalRef.current = null;
      subscription.dispose();
      // Revoke immediately and finish deactivation before activating the next workspace.
      previousWorkspaceCleanup = Promise.all([previousWorkspaceCleanup, external.dispose(), host.dispose()]).then(() => {});
    };
  }, [project.path, bridge, generation]);

  useEffect(() => {
    let disposed = false;
    let queued = false;
    const notify = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed || !listeners.current.size) return;
        const document = bridge.getActiveDocument();
        for (const listener of listeners.current) listener(document);
      });
    };
    const model = editorState.instance?.onDidChangeModel(notify);
    const content = editorState.instance?.onDidChangeModelContent(notify);
    notify();
    return () => { disposed = true; model?.dispose(); content?.dispose(); };
  }, [bridge, editorState.instance, editorState.path, editorState.modelUri]);

  return {
    commands, theme, activePanel: activePanelId ? panels[activePanelId] : null, activePanelId, externalManager,
    closePanel: () => setActivePanelId(null),
    restart: () => setGeneration((value) => value + 1),
    executeCommand: (id: string) => hostRef.current?.executeCommand(id),
    dispose: () => Promise.all([externalRef.current?.dispose(), hostRef.current?.dispose()]).then(() => {}),
  };
}
