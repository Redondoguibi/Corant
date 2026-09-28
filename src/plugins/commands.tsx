import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BuiltinPlugin, PluginContext } from "./api";
import { ExportDocuments } from "./commandExportPanel";
import { buildFileTree, buildInventory, commandTools, transformText, type TextOptions, type ToolId, type TreeFormat } from "./commandTools";

type Result = { text: string; summary?: string };
type Navigation = ReturnType<typeof createNavigation>;
function createNavigation() {
  let snapshot: { tool: ToolId | null; revision: number } = { tool: null, revision: 0 };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open: (tool: ToolId | null) => { snapshot = { tool, revision: snapshot.revision + 1 }; listeners.forEach((listener) => listener()); },
  };
}
function selectedFolder(api: PluginContext) {
  const selected = api.files.getSelection();
  return !selected ? "" : selected.kind === "directory" ? selected.path : selected.path.split("/").slice(0, -1).join("/");
}

function ResultActions({ api, result, name, extension: initialExtension }: { api: PluginContext; result: Result; name: string; extension: string }) {
  const [filename, setFilename] = useState(name);
  const [extension, setExtension] = useState(initialExtension);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setMessage("");
    if (!filename.trim() || !/^[a-zA-Z0-9]{1,16}$/.test(extension)) { setMessage("Informe um nome e uma extensão de até 16 letras ou números, sem o ponto."); return; }
    setBusy(true);
    try { const output = `${filename.trim()}.${extension.toLowerCase()}`; await api.files.exportText(output, result.text); setMessage(`Criado na raiz do projeto: ${output}`); }
    catch (cause) { setMessage(String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="commands-result" aria-label="Resultado da ferramenta">
    <h3>Resultado</h3>{result.summary && <p>{result.summary}</p>}
    <textarea aria-label="Resultado" readOnly value={result.text} rows={10} spellCheck={false} />
    <button disabled={busy} onClick={() => void navigator.clipboard.writeText(result.text).then(() => setMessage("Resultado copiado.")).catch(() => setMessage("Não foi possível copiar o resultado."))}>Copiar resultado</button>
    <div className="commands-output-name"><label>Nome do arquivo<input maxLength={140} disabled={busy} value={filename} onChange={(e) => { setFilename(e.target.value); setMessage(""); }} /></label>
      <label>Extensão<input aria-label="Extensão do arquivo" maxLength={16} disabled={busy} value={extension} onChange={(e) => { setExtension(e.target.value); setMessage(""); }} /></label></div>
    <small>A extensão é independente do formato do conteúdo. Será criado um arquivo novo na raiz do projeto.</small>
    <button className="plugin-primary" disabled={busy} onClick={() => void save()}>Salvar no projeto</button>
    {message && <p role="status">{message}</p>}
  </section>;
}

function FolderTool({ api, tool }: { api: PluginContext; tool: "tree" | "inventory" }) {
  const [files, setFiles] = useState(() => api.files.list());
  const [folder, setFolder] = useState(() => selectedFolder(api));
  const [treeFormat, setTreeFormat] = useState<TreeFormat>("visual");
  const [inventoryFormat, setInventoryFormat] = useState<"csv" | "json">("csv");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const invalidate = () => { setResult(null); setError(""); };
  async function generate() {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); invalidate();
    try {
      const currentFiles = await api.files.scan();
      if (controller.signal.aborted) return;
      setFiles(currentFiles);
      setResult(tool === "tree" ? buildFileTree(currentFiles, folder, api.workspace.getInfo().name, treeFormat) : buildInventory(currentFiles, folder, inventoryFormat));
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); operation.current = null; }
  }
  return <>
    <fieldset disabled={busy}>
      <label>Pasta de origem<select value={folder} onChange={(e) => { setFolder(e.target.value); invalidate(); }}><option value="">Raiz do projeto</option>{files.filter((file) => file.kind === "directory").map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label>
      <button onClick={() => { setFiles(api.files.list()); setFolder(selectedFolder(api)); invalidate(); }}>Usar pasta selecionada no Explorer</button>
      {tool === "tree" ? <label>Tipo de árvore<select value={treeFormat} onChange={(e) => { setTreeFormat(e.target.value as TreeFormat); invalidate(); }}><option value="visual">Visual (├── / └──)</option><option value="markdown">Markdown</option><option value="json">JSON</option></select></label>
        : <label>Formato do inventário<select value={inventoryFormat} onChange={(e) => { setInventoryFormat(e.target.value as "csv" | "json"); invalidate(); }}><option value="csv">CSV (planilha)</option><option value="json">JSON</option></select></label>}
      <small>Inclui subpastas e pastas vazias, sem ler o conteúdo dos arquivos. Links simbólicos não são percorridos.</small>
      <button className="plugin-primary" onClick={() => void generate()}>Gerar prévia</button>
    </fieldset>
    {busy && <p role="status">Lendo a pasta…</p>}{error && <p role="alert">{error}</p>}
    {result && <ResultActions api={api} result={result} name={tool === "tree" ? "arvore" : "inventario"} extension={tool === "tree" ? ({ visual: "txt", markdown: "md", json: "json" })[treeFormat] : inventoryFormat} />}
  </>;
}

function TextTool({ api, tool }: { api: PluginContext; tool: ToolId }) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<TextOptions>({ letterCase: "upper", descending: false, ignoreCase: false, find: "", replacement: "" });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const invalidate = () => { setResult(null); setError(""); };
  function configure(patch: Partial<TextOptions>) { setOptions((value) => ({ ...value, ...patch })); invalidate(); }
  function importDocument() {
    try { const document = api.editor.getActiveDocument(); if (!document) throw new Error("Abra um arquivo de texto no editor primeiro."); setInput(document.text); invalidate(); }
    catch (cause) { setError(String(cause)); }
  }
  function generate() {
    invalidate();
    try { setResult({ text: transformText(tool, input, options) }); } catch (cause) { setError(String(cause)); }
  }
  return <>
    <button onClick={importDocument}>Usar texto do arquivo aberto</button>
    <label>Texto de entrada<textarea rows={8} maxLength={1_048_576} value={input} onChange={(e) => { setInput(e.target.value); invalidate(); }} placeholder="Cole ou escreva seu texto aqui…" /></label>
    {tool === "case" && <label>Capitalização<select value={options.letterCase} onChange={(e) => configure({ letterCase: e.target.value as TextOptions["letterCase"] })}><option value="upper">MAIÚSCULAS</option><option value="lower">minúsculas</option><option value="title">Iniciais Maiúsculas</option></select></label>}
    {tool === "sort" && <label><input type="checkbox" checked={options.descending} onChange={(e) => configure({ descending: e.target.checked })} />Ordem decrescente</label>}
    {tool === "unique" && <label><input type="checkbox" checked={options.ignoreCase} onChange={(e) => configure({ ignoreCase: e.target.checked })} />Ignorar maiúsculas e minúsculas</label>}
    {tool === "replace" && <><label>Localizar<input value={options.find} maxLength={10000} onChange={(e) => configure({ find: e.target.value })} /></label><label>Substituir por<input value={options.replacement} maxLength={10000} onChange={(e) => configure({ replacement: e.target.value })} /></label><small>Substituição literal de todas as ocorrências, diferenciando maiúsculas e minúsculas.</small></>}
    {tool === "clean" && <small>Remove a indentação das linhas e mantém no máximo uma linha vazia entre parágrafos.</small>}
    <button className="plugin-primary" onClick={generate}>Gerar resultado</button>
    {error && <p role="alert">{error}</p>}
    {result && <ResultActions api={api} result={result} name={tool === "checklist" ? "checklist" : "resultado"} extension={tool === "checklist" ? "md" : "txt"} />}
  </>;
}

