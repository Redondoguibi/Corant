import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

async function refresh(page: Page) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Exibir", exact: true }).click();
  await page.getByRole("menuitem", { name: "Atualizar Explorer", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await setupWorkspace(page);
  await page.evaluate(() => {
    const state = (window as any).testState;
    state.files["/project/picture.PNG"] = "binary";
    state.files["/project/vector.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><script>window.svgExecuted=true</script><rect width="80" height="40" fill="red"/></svg>';
    state.files["/project/broken.png"] = "invalid";
    state.files["/project/large.png"] = "large";
    state.imageReads = [];
    state.textReads = [];
    state.imagePending = [];
    state.revokedUrls = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { state.revokedUrls.push(url); revoke(url); };
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command: string, args: any, options: any) => {
      if (command === "plugin:fs|stat") return { isFile: true, size: args.path.endsWith("large.png") ? 33 * 1024 * 1024 : 100 };
      if (command === "plugin:fs|read_text_file") state.textReads.push(args.path);
      if (command === "plugin:fs|read_file") {
        state.imageReads.push(args.path);
        if (state.holdImages) await new Promise<void>((resolve) => state.imagePending.push(resolve));
        if (args.path.endsWith("picture.PNG")) return Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII="), (ch) => ch.charCodeAt(0));
        return Array.from(new TextEncoder().encode(state.files[args.path]));
      }
      return invoke(command, args, options);
    };
  });
  await refresh(page);
});

test("raster preview uses binary reads, disables editing and releases URLs on tab changes", async ({ page }) => {
  await page.locator(".tree-file").filter({ hasText: "picture.PNG" }).click();
  await expect(page.getByRole("img", { name: "picture.PNG" })).toBeVisible();
  await expect(page.getByText("1 × 1 px", { exact: true })).toBeVisible();
  await expect(page.locator(".monaco-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Tamanho original", exact: true }).click();
  await expect(page.locator(".image-preview-canvas")).toHaveClass(/is-original/);
  await page.getByRole("menubar").getByRole("menuitem", { name: "Arquivo", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Salvar", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await page.getByRole("tab", { name: "a.txt" }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  const state = await page.evaluate(() => (window as any).testState);
  expect(state.textReads).not.toContain("/project/picture.PNG");
  expect(state.writes).toEqual([]);
  expect(state.revokedUrls.length).toBeGreaterThan(0);
});

test("SVG renders inertly and can switch to code, edit and preview the current content", async ({ page }, info) => {
  await page.locator(".tree-file").filter({ hasText: "vector.svg" }).click();
  await expect(page.getByText("80 × 40 px", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).svgExecuted)).toBeUndefined();
  await page.screenshot({ path: info.outputPath("svg-preview.png") });
  await page.getByRole("button", { name: "Editar SVG", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("menubar").getByRole("menuitem", { name: "Editar", exact: true }).click();
  await page.getByRole("menuitem", { name: "Selecionar tudo", exact: true }).click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="blue"/></svg>'));
  await page.keyboard.press("Control+v");
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/vector.svg"])).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="blue"/></svg>');
  await page.getByRole("button", { name: "Visualizar SVG", exact: true }).click();
  await expect(page.getByText("120 × 60 px", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).testState.files["/project/vector.svg"])).toContain('width="120"');
});

test("invalid and oversized files show errors without entering the editor", async ({ page }) => {
  await page.locator(".tree-file").filter({ hasText: "broken.png" }).click();
  await expect(page.locator(".image-preview-message")).toContainText("Arquivo inválido");
  await page.locator(".tree-file").filter({ hasText: "large.png" }).click();
  await expect(page.locator(".image-preview-message")).toContainText("32 MiB");
  expect(await page.evaluate(() => (window as any).testState.imageReads)).not.toContain("/project/large.png");
  await expect(page.locator(".monaco-editor")).toHaveCount(0);
});

test("late image reads cannot replace the current tab", async ({ page }) => {
  await page.evaluate(() => { (window as any).testState.holdImages = true; });
  await page.locator(".tree-file").filter({ hasText: "picture.PNG" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.imagePending.length)).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "a.txt" }).click();
  await page.evaluate(() => { for (const resolve of (window as any).testState.imagePending) resolve(); });
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".image-preview")).toHaveCount(0);
});
