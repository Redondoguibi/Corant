import { test, expect } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";

test.beforeEach(async ({ page }) => setupWorkspace(page));

test("a delayed resize failure cannot mark the restarted terminal as failed", async ({ page }) => {
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = (command: string, args: any, options: any) => {
      if (command === "terminal_resize" && args.sessionId === "1") {
        return new Promise((_, reject) => { (window as any).rejectOldResize = reject; });
      }
      return invoke(command, args, options);
    };
  });
  await page.keyboard.press("Control+`");
  const panel = page.getByRole("region", { name: "Terminal integrado" });
  await expect(panel.getByText("Em execução")).toBeVisible();
  await panel.getByRole("separator").press("ArrowUp");
  await expect.poll(() => page.evaluate(() => typeof (window as any).rejectOldResize)).toBe("function");
  await panel.getByRole("button", { name: "Reiniciar terminal" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalStarts)).toBe(2);
  await expect(panel.getByText("Em execução")).toBeVisible();
  await page.evaluate(() => { (window as any).rejectOldResize(new Error("old resize failed")); });
  // A new resize resolving proves the old rejection and its handlers were processed.
  await panel.getByRole("separator").press("ArrowUp");
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalResizes.length)).toBeGreaterThan(0);
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("stop during startup waits for native cleanup", async ({ page }) => {
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command: string, args: any, options: any) => {
      const result = await invoke(command, args, options);
      if (command === "terminal_start" || command === "terminal_stop") {
        await new Promise<void>((resolve) => { (window as any)[command + "Release"] = resolve; });
      }
      return result;
    };
  });
  await page.keyboard.press("Control+`");
  const panel = page.getByRole("region", { name: "Terminal integrado" });
  await expect.poll(() => page.evaluate(() => typeof (window as any).terminal_startRelease)).toBe("function");
  await panel.getByRole("button", { name: "Encerrar terminal" }).click();
  await expect(panel.getByText("Encerrando…")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Reiniciar terminal" })).toBeDisabled();
  await page.evaluate(() => { (window as any).terminal_startRelease(); });
  await expect.poll(() => page.evaluate(() => typeof (window as any).terminal_stopRelease)).toBe("function");
  await expect(panel.getByText("Encerrando…")).toBeVisible();
  await page.evaluate(() => { (window as any).terminal_stopRelease(); });
  await expect(panel.getByText("Parado")).toBeVisible();
  expect(await page.evaluate(() => (window as any).testState.terminalStarts)).toBe(1);
});

test("terminal keeps one session while hidden, forwards input and ends on project close", async ({ page }, testInfo) => {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Terminal", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Mostrar terminal" }).click();
  const panel = page.getByRole("region", { name: "Terminal integrado" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Em execução")).toBeVisible();
  await page.evaluate(() => {
    (window as any).testState.terminalChannels[0].onmessage({
      type: "output", sessionId: "1", data: Array.from(new TextEncoder().encode("terminal pronto\r\n")),
    });
  });
  await page.screenshot({ path: testInfo.outputPath("terminal-panel.png") });
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalStarts)).toBe(1);

  await panel.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo teste");
  await expect.poll(() => page.evaluate(() => {
    const inputs: number[][] = (window as any).testState.terminalInputs;
    return new TextDecoder().decode(new Uint8Array(inputs.flat()));
  })).toContain("echo teste");
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("tab", { name: "a.txt" })).toBeVisible();

  await panel.getByRole("button", { name: "Ocultar terminal" }).click();
  await expect(panel).toBeHidden();
  const resizesBeforeReopen = await page.evaluate(() => (window as any).testState.terminalResizes.length);
  await page.keyboard.press("Control+`");
  await expect(panel).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalResizes.length)).toBeGreaterThan(resizesBeforeReopen);
  expect(await page.evaluate(() => (window as any).testState.terminalStarts)).toBe(1);
  await page.getByRole("menubar").getByRole("menuitem", { name: "Arquivo", exact: true }).click();
  await page.getByRole("menuitem", { name: "Abrir projeto…" }).click();
  await expect(panel.getByText("Em execução")).toBeVisible();
  expect(await page.evaluate(() => (window as any).testState.terminalStarts)).toBe(1);

  const previousRenderer = await panel.locator(".xterm").elementHandle();
  await panel.getByRole("button", { name: "Reiniciar terminal" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalStarts)).toBe(2);
  // Discard xterm's pending write buffer along with the old session.
  expect(await previousRenderer!.evaluate((element) => element.isConnected)).toBe(false);
  await expect(panel.locator(".xterm")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalStops)).toContain("1");
  await page.evaluate(() => {
    (window as any).testState.terminalChannels[0].onmessage({ type: "exit", sessionId: "1", code: 1, error: null });
  });
  await expect(panel.getByText("Em execução")).toBeVisible();

  await page.getByRole("button", { name: "‹" }).click();
  await expect(page.getByRole("button", { name: "Abrir projeto", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalStops)).toContain("2");
});

test("shell exit and resize are reflected in the panel", async ({ page }) => {
  await page.keyboard.press("Control+`");
  const panel = page.getByRole("region", { name: "Terminal integrado" });
  await expect(panel.getByText("Em execução")).toBeVisible();
  const divider = panel.getByRole("separator", { name: "Redimensionar terminal" });
  const box = await divider.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 70);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).testState.terminalResizes.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as any).testState.terminalChannels[0].onmessage({ type: "exit", sessionId: "1", code: 9, error: null });
  });
  await expect(panel.getByText("Encerrado (9)")).toBeVisible();
  await panel.getByRole("button", { name: "Reiniciar terminal" }).click();
  await expect(panel.getByText("Em execução")).toBeVisible();
  await panel.getByRole("button", { name: "Encerrar terminal" }).click();
  await expect(panel.getByText("Parado")).toBeVisible();
});