function Commands({ api, navigation }: { api: PluginContext; navigation: Navigation }) {
  const { tool: selected, revision } = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  const [search, setSearch] = useState("");
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const tools = commandTools.filter((tool) => normalize(`${tool.name} ${tool.description} ${tool.category}`).includes(normalize(search)));
  const tool = commandTools.find((item) => item.id === selected);
  return <div className="plugin-content commands-content">
    {tool ? <>
      <button className="commands-back" onClick={() => navigation.open(null)}>← Todas as ferramentas</button>
      <header className="commands-heading"><small>{tool.category}</small><h2>{tool.name}</h2><p>{tool.description}</p></header>
      <div className="commands-tool" key={revision}>
        {tool.id === "merge" ? <ExportDocuments api={api} /> : tool.id === "tree" || tool.id === "inventory" ? <FolderTool api={api} tool={tool.id} /> : <TextTool api={api} tool={tool.id} />}
      </div>
    </> : <>
      <header className="commands-heading"><h2>Ferramentas do dia a dia</h2><p>Organize arquivos, prepare documentos e transforme textos.</p><small>10 ferramentas · processamento local</small></header>
      <label>Buscar ferramenta<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pastas, listas, texto…" /></label>
      <div className="commands-catalog" aria-label="Ferramentas disponíveis">{tools.map((item) => <button className="commands-card" key={item.id} onClick={() => navigation.open(item.id)}>
        <span className="commands-category">{item.category}</span><strong>{item.name}</strong><span>{item.description}</span>
      </button>)}</div>
      {!tools.length && <p role="status">Nenhuma ferramenta encontrada.</p>}
    </>}
  </div>;
}
const permissions = ["commands.register", "settings.read", "settings.write", "ui.panel", "workspace.read", "editor.read", "files.read", "files.export"] as const;
export const commandsPlugin: BuiltinPlugin = { grants: permissions, definition: {
  manifest: { id: "corant.commands", name: "Commands", version: "1.0.0", apiVersion: 1, permissions,
    commands: [{ id: "corant.commands.open", title: "Commands — ferramentas" }, { id: "corant.commands.tree", title: "Commands — exportar árvore de pastas" }] },
  activate(api) {
    const navigation = createNavigation();
    api.ui.registerPanel({ title: "Commands", render: () => <Commands api={api} navigation={navigation} /> });
    api.commands.register("corant.commands.open", () => { navigation.open(null); api.ui.openPanel(); });
    api.commands.register("corant.commands.tree", () => { navigation.open("tree"); api.ui.openPanel(); });
  },
} };
