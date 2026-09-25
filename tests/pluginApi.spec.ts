import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    // @ts-expect-error Vite source URL.
    const { PluginHost } = await import("/src/plugins/host.ts");
    // @ts-expect-error Vite source URL.
    const { createPluginSettings } = await import("/src/plugins/settings.ts");
    const listeners = new Set<(value: unknown) => void>();
    const errors: string[] = [];
    const document = { id: "model-1", path: "/project/a.txt", version: 1, language: "plaintext", text: "alpha" };
    const settings = createPluginSettings("/project", localStorage);
    const workspace = {
      getInfo: () => ({ name: "project", path: "/project" }), getActiveDocument: () => document,
      replaceActiveDocument: () => { throw new Error("Not used in host tests"); },
      onDidChangeActiveDocument: (listener: (value: unknown) => void) => {
        listeners.add(listener); return { dispose: () => listeners.delete(listener) };
      },
    };
    const host = new PluginHost(workspace, settings, (error: { code: string }) => errors.push(error.code), 100);
    const manifest = { id: "test.plugin", name: "Test plugin", version: "1.0.0", apiVersion: 1,
      permissions: ["workspace.read", "editor.read", "editor.write", "commands.register", "settings.read", "settings.write"],
      commands: [{ id: "test.plugin.run", title: "Run" }] };
    (window as any).pluginTest = { host, workspace, settings, errors, listeners, manifest, document, PluginHost, createPluginSettings };
  });
});

test("manifests and host grants are validated independently", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { host, manifest } = (window as any).pluginTest;
    const codes: string[] = [];
    const error = (cause: any) => codes.push(cause.code);
    await host.activate({ manifest: { ...manifest, apiVersion: 2 }, activate() {} }).catch(error);
    await host.activate({ manifest: { ...manifest, permissions: ["terminal.execute"] }, activate() {} }).catch(error);
    await host.activate({ manifest: { ...manifest, commands: [{ id: "corant.delete", title: "bad" }] }, activate() {} }).catch(error);
    await host.activate({ manifest: { ...manifest, permissions: [] }, activate() {} }, ["editor.write"]).catch(error);
    await host.activate({ manifest, activate(api: any) {
      for (const call of [() => api.workspace.getInfo(), () => api.editor.getActiveDocument(),
        () => api.editor.replaceActiveDocument({}), () => api.commands.register("test.plugin.run", () => {}),
        () => api.settings.get("theme"), () => api.settings.set("theme", "dark")]) {
        try { call(); } catch (cause) { error(cause); }
      }
    } });
    await host.dispose();
    return codes;
  });
  expect(result).toEqual(["INCOMPATIBLE_API", "INVALID_MANIFEST", "INVALID_MANIFEST", "PERMISSION_DENIED", ...Array(6).fill("PERMISSION_DENIED")]);
});

test("failed activation revokes commands, listeners and old contexts before retry", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { host, manifest, listeners, errors } = (window as any).pluginTest;
    let previous: any;
    let disposed = 0;
    const failed = await host.activate({ manifest, activate(api: any) {
      previous = api;
      api.commands.register("test.plugin.run", () => "old");
      api.editor.onDidChangeActiveDocument(() => {});
      api.subscriptions.add({ dispose() { disposed++; throw new Error("cleanup failure"); } });
      throw new Error("activation failure");
    } }, manifest.permissions).catch((cause: any) => cause.code);
    const afterFailure = { commands: host.listCommands().length, listeners: listeners.size, disposed };
    await host.activate({ manifest, activate(api: any) { api.commands.register("test.plugin.run", () => "new"); } }, manifest.permissions);
    let stale;
    try { previous.workspace.getInfo(); } catch (cause: any) { stale = cause.code; }
    const command = await host.executeCommand("test.plugin.run");
    await host.dispose();
    await host.dispose();
    return { failed, afterFailure, stale, command, errors, disposed };
  });
  expect(result).toEqual({ failed: "PLUGIN_FAILED", afterFailure: { commands: 0, listeners: 0, disposed: 1 },
    stale: "PLUGIN_INACTIVE", command: "new", errors: ["PLUGIN_FAILED"], disposed: 1 });
});

