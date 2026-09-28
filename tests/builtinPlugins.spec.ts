import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

async function open(page: Page, name: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Executar", exact: true }).click();
  await page.getByRole("menuitem", { name }).click();
}
async function selectProvider(page: Page, provider: "codex" | "openrouter") {
  await page.getByRole("button", { name: /^Provedor ·/ }).click();
  await page.getByLabel("Provedor", { exact: true }).selectOption(provider);
}

test.beforeEach(async ({ page }) => setupWorkspace(page));

test("themes persist per project and update the editor", async ({ page }, info) => {
  await open(page, "Good Vibes — escolher tema");
  await page.getByRole("button", { name: /Amanhecer/ }).click();
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-theme", "dawn");
  await expect(page.locator(".monaco-editor").first()).toHaveCSS("background-color", "rgb(255, 250, 245)");
  await page.screenshot({ path: info.outputPath("dawn.png") });
  await page.getByRole("button", { name: "Fechar plugin" }).click();
  await open(page, "Good Vibes — escolher tema");
  await expect(page.getByRole("button", { name: /Amanhecer/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Meia-noite/ }).click();
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-theme", "midnight");
});

test("Commands saves recipes, previews contents and never overwrites exports", async ({ page }) => {
  await open(page, "Commands — ferramentas");
  await page.getByRole("button", { name: /Juntar documentos/ }).click();
  await page.getByLabel("Nome do comando", { exact: true }).fill("Meu resumo");
  await page.getByRole("button", { name: "Selecionar arquivos" }).click();
  await page.getByRole("combobox", { name: "Formato", exact: true }).selectOption("json");
  await page.getByRole("button", { name: "Salvar comando", exact: true }).click();
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  const preview = JSON.parse(await page.getByLabel("Prévia da exportação").inputValue());
  expect(preview).toEqual([{ path: "a.txt", content: "alpha\nbeta" }, { path: "b.txt", content: "second" }]);
  await page.getByRole("button", { name: "Salvar no projeto" }).click();
  await expect(page.locator(".plugin-panel").getByRole("status")).toContainText("Criado na raiz");
  await page.getByRole("button", { name: "Salvar no projeto" }).click();
  await expect(page.locator(".plugin-panel").getByRole("status")).toContainText("já existe");
  await page.getByRole("button", { name: "Fechar plugin" }).click();
  await open(page, "Commands — ferramentas");
  await page.getByRole("button", { name: /Juntar documentos/ }).click();
  await page.getByLabel("Comandos salvos").selectOption({ label: "Meu resumo" });
  await expect(page.getByRole("combobox", { name: "Formato", exact: true })).toHaveValue("json");
});

test("Copilot sends only selected context, keeps key out of storage and checks document version", async ({ page }) => {
  await open(page, "Copilot — assistente");
  await selectProvider(page, "openrouter");
  await page.getByRole("button", { name: "Fazer login" }).click();
  await page.getByLabel("Chave OpenRouter").fill("secret-test-key");
  await page.getByLabel("Modelo", { exact: true }).fill("test/model");
  await page.getByRole("button", { name: "Conectar OpenRouter" }).click();
  await page.getByLabel("Pedido", { exact: true }).fill("Explique");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Resposta do Copilot").last()).toContainText("replacement");
  expect(await page.evaluate(() => (window as any).testState.aiRequests[0].prompt)).toBe("Explique");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("secret-test-key");
  await page.getByLabel("Propor alteração do documento ativo").check();
  await page.getByLabel("Pedido", { exact: true }).fill("Altere o código");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Aplicar ao documento" })).toBeVisible();
  await page.getByRole("menubar").getByRole("menuitem", { name: "Editar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Selecionar tudo", exact: true }).click();
  await page.keyboard.insertText(" changed");
  await page.getByRole("button", { name: "Aplicar ao documento" }).click();
  await expect(page.locator(".plugin-panel").getByRole("alert")).toContainText(/mudou|alterado/);
});

test("Codex requires explicit login and supports logout", async ({ page }) => {
  await open(page, "Copilot — assistente");
  await selectProvider(page, "codex");
  await expect(page.getByRole("log", { name: "Conversa com Copilot" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).testState.accountActions)).not.toContain("login");
  await page.getByRole("button", { name: "Fazer login" }).click();
  await expect(page.getByText("Conectado ao Codex", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Login Codex")).toHaveCount(0);
  await page.getByLabel("Pedido", { exact: true }).fill("Olá");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Resposta do Copilot").last()).toContainText("replacement");
  expect(await page.evaluate(() => (window as any).testState.aiRequests[0].provider)).toBe("codex");
  await page.getByRole("button", { name: "Sair do Codex" }).click();
  await expect(page.getByRole("log", { name: "Conversa com Copilot" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fazer login" })).toBeVisible();
});

test("failed window close restores plugin commands", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.failDestroy = true; });
  await page.getByRole("menubar").getByRole("menuitem", { name: "Arquivo", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sair", exact: true }).click();
  await expect(page.locator(".workspace-error-banner")).toContainText("Destroy failed");
  await open(page, "Good Vibes — escolher tema");
  await expect(page.getByRole("group", { name: "Temas" })).toBeVisible();
});

test("closing Copilot cancels the request and ignores its late response", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.holdAi = true; });
  await open(page, "Copilot — assistente");
  await selectProvider(page, "openrouter");
  await page.getByRole("button", { name: "Fazer login" }).click();
  await page.getByLabel("Chave OpenRouter").fill("test-key");
  await page.getByLabel("Modelo", { exact: true }).fill("test/model");
  await page.getByRole("button", { name: "Conectar OpenRouter" }).click();
  await page.getByLabel("Pedido", { exact: true }).fill("Teste cancelamento");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingAi.length)).toBe(1);
  await page.getByRole("button", { name: "Fechar plugin" }).click();
  await expect.poll(() => page.evaluate(() => { const state = (window as any).testState; return state.cancelled.includes(state.pendingAi[0].id); })).toBe(true);
  await open(page, "Copilot — assistente");
  await expect(page.getByLabel("Resposta do Copilot")).toHaveCount(0);
  await page.getByRole("button", { name: "Fazer login" }).click();
  await expect(page.getByLabel("Chave OpenRouter")).toHaveValue("");
});

