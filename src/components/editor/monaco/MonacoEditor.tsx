import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type EditorLocation = {
  lineNumber: number;
  column: number;
};

type MonacoEditorProps = {
  value: string;
  language: string;
  onChange: (value: string) => void;
  targetLocation?: EditorLocation;
};

export function MonacoEditor({
  value,
  language,
  onChange,
  targetLocation,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  function revealTarget(editorInstance: editor.IStandaloneCodeEditor) {
    if (!targetLocation) return;

    const lineNumber = Math.max(1, targetLocation.lineNumber);
    const column = Math.max(1, targetLocation.column);

    editorInstance.setPosition({ lineNumber, column });
    editorInstance.revealPositionInCenter({ lineNumber, column });
    editorInstance.focus();
  }

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;

    if (targetLocation) {
      revealTarget(editorInstance);
    } else {
      editorInstance.focus();
    }
  };

  useEffect(() => {
    if (!editorRef.current || !targetLocation) return;
    revealTarget(editorRef.current);
  }, [targetLocation]);

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={language}
      value={value}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      onMount={handleMount}
      options={
        {
          automaticLayout: true,
          minimap: { enabled: true },
          fontSize: 14,
          lineHeight: 22,
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          wordWrap: "off",
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
