export function activate(api, { React }) {
  function WordCountPanel() {
    const [document, setDocument] = React.useState(() => api.editor.getActiveDocument());
    React.useEffect(() => {
      const subscription = api.editor.onDidChangeActiveDocument(setDocument);
      return () => subscription.dispose();
    }, []);
    const count = document?.text.trim().split(/\s+/u).filter(Boolean).length ?? 0;
    const message = document
      ? `${count} palavras em ${document.path}`
      : "Nenhum documento de texto ativo.";
    return React.createElement("p", { className: "plugin-content" }, message);
  }
  api.ui.registerPanel({
    title: "Contagem de palavras",
    render: () => React.createElement(WordCountPanel),
  });
  api.commands.register("example.word-count.show", () => api.ui.openPanel());
}
