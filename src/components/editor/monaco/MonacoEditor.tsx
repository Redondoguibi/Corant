import type { ThemeId } from "../../../plugins/api";
import { themes } from "../../../plugins/themes";
import { useEffect, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type EditorLocation = {
  lineNumber: number;
  column: number;
};

type MonacoEditorProps = {
  theme?: ThemeId;
  path: string;
  value: string;
  language: string;
  onChange: (value: string) => void;
  targetLocation?: EditorLocation;
  onReady: (instance: editor.IStandaloneCodeEditor | null, monaco?: Monaco) => void;
  wordWrap: boolean;
  minimap: boolean;
  readOnly: boolean;
};

export function MonacoEditor({
  theme = "crimson",
  path,
  value,
  language,
  onChange,
  targetLocation,
  onReady,
  wordWrap,
  minimap,
  readOnly,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  function revealTarget(editorInstance: editor.IStandaloneCodeEditor) {
    if (!targetLocation) return;

    const model = editorInstance.getModel();
    const requestedLine = Math.max(1, targetLocation.lineNumber);
    const lineNumber = model
      ? Math.min(requestedLine, model.getLineCount())
      : requestedLine;
    const requestedColumn = Math.max(1, targetLocation.column);
    const column = model
      ? Math.min(requestedColumn, model.getLineMaxColumn(lineNumber))
      : requestedColumn;

    editorInstance.setPosition({ lineNumber, column });
    editorInstance.revealPositionInCenter({ lineNumber, column });
    editorInstance.focus();
  }

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    onReady(editorInstance, monaco);

    if (targetLocation) {
      revealTarget(editorInstance);
    } else {
      editorInstance.focus();
    }
  };

  useEffect(() => () => onReady(null), [onReady]);

  useEffect(() => {
    if (!targetLocation) return;

    const frame = window.requestAnimationFrame(() => {
      if (editorRef.current) {
        revealTarget(editorRef.current);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [targetLocation]);

  return (
    <Editor
      path={path}
      keepCurrentModel
      height="100%"
      theme={"corant-" + theme}
      beforeMount={(monaco) => { for (const item of themes) monaco.editor.defineTheme("corant-" + item.id, { base: item.id === "dawn" ? "vs" : "vs-dark", inherit: true, rules: [], colors: { "editor.background": item.background, "editor.foreground": item.foreground } }); }}
      language={language}
      value={value}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      onMount={handleMount}
      options={
        {
          automaticLayout: true,
          contextmenu: true,
          minimap: { enabled: minimap },
          readOnly,
          fontSize: 14,
          lineHeight: 22,
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          wordWrap: wordWrap ? "on" : "off",
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          guides: {
            indentation: true,
          },
          suggest: {
            showMethods: true,
            showFunctions: true,
            showVariables: true,
          },
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
        } satisfies editor.IStandaloneEditorConstructionOptions
      }
    />
  );
}
