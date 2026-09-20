import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type EditorLocation = {
  lineNumber: number;
  column: number;
};

type MonacoEditorProps = {
  path: string;
  value: string;
  language: string;
  onChange: (value: string) => void;
  targetLocation?: EditorLocation;
  onReady: (instance: editor.IStandaloneCodeEditor | null) => void;
  wordWrap: boolean;
  minimap: boolean;
  readOnly: boolean;
};

export function MonacoEditor({
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

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;
    onReady(editorInstance);

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
      theme="vs-dark"
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