test("disposing an activation revokes late work and bounds a hung deactivation", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { host, manifest, errors } = (window as any).pluginTest;
    let release!: () => void;
    let entered!: () => void;
    let late!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const continued = new Promise<void>((resolve) => { late = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let lateCode;
    let disposed = 0;
    const activating = host.activate({ manifest, async activate(api: any) {
      entered(); await wait;
      try { api.subscriptions.add({ dispose() { disposed++; } }); } catch (cause: any) { lateCode = cause.code; }
      late();
    }, deactivate: () => new Promise(() => {}) }, manifest.permissions).catch((cause: any) => cause.code);
    await started;
    await host.dispose();
    release();
    await continued;
    return { code: await activating, lateCode, disposed, errors, commands: host.listCommands() };
  });
  expect(result).toEqual({ code: "PLUGIN_INACTIVE", lateCode: "PLUGIN_INACTIVE", disposed: 1, errors: ["TIMEOUT"], commands: [] });
});

test("command ownership, duplicate registration and pending cancellation", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { host, manifest } = (window as any).pluginTest;
    let api: any;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    await host.activate({ manifest, activate(context: any) { api = context;
      api.commands.register("test.plugin.run", async (_args: unknown, signal: AbortSignal) => {
        entered(); await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return api.workspace.getInfo().path;
      });
    } }, manifest.permissions);
    const codes: string[] = [];
    for (const id of ["test.plugin.run", "other.plugin.run"]) {
      try { api.commands.register(id, () => {}); } catch (cause: any) { codes.push(cause.code); }
    }
    await host.activate({ manifest, activate() {} }, manifest.permissions).catch((cause: any) => codes.push(cause.code));
    const pending = host.executeCommand("test.plugin.run").catch((cause: any) => cause.code);
    await started;
    await host.deactivate(manifest.id);
    codes.push(await pending);
    await host.executeCommand("test.plugin.run").catch((cause: any) => codes.push(cause.code));
    await host.dispose();
    return codes;
  });
  expect(result).toEqual(["COMMAND_EXISTS", "INVALID_ARGUMENT", "PLUGIN_EXISTS", "PLUGIN_INACTIVE", "COMMAND_NOT_FOUND"]);
});

test("settings remain isolated by plugin and workspace and report storage errors", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { settings, createPluginSettings } = (window as any).pluginTest;
    const otherProject = createPluginSettings("/another", localStorage);
    const value = { theme: "dark" };
    settings.set("test.plugin", "appearance", value);
    value.theme = "light";
    const loaded = settings.get("test.plugin", "appearance");
    loaded.theme = "red";
    const actual = settings.get("test.plugin", "appearance");
    const isolated = settings.get("other.plugin", "appearance") === undefined && otherProject.get("test.plugin", "appearance") === undefined;
    const codes: string[] = [];
    const cyclic: any = {}; cyclic.self = cyclic;
    for (const item of [cyclic, NaN, () => {}, "a".repeat(65537)]) {
      try { settings.set("test.plugin", "invalid", item); } catch (cause: any) { codes.push(cause.code); }
    }
    const broken = createPluginSettings("/project", { setItem() { throw new Error("quota"); } });
    try { broken.set("test.plugin", "theme", "dark"); } catch (cause: any) { codes.push(cause.code); }
    settings.delete("test.plugin", "appearance");
    return { actual, isolated, removed: settings.get("test.plugin", "appearance") === undefined, codes };
  });
  expect(result).toEqual({ actual: { theme: "dark" }, isolated: true, removed: true,
    codes: [...Array(4).fill("INVALID_ARGUMENT"), "STORAGE_ERROR"] });
});
