import { useEffect, useRef, useState } from "react";
import type { BuiltinPlugin, JsonValue, PluginContext } from "./api";
import { buildExport, validateRecipe, type ExportFormat, type ExportRecipe } from "./commandExport";

const fresh = (): ExportRecipe => ({ id: crypto.randomUUID(), name: "", folder: "", paths: [], format: "md", includeContents: true, outputName: "exportacao" });
function Commands({ api }: { api: PluginContext }) {
  const [recipes, setRecipes] = useState<ExportRecipe[]>(() => { const saved = api.settings.get("recipes"); return Array.isArray(saved) ? (saved as unknown[]).filter(validateRecipe) : []; });
  const [recipe, setRecipe] = useState(fresh);
  const [files, setFiles] = useState(() => api.files.list());
  const [preview, setPreview] = useState<{ text: string; count: number; filename: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const update = (patch: Partial<ExportRecipe>) => { setRecipe((old) => ({ ...old, ...patch })); setPreview(null); setMessage(""); };
  function saveRecipe() {
    try {
      if (!recipe.name.trim()) throw new Error("Dê um nome ao comando.");
      const next = [...recipes.filter((item) => item.id !== recipe.id), { ...recipe, name: recipe.name.trim() }];
      if (next.length > 30) throw new Error("Limite de 30 comandos por projeto.");
      api.settings.set("recipes", next as unknown as JsonValue); setRecipes(next); setMessage("Comando salvo.");
    } catch (cause) { setMessage(String(cause)); }
  }
  async function generate() {
    const controller = new AbortController(); operation.current = controller; setBusy(true); setPreview(null); setMessage("");
    try {
      const currentFiles = api.files.list(); setFiles(currentFiles);
      const result = await buildExport(recipe, currentFiles, api.files.readText, controller.signal);
      if (!controller.signal.aborted) setPreview({ ...result, filename: `${recipe.outputName}.${recipe.format}` });
    } catch (cause) { if (!controller.signal.aborted) setMessage(String(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function exportPreview() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try { await api.files.exportText(preview.filename, preview.text); setMessage(`Criado na raiz do projeto: ${preview.filename}`); }
    catch (cause) { setMessage(String(cause)); }
    finally { setBusy(false); }
  }
  const visible = files.filter((file) => !recipe.folder || file.path.startsWith(recipe.folder + "/"));
  return <div className="plugin-content"><p>Transforme arquivos selecionados em um documento reutilizando configurações salvas.</p>
    <fieldset disabled={busy}>
      <label>Comandos salvos<select value={recipes.some((item) => item.id === recipe.id) ? recipe.id : ""} onChange={(e) => { setRecipe(recipes.find((item) => item.id === e.target.value) ?? fresh()); setPreview(null); setMessage(""); }}>
        <option value="">Novo comando</option>{recipes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Nome do comando<input value={recipe.name} maxLength={100} onChange={(e) => update({ name: e.target.value })} /></label>
      <label>Pasta inicial<select value={recipe.folder} onChange={(e) => update({ folder: e.target.value, paths: [] })}>
        <option value="">Raiz do projeto</option>{files.filter((f) => f.kind === "directory").map((f) => <option key={f.path}>{f.path}</option>)}
      </select></label>
      <div className="plugin-button-row"><button onClick={() => { setFiles(api.files.list()); setPreview(null); }}>Atualizar lista</button>
        <button onClick={() => update({ paths: visible.filter((f) => f.kind === "file").slice(0, 500).map((f) => f.path) })}>Selecionar arquivos</button><button onClick={() => update({ paths: [] })}>Limpar</button></div>
      <div className="plugin-file-list" role="group" aria-label="Arquivos para exportar">{visible.map((file) => <label key={file.path}>
        <input type="checkbox" checked={recipe.paths.includes(file.path)} onChange={(e) => update({ paths: e.target.checked ? [...recipe.paths, file.path] : recipe.paths.filter((p) => p !== file.path) })} />
        {file.kind === "directory" ? "▱ " : ""}{file.path}
      </label>)}</div>
      <label>Formato<select value={recipe.format} onChange={(e) => update({ format: e.target.value as ExportFormat })}><option value="md">Markdown</option><option value="txt">Texto</option><option value="json">JSON</option></select></label>
      <label className="plugin-check"><input type="checkbox" checked={recipe.includeContents} onChange={(e) => update({ includeContents: e.target.checked })} />Incluir conteúdo dos arquivos</label>
      <label>Nome da exportação<input value={recipe.outputName} onChange={(e) => update({ outputName: e.target.value })} /><small>Será criado {recipe.outputName || "…"}.{recipe.format} na raiz do projeto, sem substituir arquivos.</small></label>
      <div className="plugin-button-row"><button onClick={saveRecipe}>Salvar comando</button><button onClick={() => { const next = recipes.filter((item) => item.id !== recipe.id); try { api.settings.set("recipes", next as unknown as JsonValue); setRecipes(next); setRecipe(fresh()); setPreview(null); } catch (e) { setMessage(String(e)); } }}>Excluir comando</button></div>
      <button className="plugin-primary" onClick={() => void generate()}>Gerar prévia</button>
    </fieldset>
    {busy && <p role="status">Processando…</p>}
    {preview && <><p>{preview.count} arquivo(s)</p><textarea aria-label="Prévia da exportação" readOnly value={preview.text} rows={10} /><button disabled={busy} onClick={() => void exportPreview()}>Salvar no projeto</button></>}
    {message && <p role="status">{message}</p>}
  </div>;
}
const permissions = ["commands.register", "settings.read", "settings.write", "ui.panel", "files.read", "files.export"] as const;
export const commandsPlugin: BuiltinPlugin = { grants: permissions, definition: {
  manifest: { id: "corant.commands", name: "Commands", version: "1.0.0", apiVersion: 1, permissions,
    commands: [{ id: "corant.commands.open", title: "Commands — exportar arquivos" }] },
  activate(api) { api.ui.registerPanel({ title: "Commands", render: () => <Commands api={api} /> }); api.commands.register("corant.commands.open", () => api.ui.openPanel()); },
} };
