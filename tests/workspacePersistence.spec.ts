import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

test.beforeEach(async ({ page }) => setupWorkspace(page));

async function edit(page: Page, value: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Editar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Selecionar tudo", exact: true }).click();
  await page.keyboard.insertText(value);
}

async function addFolder(page: Page) {
  await page.evaluate(() => { (window as any).testState.files["/project/folder/child.txt"] = "child"; });
  await page.getByRole("button", { name: "Atualizar projeto", exact: true }).click();
  await page.locator('.tree-file[title="folder"]').click();
  await page.locator('.tree-file[title="folder/child.txt"]').click();
  await expect(page.getByRole("tab", { name: "child.txt" })).toHaveAttribute("aria-selected", "true");
}

async function rename(page: Page, target: string, name: string) {
  await page.locator(`.tree-file[title="${target}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Renomear", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Renomear", exact: true }).click();
}

async function remove(page: Page, target: string) {
  await page.locator(`.tree-file[title="${target}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
}

async function releaseWrites(page: Page) {
  await page.evaluate(() => {
    const state = (window as any).testState;
    state.holdWrites = false;
    state.pendingWrites.splice(0).forEach((write: any) => write.release());
  });
}

for (const directory of [false, true]) {
  for (const operation of ["rename", "delete"]) {
    test(`${operation} ${directory ? "folder" : "file"} drains pending writes and never recreates the old path`, async ({ page }) => {
      if (directory) await addFolder(page);
      const source = directory ? "/project/folder/child.txt" : "/project/a.txt";
      const target = directory ? "folder" : "a.txt";
      await page.evaluate(() => { (window as any).testState.holdWrites = true; });
      await edit(page, "pendingContent");
      await page.keyboard.press("Control+s");
      await expect.poll(() => page.evaluate(() => (window as any).testState.pendingWrites.length)).toBe(1);
      // The timer for the latest edit must not write to the old path after mutation.
      await edit(page, "latestContent");
      if (operation === "rename") await rename(page, target, "renamed");
      else await remove(page, target);
      expect(await page.evaluate(() => (window as any).testState.mutations)).toEqual([]);
      await releaseWrites(page);
      await expect.poll(() => page.evaluate(() => (window as any).testState.mutations.length)).toBe(1);
      if (operation === "rename") {
        const destination = directory ? "/project/renamed/child.txt" : "/project/renamed";
        await expect.poll(() => page.evaluate((path) => (window as any).testState.files[path], destination)).toBe("latestContent");
      }
      // Allow any incorrectly retained debounce timer to fire.
      await page.waitForTimeout(700);
      expect(await page.evaluate((path) => (window as any).testState.files[path], source)).toBeUndefined();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("corant.recovery.v1") ?? "[]"))).toEqual([]);
    });
  }
}

test("autosave follows dirty files across immediate tab switches", async ({ page }) => {
  await edit(page, "firstEdit");
  await page.locator('.tree-file[title="b.txt"]').click();
  await edit(page, "secondEdit");
  await page.getByRole("tab", { name: "a.txt" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.files)).toEqual({
    "/project/a.txt": "firstEdit", "/project/b.txt": "secondEdit",
  });
  await expect(page.locator(".tab-dot")).toHaveCount(0);
});

test("an old write completing after undo marks the inactive file dirty and saves the undo", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.holdWrites = true; });
  await edit(page, "changed");
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.pendingWrites.length)).toBe(1);
  await page.keyboard.press("Control+z");
  await page.locator('.tree-file[title="b.txt"]').click();
  await releaseWrites(page);
  await expect(page.getByRole("tab", { name: "a.txt" }).locator(".tab-dot")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alpha\nbeta");
  await expect(page.locator(".tab-dot")).toHaveCount(0);
});

test("discarding a dirty tab clears its cache, recovery and undo; cancel preserves them", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.failWrites = true; (window as any).testState.confirmed = false; });
  await edit(page, "discardMe");
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("tab", { name: "a.txt" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("corant.recovery.v1"))).toContain("discardMe");
  await page.evaluate(() => { (window as any).testState.confirmed = true; });
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("tab", { name: "a.txt" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("corant.recovery.v1"))).toBeNull();
  await page.locator('.tree-file[title="a.txt"]').click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+z");
  await page.evaluate(() => { (window as any).testState.failWrites = false; });
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("alpha\nbeta");
  expect(await page.evaluate(() => (window as any).testState.dialogs)).not.toContain("Recuperar alterações");
});

test("deleting a folder removes recovery for closed and never-opened descendants only", async ({ page }) => {
  await addFolder(page);
  await page.keyboard.press("Control+w");
  await page.evaluate(() => {
    localStorage.setItem("corant.recovery.v1", JSON.stringify(["/project/folder/child.txt", "/project/folder/unopened.txt", "/project/folder-other/keep.txt"].map((filePath) => ({ projectPath: "/project", filePath, content: "recovery", updatedAt: 1 }))));
  });
  await remove(page, "folder");
  await expect(page.locator('.tree-file[title="folder"]')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("corant.recovery.v1") ?? "[]").map((item: any) => item.filePath))).toEqual(["/project/folder-other/keep.txt"]);
  await expect(page.locator(".save-indicator")).toHaveText("● Salvo");
});

test("deleted and renamed paths do not reuse old Monaco content or undo", async ({ page }) => {
  await edit(page, "oldHistory");
  await page.keyboard.press("Control+s");
  await rename(page, "a.txt", "renamed.txt");
  await expect(page.getByRole("tab", { name: "renamed.txt" })).toBeVisible();
  await rename(page, "renamed.txt", "a.txt");
  await expect(page.getByRole("tab", { name: "a.txt" })).toBeVisible();
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("oldHistory");
  await remove(page, "a.txt");
  await expect(page.getByRole("tab", { name: "a.txt" })).toHaveCount(0);
  await page.locator(".tree-project-name").click();
  await page.keyboard.press("Control+n");
  await page.getByLabel("Nome", { exact: true }).fill("a.txt");
  await page.getByRole("button", { name: "Criar arquivo", exact: true }).click();
  await expect(page.getByRole("tab", { name: "a.txt" })).toBeVisible();
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/a.txt"])).toBe("");
});

test("ArrowUp opens the last available menu action", async ({ page }) => {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Arquivo", exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("menuitem", { name: "Sair", exact: true })).toBeFocused();
});

test("rename migrates unsaved recovery and a failed rename leaves the original usable", async ({ page }) => {
  await addFolder(page);
  await page.evaluate(() => { (window as any).testState.failWrites = true; (window as any).testState.failMutation = true; });
  await edit(page, "recoverAfterRename");
  await rename(page, "folder", "renamed");
  await expect(page.locator(".dialog-error")).toContainText("Mutation failed");
  expect(await page.evaluate(() => localStorage.getItem("corant.recovery.v1"))).toContain("/project/folder/child.txt");
  await page.evaluate(() => { (window as any).testState.failMutation = false; });
  await page.getByRole("button", { name: "Renomear", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem("corant.recovery.v1") ?? "[]"));
  expect(recovery.map((item: any) => item.filePath)).toEqual(["/project/renamed/child.txt"]);
  expect(recovery[0].content).toBe("recoverAfterRename");
  await page.evaluate(() => { (window as any).testState.failWrites = false; });
  await page.keyboard.press("Control+Shift+s");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/renamed/child.txt"])).toBe("recoverAfterRename");
});
