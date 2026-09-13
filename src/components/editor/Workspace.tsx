import { useMemo, useState } from "react";
import { MonacoEditor } from "./monaco/MonacoEditor";

type WorkspaceProps = {
  projectName: string;
  onBackToHome: () => void;
};

type FileEntry = {
  name: string;
  language: string;
  content: string;
};

const initialFiles: FileEntry[] = [
  {
    name: "main.ts",
    language: "typescript",
    content: `function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("Corant"));\n`,
  },
  {
    name: "README.md",
    language: "markdown",
    content: "# Meu projeto\n\nComece a editar seu projeto no Corant.\n",
  },
  {
    name: "config.json",
    language: "json",
    content: `{\n  "name": "meu-projeto",\n  "version": "1.0.0"\n}\n`,
  },
  {
    name: "styles.css",
    language: "css",
    content: `body {\n  margin: 0;\n  font-family: sans-serif;\n}\n`,
  },
];

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
      return "<>";
    default:
      return "•";
  }
}

export function Workspace({ projectName, onBackToHome }: WorkspaceProps) {
  const [files, setFiles] = useState(initialFiles);
  const [activeFileName, setActiveFileName] = useState(initialFiles[0].name);
  const sidebarWidth = 248;

  const activeFile = useMemo(
    () => files.find((file) => file.name === activeFileName) ?? files[0],
    [activeFileName, files],
  );

  function updateActiveFile(value: string) {
    setFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.name === activeFileName ? { ...file, content: value } : file,
      ),
    );
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-titlebar">
        <div className="workspace-brand">
          <button className="workspace-back-button" type="button" onClick={onBackToHome}>
            ‹
          </button>
          <span className="workspace-brand-name">Corant</span>
          <span className="workspace-separator">/</span>
          <span className="workspace-project-name">{projectName}</span>
        </div>

        <div className="workspace-titlebar-center">Local workspace</div>

        <div className="workspace-titlebar-actions">
          <span className="save-indicator">● Salvo</span>
        </div>
      </header>

      <div className="workspace-menubar">
        <button type="button">Arquivo</button>
        <button type="button">Editar</button>
        <button type="button">Seleção</button>
        <button type="button">Exibir</button>
        <button type="button">Executar</button>
        <button type="button">Terminal</button>
        <button type="button">Ajuda</button>
      </div>

      <section className="workspace-body">
        <aside className="workspace-sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-heading">
            <span>EXPLORADOR</span>
            <div className="sidebar-heading-actions">
              <button type="button" aria-label="Novo arquivo">+</button>
              <button type="button" aria-label="Mais ações">•••</button>
            </div>
          </div>

          <div className="project-tree">
            <div className="tree-project-name">⌄ {projectName}</div>
            <div className="tree-files">
              {files.map((file) => (
                <button
                  key={file.name}
                  className={`tree-file ${file.name === activeFileName ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setActiveFileName(file.name)}
                >
                  <span className="file-icon">{getFileIcon(file.name)}</span>
                  <span>{file.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-footer">
            <span>4 arquivos</span>
            <span>Local</span>
          </div>
        </aside>

        <div className="workspace-sidebar-resizer" aria-hidden="true" />

        <section className="workspace-editor-area">
          <div className="editor-tabs">
            {files.map((file) => (
              <button
                key={file.name}
                className={`editor-tab ${file.name === activeFileName ? "is-active" : ""}`}
                type="button"
                onClick={() => setActiveFileName(file.name)}
              >
                <span className="file-icon">{getFileIcon(file.name)}</span>
                <span>{file.name}</span>
                {file.name === activeFileName && <span className="tab-dot" />}
              </button>
            ))}
          </div>

          <div className="editor-toolbar">
            <div className="editor-breadcrumbs">
              <span>{projectName}</span>
              <span>/</span>
              <span>{activeFile.name}</span>
            </div>
            <div className="editor-toolbar-actions">
              <span>Ln 1, Col 1</span>
              <span>{activeFile.language}</span>
              <span>UTF-8</span>
            </div>
          </div>

          <div className="monaco-host">
            <MonacoEditor
              value={activeFile.content}
              language={activeFile.language}
              onChange={updateActiveFile}
            />
          </div>

          <footer className="workspace-statusbar">
            <div className="status-left">
              <span>main</span>
              <span>✓</span>
              <span>0 erros</span>
            </div>
            <div className="status-right">
              <span>Spaces: 2</span>
              <span>UTF-8</span>
              <span>{activeFile.language}</span>
            </div>
          </footer>
        </section>
      </section>
    </main>
  );
}