test("Codex discards expired login links and retries with a new attempt", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.holdAccount = true; });
  await open(page, "Copilot — assistente");
  await selectProvider(page, "codex");
  await page.getByRole("button", { name: "Fazer login" }).click();
  await expect(page.getByLabel("Login Codex")).toContainText("TEST-123");
  await expect(page.locator(".plugin-panel").getByRole("status")).toContainText("Aguardando login");
  await page.evaluate(() => (window as any).testState.pendingAccounts[0].finish(false));
  await expect(page.locator(".plugin-panel").getByRole("alert")).toContainText("Login expirado");
  await expect(page.getByLabel("Login Codex")).toHaveCount(0);
  await page.getByRole("button", { name: "Entrar com código" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingAccounts.length)).toBe(2);
  expect(await page.evaluate(() => {
    const state = (window as any).testState;
    return state.pendingAccounts[0].id !== state.pendingAccounts[1].id && state.accountActions.includes("login-device");
  })).toBe(true);
  await page.getByRole("button", { name: "Cancelar operação" }).click();
  await expect(page.getByLabel("Login Codex")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fazer login" })).toBeEnabled();
  await page.getByRole("button", { name: "Fazer login" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingAccounts.length)).toBe(3);
  await page.evaluate(() => (window as any).testState.pendingAccounts[2].finish(true));
  await expect(page.getByText("Conectado ao Codex", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Login Codex")).toHaveCount(0);
});

test("Codex model dropdown loads after login and sends the selected model", async ({ page }) => {
  await open(page, "Copilot — assistente");
  await selectProvider(page, "codex");
  await expect(page.getByRole("combobox", { name: "Modelo", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).testState.modelCalls)).toBe(0);
  await page.getByRole("button", { name: "Fazer login" }).click();
  const picker = page.getByRole("combobox", { name: "Modelo", exact: true });
  await expect(picker).toBeEnabled();
  await expect(picker.locator("option")).toHaveCount(3);
  await picker.selectOption("test-fast");
  await page.getByLabel("Pedido", { exact: true }).fill("Explique");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Resposta do Copilot").last()).toContainText("replacement");
  expect(await page.evaluate(() => (window as any).testState.aiRequests[0].model)).toBe("test-fast");
  await page.getByRole("button", { name: "Fechar plugin" }).click();
  await open(page, "Copilot — assistente");
  await expect(page.getByRole("combobox", { name: "Modelo", exact: true })).toHaveValue("test-fast");
  await page.evaluate(() => { (window as any).testState.models = [{ model: "new-model", displayName: "Novo modelo", isDefault: true }]; });
  await page.getByRole("button", { name: "Atualizar modelos" }).click();
  await expect(picker).toHaveValue("");
  await expect(picker.locator("option")).toHaveText(["Padrão do Codex", "Novo modelo (recomendado)"]);
});

test("Codex model list failures allow default model and retry", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.failModels = true; });
  await open(page, "Copilot — assistente");
  await selectProvider(page, "codex");
  await page.getByRole("button", { name: "Fazer login" }).click();
  await expect(page.locator(".plugin-panel").getByRole("status")).toContainText("Falha ao consultar modelos");
  await page.getByLabel("Pedido", { exact: true }).fill("Olá");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Resposta do Copilot").last()).toContainText("replacement");
  expect(await page.evaluate(() => (window as any).testState.aiRequests[0].model)).toBe("");
  await page.evaluate(() => { (window as any).testState.failModels = false; });
  await page.getByRole("button", { name: "Atualizar modelos" }).click();
  await expect(page.getByRole("combobox", { name: "Modelo", exact: true }).locator("option")).toHaveCount(3);
  await expect(page.locator(".plugin-panel").getByRole("status")).toHaveCount(0);
});

