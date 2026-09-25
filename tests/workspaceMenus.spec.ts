import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

async function openMenu(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: label, exact: true }).click();
}

test.beforeEach(async ({ page }) => setupWorkspace(page));

test("menus navigate by keyboard, dismiss, disable unavailable actions and toggle views", async ({ page }, testInfo) => {
  await openMenu(page, "Arquivo");
  await expect(page.getByRole("menu", { name: "Arquivo" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("file-menu.png") });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "Editar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("menubar").getByRole("menuitem", { name: "Editar", exact: true })).toBeFocused();
  await openMenu(page, "Terminal");
  await expect(page.getByRole("menuitemcheckbox", { name: "Mostrar terminal" })).toBeEnabled();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "Ajuda" })).toBeVisible();
  await page.locator(".workspace-project-name").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await expect(page.locator(".workspace-sidebar")).toBeHidden();
  await page.keyboard.press("Control+Shift+f");
  await expect(page.locator(".global-search-input")).toBeFocused();
  await page.keyboard.press("F1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("new files get a tab, inactive edits save, and canceled project pickers preserve the workspace", async ({ page }) => {
  await page.keyboard.press("Control+n");
  await page.getByLabel("Nome", { exact: true }).fill("created.txt");
  await page.getByRole("button", { name: "Criar arquivo", exact: true }).click();
  await expect(page.getByRole("tab", { name: "created.txt" })).toHaveAttribute("aria-selected", "true");
  await page.locator(".monaco-editor").click();
  await page.keyboard.insertText("createdContent");
  await page.getByRole("tab", { name: "a.txt" }).click();
  await page.keyboard.press("Control+Shift+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/created.txt"])).toBe("createdContent");
  await page.evaluate(() => { (window as any).testState.projectPicker = null; });
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("tab", { name: "created.txt" })).toBeVisible();
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("tab", { name: "a.txt" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "created.txt" })).toHaveAttribute("aria-selected", "true");
});

test("exit can be canceled, then saves before destroying the native window", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.confirmed = false; (window as any).testState.failWrites = true; });
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Selecionar tudo" }).click();
  await page.keyboard.insertText("exitContent");
  await openMenu(page, "Arquivo");
  await page.getByRole("menuitem", { name: "Sair", exact: true }).click();
  expect(await page.evaluate(() => (window as any).testState.destroyed)).toBe(false);
  await page.evaluate(() => { (window as any).testState.confirmed = true; (window as any).testState.failWrites = false; });
  await openMenu(page, "Arquivo");
  await page.getByRole("menuitem", { name: "Sair", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.destroyed)).toBe(true);
  expect(await page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("exitContent");
});

test("editor menu edits and undo stay isolated across file tabs", async ({ page }) => {
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Selecionar tudo" }).click();
  await page.keyboard.insertText("alphaEdited");
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alphaEdited");
  await page.locator(".tree-file").filter({ hasText: "b.txt" }).click();
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Selecionar tudo" }).click();
  await page.keyboard.insertText("betaEdited");
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Desfazer" }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/b.txt"])).toBe("second");
  await page.getByRole("tab", { name: "a.txt" }).click();
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Desfazer" }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alpha\nbeta");
});

test("failed saves prevent closing the project and can be retried", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.failWrites = true; });
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Selecionar tudo" }).click();
  await page.keyboard.type("unsaved work");
  await openMenu(page, "Arquivo");
  await page.getByRole("menuitem", { name: "Fechar projeto", exact: true }).click();
  await expect(page.locator(".workspace-error-banner")).toContainText("Disk unavailable");
  await expect(page.getByRole("menubar")).toBeVisible();
  await page.evaluate(() => { (window as any).testState.failWrites = false; });
  await openMenu(page, "Arquivo");
  await page.getByRole("menuitem", { name: "Fechar projeto", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir projeto", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("unsaved work");
});

test("clipboard menu commands edit the selected file and preserve undo", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Selecionar tudo" }).click();
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Copiar", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"))).toBe("alpha\nbeta");
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Recortar", exact: true }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("");
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Colar", exact: true }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alpha\nbeta");
  await openMenu(page, "Editar");
  await page.getByRole("menuitem", { name: "Desfazer", exact: true }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("");
});
