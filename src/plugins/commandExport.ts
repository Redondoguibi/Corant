import type { PluginFile } from "./api";
export type ExportFormat = "md" | "txt" | "json";
export interface ExportRecipe { id: string; name: string; folder: string; paths: string[]; format: ExportFormat; includeContents: boolean; outputName: string }
export function validateRecipe(value: unknown): value is ExportRecipe {
  const r = value as ExportRecipe;
  return !!r && typeof r.id === "string" && typeof r.name === "string" && r.name.length > 0 && r.name.length <= 100
    && typeof r.folder === "string" && Array.isArray(r.paths) && r.paths.length <= 500 && r.paths.every((p) => typeof p === "string")
    && ["md", "txt", "json"].includes(r.format) && typeof r.includeContents === "boolean" && typeof r.outputName === "string";
}
export async function buildExport(recipe: ExportRecipe, files: readonly PluginFile[], read: (path: string) => Promise<string>, signal: AbortSignal) {
  const matches = (path: string, selected: string) => path === selected || path.startsWith(selected + "/");
  const chosen = files.filter((file) => file.kind === "file" && (!recipe.folder || matches(file.path, recipe.folder))
    && recipe.paths.some((selection) => matches(file.path, selection))).sort((a, b) => a.path.localeCompare(b.path));
  if (!chosen.length) throw new Error("Selecione pelo menos um arquivo ou uma pasta com arquivos.");
  if (chosen.length > 500) throw new Error("Limite de 500 arquivos por exportação.");
  const rows: { path: string; content?: string }[] = [];
  let size = 0;
  for (const file of chosen) {
    if (signal.aborted) throw new Error("Exportação cancelada.");
    let content: string | undefined;
    if (recipe.includeContents) {
      try { content = await read(file.path); } catch (cause) { throw new Error(`${file.path}: ${String(cause)}`); }
    }
    size += new TextEncoder().encode(file.path + (content ?? "")).byteLength;
    if (size > 4 * 1024 * 1024) throw new Error("Conteúdo excede 4 MiB. Selecione menos arquivos.");
    rows.push({ path: file.path, ...(content === undefined ? {} : { content }) });
  }
  if (signal.aborted) throw new Error("Exportação cancelada.");
  let text: string;
  if (recipe.format === "json") text = JSON.stringify(rows, null, 2) + "\n";
  else text = rows.map(({ path, content }) => {
    if (recipe.format === "txt") return content === undefined ? path : `=== ${path} ===\n${content}`;
    if (content === undefined) return `- ${path}`;
    const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2);
    const fence = "`".repeat(longest + 1);
    return `## ${path}\n\n${fence}\n${content}\n${fence}`;
  }).join("\n\n") + "\n";
  if (new TextEncoder().encode(text).byteLength > 8 * 1024 * 1024) throw new Error("Exportação excede 8 MiB.");
  return { text, count: rows.length };
}
