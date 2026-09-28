import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

async function copilot(page: Page) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Executar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Copilot — assistente" }).click();
  if (await page.getByRole("button", { name: "Fazer login", exact: true }).isVisible()) await page.getByRole("button", { name: "Fazer login", exact: true }).click();
  await expect(page.getByLabel("Modelo", { exact: true })).toBeEnabled();
}
async function send(page: Page) {
  await page.getByLabel("Pedido", { exact: true }).fill("Altere os arquivos solicitados");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
}
test.beforeEach(async ({ page }) => setupWorkspace(page));

test("permission modes reach the backend and full access is never silently restored", async ({ page }) => {
  await copilot(page);
  const modes = page.getByLabel("Permissões do Copilot");
  await expect(modes).toHaveValue("ask");
  await send(page);
  await expect(page.getByLabel("Resposta do Copilot").last()).toBeVisible();
  expect(await page.evaluate(() => (window as any).testState.aiRequests[0].accessMode)).toBe("ask");
  await modes.selectOption("auto");
  await send(page);
  await expect(page.getByLabel("Resposta do Copilot")).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).testState.aiRequests[1].accessMode)).toBe("auto");
  await modes.selectOption("full");
  await page.getByRole("button", { name: "Manter proteção" }).click();
  await expect(modes).toHaveValue("auto");
  await modes.selectOption("full");
  await page.getByRole("button", { name: "Ativar acesso completo" }).click();
  await send(page);
  await expect(page.getByLabel("Resposta do Copilot")).toHaveCount(3);
  expect(await page.evaluate(() => (window as any).testState.aiRequests[2].accessMode)).toBe("full");
  await page.getByRole("button", { name: "Fechar plugin" }).click();
  await copilot(page);
  await expect(modes).toHaveValue("ask");
});

test("approval decisions bind to the active request and disk changes reconcile without autosave loss", async ({ page }) => {
  await copilot(page);
  await page.evaluate(() => { (window as any).testState.holdAi = true; });
  await send(page);
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingAi.length)).toBe(1);
  await expect(page.locator(".workspace-editor-area")).toHaveAttribute("inert", "");
  await page.evaluate(() => (window as any).testState.aiEvents[0].onmessage({ type: "approval", approval: { id: "first", title: "Alterar arquivos", detail: "a.txt: -alpha +changed", canApprove: true } }));
  await expect(page.getByRole("region", { name: "Aprovação pendente" })).toContainText("a.txt");
  await page.getByRole("button", { name: "Recusar", exact: true }).click();
  expect(await page.evaluate(() => (window as any).testState.approvals[0])).toMatchObject({ approvalId: "first", approved: false, projectPath: "/project" });
  await page.evaluate(() => (window as any).testState.aiEvents[0].onmessage({ type: "approval", approval: { id: "second", title: "Alterar arquivos", detail: "a.txt", canApprove: true } }));
  await page.getByRole("button", { name: "Aprovar uma vez" }).click();
  expect(await page.evaluate(() => (window as any).testState.approvals[1])).toMatchObject({ approvalId: "second", approved: true });
  expect(await page.evaluate(() => (window as any).testState.approvals.every((a: any) => a.requestId === (window as any).testState.pendingAi[0].id))).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).testState;
    state.files["/project/a.txt"] = "changed by Codex";
    state.files["/project/new.txt"] = "new";
    delete state.files["/project/b.txt"];
    state.pendingAi[0].release();
  });
  await expect(page.getByLabel("Resposta do Copilot")).toBeVisible();
  await expect(page.locator('.tree-file[title="new.txt"]')).toBeVisible();
  await expect(page.locator('.tree-file[title="b.txt"]')).toHaveCount(0);
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("changed by Codex");
  await expect(page.locator(".workspace-editor-area")).not.toHaveAttribute("inert");
  expect(await page.evaluate(() => (window as any).testState.writes)).toEqual([]);
  await page.getByRole("menubar").getByRole("menuitem", { name: "Editar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Desfazer", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alpha\nbeta");
});

test("closing a pending approval cancels it and late approvals cannot enter a reopened panel", async ({ page }) => {
  await copilot(page);
  await page.evaluate(() => { (window as any).testState.holdAi = true; });
  await send(page);
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingAi.length)).toBe(1);
  await page.evaluate(() => (window as any).testState.aiEvents[0].onmessage({ type: "approval", approval: { id: "stale", title: "Comando", detail: "command", canApprove: true } }));
  await page.getByRole("button", { name: "Fechar plugin" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.cancelled.length)).toBeGreaterThan(0);
  await expect(page.locator(".workspace-editor-area")).not.toHaveAttribute("inert");
  await copilot(page);
  await page.evaluate(() => (window as any).testState.aiEvents[0].onmessage({ type: "approval", approval: { id: "late", title: "Comando atrasado", detail: "command", canApprove: true } }));
  await expect(page.getByRole("region", { name: "Aprovação pendente" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).testState.approvals)).toEqual([]);
});

test("a failed save prevents starting native project tools", async ({ page }) => {
  await copilot(page);
  await page.evaluate(() => { (window as any).testState.failWrites = true; });
  await page.getByRole("menubar").getByRole("menuitem", { name: "Editar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Selecionar tudo", exact: true }).click();
  await page.keyboard.insertText("unsaved work");
  await send(page);
  await expect(page.locator(".plugin-panel").getByRole("alert")).toContainText("Não foi possível salvar");
  expect(await page.evaluate(() => (window as any).testState.aiRequests)).toEqual([]);
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("unsaved work");
});
