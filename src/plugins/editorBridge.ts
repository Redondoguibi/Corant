import type { editor } from "monaco-editor";
import { PluginApiError, type DocumentReplacement, type EditorDocument } from "./api";

export interface PluginEditorState {
  instance: editor.IStandaloneCodeEditor | null;
  path: string | null;
  modelUri: string | null;
  isReadOnly(): boolean;
}

export function createPluginEditorBridge(current: () => PluginEditorState) {
  function active() {
    const state = current();
    const model = state.instance?.getModel();
    if (!state.path || !model || model.isDisposed() || model.uri.toString() !== state.modelUri) return null;
    return { state, model };
  }
  return {
    getActiveDocument(): EditorDocument | null {
      const value = active();
      if (!value) return null;
      return { id: value.model.id, path: value.state.path!, version: value.model.getVersionId(),
        language: value.model.getLanguageId(), text: value.model.getValue() };
    },
    replaceActiveDocument(change: DocumentReplacement): void {
      const value = active();
      if (current().isReadOnly()) throw new PluginApiError("WORKSPACE_BUSY", "O workspace está salvando, fechando ou alterando arquivos.");
      if (!value || value.model.id !== change.documentId || value.model.getVersionId() !== change.expectedVersion) {
        throw new PluginApiError("DOCUMENT_CHANGED", "O documento mudou desde a leitura do plugin.");
      }
      if (value.model.getValue() === change.text) return;
      const instance = value.state.instance!;
      instance.pushUndoStop();
      const applied = instance.executeEdits("corant-plugin", [{ range: value.model.getFullModelRange(), text: change.text, forceMoveMarkers: true }]);
      instance.pushUndoStop();
      if (!applied) throw new PluginApiError("DOCUMENT_CHANGED", "Não foi possível aplicar a edição do plugin.");
    },
  };
}
