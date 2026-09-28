import type { PluginFile } from "./api";

export const commandTools = [
  { id: "tree", name: "Exportar árvore de pastas", category: "Arquivos", description: "Transforme uma pasta em uma árvore visual, Markdown ou JSON." },
  { id: "merge", name: "Juntar documentos", category: "Arquivos", description: "Reúna o conteúdo de vários arquivos de texto em um documento." },
  { id: "inventory", name: "Inventário de arquivos", category: "Arquivos", description: "Liste caminhos e tipos para organizar, conferir ou abrir em uma planilha." },
  { id: "checklist", name: "Criar checklist", category: "Organização", description: "Transforme uma lista de tarefas em caixas de seleção Markdown." },
  { id: "statistics", name: "Contar texto", category: "Texto", description: "Conte palavras, caracteres, linhas e parágrafos." },
  { id: "case", name: "Maiúsculas e minúsculas", category: "Texto", description: "Altere a capitalização de títulos, listas ou documentos." },
  { id: "clean", name: "Limpar espaços", category: "Texto", description: "Remova espaços nas bordas das linhas e linhas vazias repetidas." },
  { id: "sort", name: "Ordenar linhas", category: "Texto", description: "Organize listas em ordem alfabética, com números em ordem natural." },
  { id: "unique", name: "Remover linhas duplicadas", category: "Texto", description: "Mantenha a primeira ocorrência de cada item da lista." },
  { id: "replace", name: "Localizar e substituir", category: "Texto", description: "Troque um trecho em todo o texto, sem alterar o arquivo original." },
] as const;
export type ToolId = typeof commandTools[number]["id"];
export type TreeFormat = "visual" | "markdown" | "json";
type TreeNode = { name: string; type: "file" | "directory"; children?: TreeNode[] };
const compare = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }) || a.localeCompare(b, "pt-BR");
const markdown = (name: string) => name.replace(/[\\`*_{}\[\]<>()#+.!|~-]/g, "\\$&");
const visibleName = (name: string) => name.replace(/[\r\n\t]/g, (value) => ({ "\r": "\\r", "\n": "\\n", "\t": "\\t" })[value]!);

export function folderEntries(files: readonly PluginFile[], folder: string) {
  if (folder && !files.some((file) => file.path === folder && file.kind === "directory")) throw new Error("A pasta não existe mais. Atualize a seleção.");
  const entries = files.filter((file) => !folder || file.path.startsWith(folder + "/"));
  if (entries.length > 10_000) throw new Error("Esta pasta excede 10.000 itens. Escolha uma subpasta.");
  return entries;
}

export function buildFileTree(files: readonly PluginFile[], folder: string, projectName: string, format: TreeFormat) {
  const entries = folderEntries(files, folder);
  const root: TreeNode = { name: folder.split("/").pop() || projectName, type: "directory", children: [] };
  const nodes = new Map<string, TreeNode>([["", root]]);
  for (const entry of entries) {
    const parts = (folder ? entry.path.slice(folder.length + 1) : entry.path).split("/");
    if (parts.length > 100 || parts.some((part) => !part || part === "." || part === "..")) throw new Error("A árvore contém um caminho inválido ou profundo demais.");
    let parent = root;
    let key = "";
    parts.forEach((name, index) => {
      key = key ? key + "/" + name : name;
      let node = nodes.get(key);
      if (!node) {
        const directory = index < parts.length - 1 || entry.kind === "directory";
        node = { name, type: directory ? "directory" : "file", ...(directory ? { children: [] } : {}) };
        if (!parent.children) throw new Error("A árvore contém caminhos conflitantes.");
        parent.children.push(node);
        nodes.set(key, node);
      }
      parent = node;
    });
  }
  const order = (node: TreeNode) => {
    node.children?.sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || compare(a.name, b.name));
    node.children?.forEach(order);
  };
  order(root);
  let text: string;
  if (format === "json") text = JSON.stringify(root, null, 2);
  else {
    const lines = [format === "markdown" ? `- **${markdown(visibleName(root.name))}/**` : visibleName(root.name) + "/"];
    const visit = (node: TreeNode, prefix: string, depth: number) => node.children?.forEach((child, index, children) => {
      const last = index === children.length - 1;
      const label = visibleName(child.name) + (child.type === "directory" ? "/" : "");
      lines.push(format === "markdown"
        ? "  ".repeat(depth + 1) + "- " + (child.type === "directory" ? `**${markdown(label)}**` : markdown(label))
        : prefix + (last ? "└── " : "├── ") + label);
      visit(child, prefix + (last ? "    " : "│   "), depth + 1);
    });
    visit(root, "", 0);
    text = lines.join("\n");
  }
  return { text: text + "\n", summary: `${entries.filter((entry) => entry.kind === "file").length} arquivo(s) · ${entries.filter((entry) => entry.kind === "directory").length} subpasta(s)` };
}

function csvCell(value: string) {
  // Keep filenames beginning with spreadsheet operators as literal text.
  const literal = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + literal.replaceAll('"', '""') + '"';
}
export function buildInventory(files: readonly PluginFile[], folder: string, format: "csv" | "json") {
  const entries = folderEntries(files, folder).sort((a, b) => compare(a.path, b.path));
  const rows = entries.map((file) => {
    const name = file.path.split("/").pop()!;
    return { caminho: folder ? file.path.slice(folder.length + 1) : file.path, tipo: file.kind === "directory" ? "pasta" : "arquivo",
      extensao: file.kind === "file" && name.includes(".") && !name.startsWith(".") ? name.split(".").pop()!.toLowerCase() : "" };
  });
  return { text: format === "json" ? JSON.stringify(rows, null, 2) + "\n"
    : "caminho,tipo,extensao\r\n" + rows.map((row) => Object.values(row).map(csvCell).join(",")).join("\r\n") + (rows.length ? "\r\n" : ""),
    summary: `${rows.length} item(ns) · caminhos relativos à pasta escolhida` };
}

export type TextOptions = { letterCase: "upper" | "lower" | "title"; descending: boolean; ignoreCase: boolean; find: string; replacement: string };
export function transformText(tool: ToolId, input: string, options: TextOptions): string {
  if (new TextEncoder().encode(input).length > 1024 * 1024) throw new Error("Use até 1 MiB de texto por operação.");
  const text = input.replace(/\r\n?/g, "\n");
  const trailingNewline = text.endsWith("\n");
  const lines = text ? (trailingNewline ? text.slice(0, -1) : text).split("\n") : [];
  switch (tool) {
    case "statistics": return [
      `Palavras: ${(text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length}`,
      `Caracteres (Unicode): ${Array.from(text).length}`,
      `Caracteres sem espaços: ${Array.from(text.replace(/\s/gu, "")).length}`,
      `Linhas: ${lines.length}`,
      `Parágrafos: ${text.trim() ? text.trim().split(/\n\s*\n/).length : 0}`,
    ].join("\n");
    case "case": return options.letterCase === "upper" ? text.toLocaleUpperCase("pt-BR") : options.letterCase === "lower" ? text.toLocaleLowerCase("pt-BR")
      : text.toLocaleLowerCase("pt-BR").replace(/(^|\s)(\S)/gu, (_, space: string, char: string) => space + char.toLocaleUpperCase("pt-BR"));
    case "clean": return lines.map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    case "sort": return [...lines].sort((a, b) => compare(a, b) * (options.descending ? -1 : 1)).join("\n") + (trailingNewline ? "\n" : "");
    case "unique": {
      const seen = new Set<string>();
      return lines.filter((line) => { const key = options.ignoreCase ? line.toLocaleLowerCase("pt-BR") : line; if (seen.has(key)) return false; seen.add(key); return true; }).join("\n") + (trailingNewline ? "\n" : "");
    }
    case "replace":
      if (!options.find) throw new Error("Informe o texto que deseja localizar.");
      { const parts = text.split(options.find.replace(/\r\n?/g, "\n"));
        if (text.length + (parts.length - 1) * options.replacement.length > 4 * 1024 * 1024) throw new Error("O resultado excederia 4 MiB. Reduza a substituição.");
        return parts.join(options.replacement); }
    case "checklist": return lines.map((line) => line.trim().replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, ""))
      .filter(Boolean).map((line) => `- [ ] ${line}`).join("\n");
    default: throw new Error("Esta ferramenta não transforma texto.");
  }
}
