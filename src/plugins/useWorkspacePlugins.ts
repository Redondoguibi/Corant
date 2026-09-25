import { useEffect, useRef, useState } from "react";
import type { EditorDocument, PluginCommand, ProjectInfo } from "./api";
import { builtinPlugins } from "./builtins";
import { createPluginEditorBridge, type PluginEditorState } from "./editorBridge";
import { PluginHost } from "./host";
import { createPluginSettings } from "./settings";

let previousWorkspaceCleanup: Promise<void> = Promise.resolve();

export function useWorkspacePlugins(project: ProjectInfo, editorState: PluginEditorState, report: (error: unknown) => void) {
  const latest = useRef({ project, editorState, report });
  latest.current = { project, editorState, report };
  const hostRef = useRef<PluginHost | null>(null);
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
    }), (error, id) => { if (!disposed) latest.current.report(new Error(`Plugin ${id}: ${error.message}`, { cause: error })); });
    hostRef.current = host;
    const subscription = host.onDidChangeCommands(() => { if (!disposed) setCommands(host.listCommands()); });
    setCommands([]);
    void previousWorkspaceCleanup.then(() => {
      if (disposed) return;
      for (const { definition, grants } of builtinPlugins) {
        void host.activate(definition, grants).catch((error) => { if (!disposed) latest.current.report(error); });
      }
    });
    return () => {
      disposed = true;
      hostRef.current = null;
      subscription.dispose();
      // Revoke immediately and finish deactivation before activating the next workspace.
      previousWorkspaceCleanup = Promise.all([previousWorkspaceCleanup, host.dispose()]).then(() => {});
    };
  }, [project.path, bridge]);

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
    commands,
    executeCommand: (id: string) => hostRef.current?.executeCommand(id),
    dispose: () => hostRef.current?.dispose(),
  };
}
