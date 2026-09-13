import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type MonacoEditorProps = {
  value: string;
  language: string;
  onChange: (value: string) => void;
};

export function MonacoEditor({ value, language, onChange }: MonacoEditorProps) {
  const handleMount: OnMount = (editorInstance) => {
    editorInstance.focus();
  };

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
