import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

async function catalog(page: Page) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Executar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Commands — ferramentas", exact: true }).click();
}
test.beforeEach(async ({ page }) => setupWorkspace(page));

test("Commands exposes ten searchable everyday tools", async ({ page }, info) => {
  await catalog(page);
  await expect(page.locator(".commands-card")).toHaveCount(10);
  await page.screenshot({ path: info.outputPath("commands-catalog.png") });
  await page.getByLabel("Buscar ferramenta").fill("arvore");
  await expect(page.locator(".commands-card")).toHaveCount(1);
  await page.getByRole("button", { name: /Exportar árvore de pastas/ }).click();
  await expect(page.getByLabel("Pasta de origem")).toHaveValue("");
  await page.getByRole("button", { name: "← Todas as ferramentas" }).click();
  await page.getByLabel("Buscar ferramenta").fill("inexistente");
  await expect(page.getByRole("status")).toContainText("Nenhuma ferramenta");
});

test("Explorer selection exports a complete nested tree with independent extension", async ({ page }, info) => {
  await page.evaluate(() => {
    const state = (window as any).testState;
    state.directories.push("/project/design", "/project/design/empty", "/project/design/references");
    state.files["/project/design/brief.txt"] = "private content";
    state.files["/project/design/references/photo.png"] = "binary";
    state.files["/project/design-extra/outside.txt"] = "outside";
  });
  await page.getByRole("button", { name: "Atualizar projeto", exact: true }).click();
  await page.locator('.tree-file[title="design"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Exportar árvore da pasta…" }).click();
  await expect(page.getByLabel("Pasta de origem")).toHaveValue("design");
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  await expect(page.getByLabel("Resultado", { exact: true })).toHaveValue("design/\n├── empty/\n├── references/\n│   └── photo.png\n└── brief.txt\n");
  await page.screenshot({ path: info.outputPath("commands-tree.png") });
  await page.getByLabel("Tipo de árvore").selectOption("markdown");
  await expect(page.getByLabel("Resultado", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  await expect(page.getByLabel("Resultado", { exact: true })).toHaveValue(/- \*\*design\/\*\*\n  - \*\*empty\/\*\*/);
  // A fresh scan sees filesystem changes even while the panel is open.
  await page.evaluate(() => { (window as any).testState.files["/project/design/new.txt"] = "not read"; });
  await page.getByLabel("Tipo de árvore").selectOption("json");
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  const tree = JSON.parse(await page.getByLabel("Resultado", { exact: true }).inputValue());
  expect(tree.children.map((entry: any) => entry.name)).toEqual(["empty", "references", "brief.txt", "new.txt"]);
  expect(tree.children[0]).toEqual({ name: "empty", type: "directory", children: [] });
  await page.getByLabel("Extensão do arquivo").fill("tree");
  await page.getByLabel("Nome do arquivo", { exact: true }).fill("design-structure");
  await page.getByRole("button", { name: "Salvar no projeto" }).click();
  await expect(page.getByRole("status")).toContainText("design-structure.tree");
  expect(await page.evaluate(() => (window as any).testState.pluginTextReads)).toEqual([]);
  expect(JSON.parse(await page.evaluate(() => (window as any).testState.files["/project/design-structure.tree"]))).toEqual(tree);
  await page.getByRole("button", { name: "Salvar no projeto" }).click();
  await expect(page.getByRole("status")).toContainText("já existe");
  await page.getByLabel("Pasta de origem").selectOption("design/empty");
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  expect(JSON.parse(await page.getByLabel("Resultado", { exact: true }).inputValue())).toEqual({ name: "empty", type: "directory", children: [] });
});

test("inventory is scoped to its folder and text tools never change source files", async ({ page }) => {
  await catalog(page);
  await page.getByRole("button", { name: /Inventário de arquivos/ }).click();
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  await expect(page.getByLabel("Resultado", { exact: true })).toHaveValue('caminho,tipo,extensao\r\n"a.txt","arquivo","txt"\r\n"b.txt","arquivo","txt"\r\n'.replaceAll("\r\n", "\n"));
  await page.getByLabel("Extensão do arquivo").fill("csv");
  await page.getByRole("button", { name: "Salvar no projeto" }).click();
  await expect(page.getByRole("status")).toContainText("inventario.csv");
  await page.getByRole("button", { name: "← Todas as ferramentas" }).click();
  await page.getByRole("button", { name: /Maiúsculas e minúsculas/ }).click();
  await page.getByRole("button", { name: "Usar texto do arquivo aberto" }).click();
  await expect(page.getByLabel("Texto de entrada")).toHaveValue("alpha\nbeta");
  await page.getByRole("button", { name: "Gerar resultado" }).click();
  await expect(page.getByLabel("Resultado", { exact: true })).toHaveValue("ALPHA\nBETA");
  expect(await page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alpha\nbeta");
  await page.getByLabel("Texto de entrada").fill("outro texto");
  await expect(page.getByLabel("Resultado", { exact: true })).toHaveCount(0);
});

test("text transformations handle accents, literal replacement, empty inputs and expansion limits", async ({ page }) => {
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite source URL.
    const { transformText, buildFileTree, buildInventory } = await import("/src/plugins/commandTools.ts");
    const options = { letterCase: "upper", descending: false, ignoreCase: false, find: ".", replacement: "$&" };
    const transform = (tool: string, text: string, patch = {}) => transformText(tool, text, { ...options, ...patch });
    const errors: string[] = [];
    for (const run of [() => transform("replace", "x", { find: "" }), () => transform("replace", "a".repeat(1000), { find: "a", replacement: "z".repeat(10000) }),
      () => buildFileTree([{ path: "one", kind: "directory" }], "removed", "project", "json")]) {
      try { run(); } catch (cause) { errors.push(String(cause)); }
    }
    return {
      checklist: transform("checklist", "- Pedido A\n2. Revisar\n- [x] Entregar\n\n"),
      stats: transform("statistics", "Olá mundo!\n\nCafé."),
      upper: transform("case", "ação útil"), title: transform("case", "AÇÃO ÚTIL", { letterCase: "title" }),
      clean: transform("clean", "  primeira  \r\n\r\n\r\n segunda\t "),
      sorted: transform("sort", "item10\nitem2\nitem1\n"), reverse: transform("sort", "a\nb", { descending: true }),
      unique: transform("unique", "A\nb\na\nb\n", { ignoreCase: true }),
      replaced: transform("replace", "a.b.c"), empty: transform("statistics", ""),
      csv: buildInventory([{ path: '=FORMULA,"x".txt', kind: "file" }], "", "csv").text,
      markdown: buildFileTree([{ path: "[report].txt", kind: "file" }], "", "root", "markdown").text, errors,
    };
  });
  expect(result.checklist).toBe("- [ ] Pedido A\n- [ ] Revisar\n- [ ] Entregar");
  expect(result.stats).toContain("Palavras: 3");
  expect(result.stats).toContain("Parágrafos: 2");
  expect(result.upper).toBe("AÇÃO ÚTIL");
  expect(result.title).toBe("Ação Útil");
  expect(result.clean).toBe("primeira\n\nsegunda");
  expect(result.sorted).toBe("item1\nitem2\nitem10\n");
  expect(result.reverse).toBe("b\na");
  expect(result.unique).toBe("A\nb\n");
  expect(result.replaced).toBe("a$&b$&c");
  expect(result.empty).toContain("Linhas: 0");
  expect(result.csv).toContain('"\'=FORMULA,""x"".txt"');
  expect(result.markdown).toContain("\\[report\\]\\.txt");
  expect(result.errors).toHaveLength(3);
});
