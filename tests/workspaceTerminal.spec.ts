import { test, expect } from "@playwright/test";

test("disposing during restart cleanup does not spawn another shell", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite source URL.
    const { WorkspaceTerminal } = await import("/src/services/workspaceTerminal.ts");
    // @ts-expect-error Browser-only Vite URL.
    const { mockIPC } = await import("/node_modules/@tauri-apps/api/mocks.js");
    let release!: () => void;
    let stopping!: () => void;
    const stopped = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { stopping = resolve; });
    let starts = 0;
    mockIPC((command: string) => {
      if (command === "terminal_start") return String(++starts);
      if (command === "terminal_stop") { stopping(); return stopped; }
      throw new Error(command);
    });
    const terminal = new WorkspaceTerminal("C:\\project");
    await terminal.start(80, 24, () => {});
    const restart = terminal.start(80, 24, () => {}).catch(() => "cancelled");
    await entered;
    const dispose = terminal.dispose();
    release();
    const outcome = await restart;
    await dispose;
    return { starts, outcome };
  });
  expect(result).toEqual({ starts: 1, outcome: "cancelled" });
});

test("resize requests stay ordered and queued old sizes are discarded", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite source URL.
    const { WorkspaceTerminal } = await import("/src/services/workspaceTerminal.ts");
    // @ts-expect-error Browser-only Vite URL.
    const { mockIPC } = await import("/node_modules/@tauri-apps/api/mocks.js");
    let release!: () => void;
    let resizing!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { resizing = resolve; });
    const calls: number[] = [];
    let starts = 0;
    mockIPC((command: string, args: any) => {
      if (command === "terminal_start") return String(++starts);
      if (command === "terminal_stop") return;
      if (command === "terminal_resize") {
        calls.push(args.cols);
        if (args.cols === 90) { resizing(); return held; }
        return;
      }
      throw new Error(command);
    });
    const terminal = new WorkspaceTerminal("C:\\project");
    await terminal.start(80, 24, () => {});
    const first = terminal.resize(90, 24);
    await entered;
    const second = terminal.resize(100, 24);
    await Promise.resolve();
    const beforeRelease = calls.slice();
    await terminal.start(80, 24, () => {});
    const current = terminal.resize(120, 24);
    release();
    await Promise.all([first, second, current]);
    await terminal.dispose();
    return { beforeRelease, calls };
  });
  expect(result).toEqual({ beforeRelease: [90], calls: [90, 120] });
});

test("a late start is stopped and its output never reaches a new workspace", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the source module in the browser.
    const { WorkspaceTerminal } = await import("/src/services/workspaceTerminal.ts");
    // @ts-expect-error Browser-only Vite URL.
    const { mockIPC } = await import("/node_modules/@tauri-apps/api/mocks.js");
    let releaseFirst!: (id: string) => void;
    const first = new Promise<string>((resolve) => { releaseFirst = resolve; });
    const channels: Array<{ onmessage: (event: unknown) => void }> = [];
    const stopped: string[] = [];
    const output: string[] = [];
    let starts = 0;
    mockIPC((command: string, args: any) => {
      if (command === "terminal_start") {
        channels.push(args.onEvent);
        return ++starts === 1 ? first : "2";
      }
      if (command === "terminal_stop") { stopped.push(args.sessionId); return; }
      throw new Error(`Unexpected IPC: ${command}`);
    });
    const old = new WorkspaceTerminal("C:\\project-a");
    const pending = old.start(80, 24, (event: { type: string }) => output.push(event.type));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disposed = old.dispose();
    releaseFirst("1");
    await pending.catch(() => undefined);
    await disposed;
    const current = new WorkspaceTerminal("C:\\project-b");
    await current.start(80, 24, (event: { type: string }) => output.push(event.type));
    channels[0].onmessage({ type: "output", sessionId: "1", data: [65] });
    channels[1].onmessage({ type: "output", sessionId: "2", data: [66] });
    await current.dispose();
    return { stopped, output };
  });
  expect(result).toEqual({ stopped: ["1", "2"], output: ["output"] });
});

test("exit disables input and stop remains idempotent", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the source module in the browser.
    const { WorkspaceTerminal } = await import("/src/services/workspaceTerminal.ts");
    // @ts-expect-error Browser-only Vite URL.
    const { mockIPC } = await import("/node_modules/@tauri-apps/api/mocks.js");
    let channel: { onmessage: (event: unknown) => void };
    const calls: string[] = [];
    mockIPC((command: string, args: any) => {
      calls.push(command);
      if (command === "terminal_start") { channel = args.onEvent; return "42"; }
      if (command === "terminal_stop") return;
      throw new Error(`Unexpected IPC: ${command}`);
    });
    const terminal = new WorkspaceTerminal("C:\\project");
    await terminal.start(80, 24, () => {});
    channel!.onmessage({ type: "exit", sessionId: "42", code: 0, error: null });
    const rejected = await terminal.input("x").then(() => false, () => true);
    await terminal.stop();
    await terminal.stop();
    return { rejected, calls };
  });
  expect(result).toEqual({ rejected: true, calls: ["terminal_start", "terminal_stop"] });
});