test("Codex refreshes models automatically without losing selection or interrupting requests", async ({ page }) => {
  await page.clock.install();
  await open(page, "Copilot — assistente");
  await selectProvider(page, "codex");
  await page.getByRole("button", { name: "Fazer login" }).click();
  const picker = page.getByRole("combobox", { name: "Modelo", exact: true });
  await expect(picker).toBeEnabled();
  await picker.selectOption("test-fast");
  await page.evaluate(() => { (window as any).testState.models.push({ model: "new-release", displayName: "Novo lançamento", isDefault: false }); });
  await page.clock.fastForward(5 * 60_000);
  await page.clock.runFor(30_000);
  await expect(picker.locator("option")).toHaveCount(4);
  await expect(picker).toHaveValue("test-fast");
  await page.evaluate(() => { (window as any).testState.failModels = true; });
  await page.clock.fastForward(5 * 60_000);
  await page.clock.runFor(30_000);
  await expect(page.locator(".plugin-panel").getByRole("status")).toContainText("Falha ao consultar modelos");
  await expect(picker).toHaveValue("test-fast");
  await expect(picker.locator("option")).toHaveCount(4);
  await page.evaluate(() => { const state = (window as any).testState; state.failModels = false; state.holdAi = true; });
  await page.getByLabel("Pedido", { exact: true }).fill("Pedido em andamento");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingAi.length)).toBe(1);
  const before = await page.evaluate(() => (window as any).testState.modelCalls);
  await page.clock.fastForward(5 * 60_000);
  await page.clock.runFor(30_000);
  expect(await page.evaluate(() => (window as any).testState.modelCalls)).toBe(before);
  await page.getByRole("button", { name: "Cancelar operação" }).click();
  await expect(page.getByRole("button", { name: "Cancelar operação" })).toHaveCount(0);
  await page.clock.fastForward(30_000);
  await expect.poll(() => page.evaluate(() => (window as any).testState.modelCalls)).toBe(before + 1);
  await expect(picker).toBeEnabled();
  await page.clock.fastForward(60_000);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => page.evaluate(() => (window as any).testState.modelCalls)).toBe(before + 2);
  await expect(picker).toBeEnabled();
  await page.getByRole("button", { name: "Fechar plugin" }).click();
  await page.clock.fastForward(6 * 60_000);
  expect(await page.evaluate(() => (window as any).testState.modelCalls)).toBe(before + 2);
});

test("Copilot starts with three actions and opens a conversation after device login", async ({ page }, info) => {
  await page.evaluate(() => { (window as any).testState.holdAccount = true; });
  await open(page, "Copilot — assistente");
  const actions = page.getByRole("group", { name: "Ações do Copilot" });
  await expect(actions.getByRole("button")).toHaveText(["Provedor · Codex", "Entrar com código", "Fazer login"]);
  await expect(page.getByLabel("Pedido", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("copilot-login.png") });
  await page.getByRole("button", { name: "Entrar com código" }).click();
  await expect(page.getByLabel("Login Codex")).toContainText("TEST-123");
  await expect(page.getByRole("log", { name: "Conversa com Copilot" })).toHaveCount(0);
  await page.evaluate(() => (window as any).testState.pendingAccounts[0].finish(true));
  await expect(page.getByRole("log", { name: "Conversa com Copilot" })).toBeVisible();
  await page.getByLabel("Pedido", { exact: true }).fill("Explique esse projeto");
  await page.getByLabel("Pedido", { exact: true }).press("Enter");
  await expect(page.getByLabel("Resposta do Copilot")).toContainText("replacement");
  await page.getByLabel("Pedido", { exact: true }).fill("E o próximo passo?");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Resposta do Copilot")).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).testState.aiRequests[1].prompt)).toContain("Explique esse projeto");
  expect(await page.evaluate(() => (window as any).testState.aiRequests[1].prompt)).toContain("replacement");
  await page.screenshot({ path: info.outputPath("copilot-chat.png") });
  await page.getByRole("button", { name: "Nova conversa" }).click();
  await expect(page.getByLabel("Resposta do Copilot")).toHaveCount(0);
  await page.getByRole("button", { name: "Anexar arquivo" }).click();
  await expect(page.locator(".copilot-attachment")).toContainText("a.txt");
  await page.getByLabel("Pedido", { exact: true }).fill("Leia o arquivo");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Resposta do Copilot")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).testState.aiRequests[2].prompt)).toContain("alpha");
  expect(await page.evaluate(() => (window as any).testState.aiRequests[2].prompt)).not.toContain("Explique esse projeto");
});
