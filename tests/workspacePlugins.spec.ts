import { test, expect } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

test.beforeEach(async ({ page }) => {
  // Supply a trusted test plugin through the same explicit catalog used by the app.
  await page.route("**/src/plugins/builtins.ts", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      const permissions = ["workspace.read", "editor.read", "editor.write", "commands.register"];
      export const builtinPlugins = [{ grants: permissions, definition: {
        manifest: { id: "test.editor", name: "Editor test", version: "1.0.0", apiVersion: 1, permissions,
          commands: [{ id: "test.editor.uppercase", title: "Converter para maiúsculas" }] },
        activate(api) {
          const record = { api, events: [], disposed: false };
          (window.pluginRuns ??= []).push(record);
          window.currentPluginRun = record;
          api.subscriptions.add({ dispose() { record.disposed = true; } });
          api.editor.onDidChangeActiveDocument((document) => record.events.push(document));
          api.commands.register("test.editor.uppercase", () => {
            const document = api.editor.getActiveDocument();
            if (document) api.editor.replaceActiveDocument({ documentId: document.id,
              expectedVersion: document.version, text: document.text.toUpperCase() });
          });
        }
      }}];
    `,
  }));
  await setupWorkspace(page);
  await expect.poll(() => page.evaluate(() => (window as any).currentPluginRun?.api.editor.getActiveDocument()?.text)).toBe("alpha\nbeta");
});

test("plugin commands use Monaco undo, recovery and autosave", async ({ page }) => {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Executar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Converter para maiúsculas" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("ALPHA\nBETA");
  await expect.poll(() => page.evaluate(() => (window as any).currentPluginRun.events.at(-1)?.text)).toBe("ALPHA\nBETA");
  await page.getByRole("menubar").getByRole("menuitem", { name: "Editar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Desfazer", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alpha\nbeta");
  const info = await page.evaluate(() => (window as any).currentPluginRun.api.workspace.getInfo());
  expect(info).toEqual({ name: "project", path: "/project" });
});

test("stale document edits cannot overwrite a changed buffer or another tab", async ({ page }) => {
  const codes = await page.evaluate(() => {
    const api = (window as any).currentPluginRun.api;
    const document = api.editor.getActiveDocument();
    (window as any).oldDocument = document;
    api.editor.replaceActiveDocument({ documentId: document.id, expectedVersion: document.version, text: "changed" });
    try { api.editor.replaceActiveDocument({ documentId: document.id, expectedVersion: document.version, text: "lost edit" }); }
    catch (cause: any) { return cause.code; }
  });
  expect(codes).toBe("DOCUMENT_CHANGED");
  await page.locator('.tree-file[title="b.txt"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).currentPluginRun.api.editor.getActiveDocument()?.path)).toBe("/project/b.txt");
  const code = await page.evaluate(() => {
    const api = (window as any).currentPluginRun.api;
    const old = (window as any).oldDocument;
    try { api.editor.replaceActiveDocument({ documentId: old.id, expectedVersion: old.version, text: "wrong file" }); }
    catch (cause: any) { return cause.code; }
  });
  expect(code).toBe("DOCUMENT_CHANGED");
  expect(await page.evaluate(() => (window as any).currentPluginRun.api.editor.getActiveDocument().text)).toBe("second");
});

test("project close revokes the old context and reopening activates a fresh context", async ({ page }) => {
  await page.evaluate(() => { (window as any).previousPluginRun = (window as any).currentPluginRun; });
  await page.getByRole("button", { name: "‹" }).click();
  await expect(page.getByRole("button", { name: "Abrir projeto", exact: true })).toBeVisible();
  const closed = await page.evaluate(() => {
    const previous = (window as any).previousPluginRun;
    let code;
    try { previous.api.workspace.getInfo(); } catch (cause: any) { code = cause.code; }
    return { code, disposed: previous.disposed, aborted: previous.api.signal.aborted };
  });
  expect(closed).toEqual({ code: "PLUGIN_INACTIVE", disposed: true, aborted: true });
  await page.getByRole("button", { name: "Abrir projeto", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).currentPluginRun !== (window as any).previousPluginRun)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).currentPluginRun.api.editor.getActiveDocument()?.text)).toBe("alpha\nbeta");
});

test("plugin edits are blocked while project close drains pending saves", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).testState.holdWrites = true;
    const api = (window as any).currentPluginRun.api;
    const document = api.editor.getActiveDocument();
    api.editor.replaceActiveDocument({ documentId: document.id, expectedVersion: document.version, text: "pending save" });
  });
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingWrites.length)).toBe(1);
  await page.getByRole("button", { name: "‹" }).click();
  const code = await page.evaluate(() => {
    const api = (window as any).currentPluginRun.api;
    const document = api.editor.getActiveDocument();
    try { api.editor.replaceActiveDocument({ documentId: document.id, expectedVersion: document.version, text: "too late" }); }
    catch (cause: any) { return cause.code; }
  });
  expect(code).toBe("WORKSPACE_BUSY");
  await page.evaluate(() => {
    const state = (window as any).testState;
    state.holdWrites = false;
    state.pendingWrites.splice(0).forEach((write: any) => write.release());
  });
  await expect(page.getByRole("button", { name: "Abrir projeto", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("pending save");
});
