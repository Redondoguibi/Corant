import type { editor } from "monaco-editor";

export async function runEditorCommand(instance: editor.IStandaloneCodeEditor, command: string) {
  instance.focus();
  if (command === "paste" || command === "copy" || command === "cut") {
    const model = instance.getModel();
    const selections = instance.getSelections();
    if (!model || !selections) return;
    const version = model.getVersionId();
    // Empty selections copy/cut the current line, as in the editor's own menu.
    const ranges = selections.map((selection) => selection.isEmpty() && command !== "paste" ? {
      startLineNumber: selection.startLineNumber,
      startColumn: 1,
      endLineNumber: Math.min(selection.startLineNumber + 1, model.getLineCount()),
      endColumn: selection.startLineNumber < model.getLineCount() ? 1 : model.getLineMaxColumn(selection.startLineNumber),
    } : selection);
    const text = command === "paste" ? await navigator.clipboard.readText() : "";
    if (command !== "paste") {
      await navigator.clipboard.writeText(ranges.map((range) => model.getValueInRange(range)).join(model.getEOL()));
    }
    if (command !== "copy") {
      // Clipboard access is asynchronous; never edit another file after a tab switch.
      if (instance.getModel() !== model || model.isDisposed() || model.getVersionId() !== version) return;
      instance.pushUndoStop();
      instance.executeEdits("workspace-menu", ranges.map((range) => ({ range, text, forceMoveMarkers: true })));
      instance.pushUndoStop();
    }
    return;
  }
  const action = instance.getAction(command);
  if (action) await action.run();
  else instance.trigger("workspace-menu", command, null);
}
