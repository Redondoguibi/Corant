import { expect, type Page } from "@playwright/test";
import path from "node:path";

export async function setupWorkspace(page: Page) {
  // Use the installed Monaco assets so the UI tests do not depend on its CDN.
  await page.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@[^/]+\/min\/vs\/(.+)/, async (route) => {
    const relative = new URL(route.request().url()).pathname.split("/min/vs/")[1];
    await route.fulfill({ path: path.resolve("node_modules/monaco-editor/min/vs", relative) });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    // @ts-expect-error Browser-only Vite URL.
    const { mockIPC, mockWindows } = await import("/node_modules/@tauri-apps/api/mocks.js");
    const state = {
      files: { "/project/a.txt": "alpha\nbeta", "/project/b.txt": "second" } as Record<string, string>,
      writes: [] as Array<{ path: string; content: string }>,
      failDestroy: false, authenticated: false, aiRequests: [] as any[], accountActions: [] as string[], cancelled: [] as string[], aiResponse: 'replacement', holdAi: false, pendingAi: [] as Array<{ id: string; release: () => void }>,
      failModels: false, modelCalls: 0, models: [{ model: "test-codex", displayName: "Codex de teste", isDefault: true }, { model: "test-fast", displayName: "Modelo rápido", isDefault: false }],
      holdAccount: false, pendingAccounts: [] as Array<{ id: string; finish: (success: boolean) => void }>,
      failWrites: false, confirmed: true, projectPicker: "/project", destroyed: false,
      directories: [] as string[], holdWrites: false,
      pendingWrites: [] as Array<{ path: string; release: () => void }>,
      mutations: [] as string[], dialogs: [] as string[], failMutation: false,
      terminalStarts: 0, terminalStops: [] as string[], terminalInputs: [] as number[][],
      terminalResizes: [] as Array<{ cols: number; rows: number }>,
      terminalChannels: [] as Array<{ onmessage: (event: unknown) => void }>,
    };
    (window as any).testState = state;
    (window as any).isTauri = true;
    mockWindows("main");
    mockIPC((command: string, args: any) => {
      if (command === "plugin:dialog|open") return state.projectPicker;
      if (command === "plugin:dialog|message") {
        state.dialogs.push(args.title);
        return state.confirmed ? args.buttons.OkCancelCustom[0] : args.buttons.OkCancelCustom[1];
      }
      if (command === "allow_project_directory") return args.path;
      if (command === "plugin_read_text") { const text = state.files[args.projectPath + "/" + args.path]; if (text === undefined) throw new Error("Arquivo ausente"); return text; }
      if (command === "plugin_export_text") { const path = args.projectPath + "/" + args.name; if (path in state.files) throw new Error("O nome já existe"); state.files[path] = args.text; return; }
      if (command === "copilot_models") { state.modelCalls += 1; if (state.failModels) throw new Error("Falha ao consultar modelos"); return state.models; }
      if (command === "copilot_account") {
        state.accountActions.push(args.action);
        if (args.action === "login" || args.action === "login-device") {
          args.onOutput.onmessage(Array.from(new TextEncoder().encode("https://auth.openai.com/codex/device Code: TEST-123")));
          if (state.holdAccount) return new Promise<boolean>((resolve, reject) => state.pendingAccounts.push({ id: args.requestId, finish: (success) => { state.authenticated = success; if (success) resolve(true); else reject(new Error("Login expirado")); } }));
          state.authenticated = true;
        }
        if (args.action === "logout") state.authenticated = false;
        return state.authenticated;
      }
      if (command === "copilot_request") { state.aiRequests.push(args.request); if (state.holdAi) return new Promise<string>((resolve) => state.pendingAi.push({ id: args.requestId, release: () => resolve(state.aiResponse) })); return state.aiResponse; }
      if (command === "copilot_cancel") { state.cancelled.push(args.requestId); state.pendingAi.find((request) => request.id === args.requestId)?.release(); state.pendingAccounts.find((request) => request.id === args.requestId)?.finish(false); return; }
      if (command === "terminal_start") {
        state.terminalStarts += 1;
        state.terminalChannels.push(args.onEvent);
        return String(state.terminalStarts);
      }
      if (command === "terminal_stop") { state.terminalStops.push(args.sessionId); return; }
      if (command === "terminal_input") { state.terminalInputs.push(args.data); return; }
      if (command === "terminal_resize") { state.terminalResizes.push({ cols: args.cols, rows: args.rows }); return; }
      if (command === "plugin:fs|read_dir") {
        const children = new Map<string, boolean>();
        for (const file of [...Object.keys(state.files), ...state.directories]) {
          if (!file.startsWith(args.path + "/")) continue;
          const relative = file.slice(args.path.length + 1);
          children.set(relative.split("/")[0], relative.includes("/") || state.directories.includes(file));
        }
        return [...children].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory }));
      }
      if (command === "plugin:fs|mkdir") { state.directories.push(args.path); return; }
      if (command === "plugin:fs|rename" || command === "plugin:fs|remove") {
        if (state.failMutation) throw new Error("Mutation failed");
        const source = args.oldPath ?? args.path;
        const matches = (path: string) => path === source || path.startsWith(source + "/");
        const remap = (path: string) => args.newPath + path.slice(source.length);
        for (const [file, content] of Object.entries(state.files)) {
          if (!matches(file)) continue;
          delete state.files[file];
          if (args.newPath) state.files[remap(file)] = content;
        }
        state.directories = state.directories.flatMap((path) => matches(path) ? args.newPath ? [remap(path)] : [] : [path]);
        state.mutations.push(command);
        return;
      }
      if (command === "plugin:fs|read_text_file") return Array.from(new TextEncoder().encode(state.files[args.path]));
      if (command === "plugin:window|destroy") { if (state.failDestroy) throw new Error("Destroy failed"); state.destroyed = true; return; }
      throw new Error(`Unhandled test IPC: ${command}`);
    }, { shouldMockEvents: true });
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command: string, args: any, options: any) => {
      if (command !== "plugin:fs|write_text_file") return invoke(command, args, options);
      if (state.failWrites) throw new Error("Disk unavailable");
      const filePath = decodeURIComponent(options.headers.path);
      const content = new TextDecoder().decode(args);
      if (state.holdWrites) await new Promise<void>((release) => state.pendingWrites.push({ path: filePath, release }));
      state.files[filePath] = content;
      state.writes.push({ path: filePath, content });
    };
  });
  await page.getByRole("button", { name: "Abrir projeto", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
}
