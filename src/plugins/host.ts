import {
  PLUGIN_API_VERSION, PLUGIN_PERMISSIONS, PluginApiError,
  type CommandHandler, type Disposable, type DocumentReplacement, type EditorDocument,
  type JsonValue, type PluginCommand, type PluginContext, type PluginDefinition,
  type PluginManifest, type PluginPermission, type ProjectInfo, type PluginPanel, type ThemeId, type PluginFile, type AiRequest, type AiModel, type AiEventHandler,
} from "./api";
import { copyJson, type PluginSettingsStore } from "./settings";

export interface PluginWorkspaceServices {
  getInfo(): ProjectInfo;
  getActiveDocument(): EditorDocument | null;
  replaceActiveDocument(change: DocumentReplacement): void;
  onDidChangeActiveDocument(listener: (document: EditorDocument | null) => void): Disposable;
}
export interface PluginIntegrations {
  registerPanel(id: string, panel: PluginPanel): Disposable;
  openPanel(id: string): void;
  setTheme(theme: ThemeId): void;
  listFiles(): readonly PluginFile[];
  scanFiles(): Promise<readonly PluginFile[]>;
  selectedFile(): PluginFile | null;
  readText(path: string): Promise<string>;
  exportText(name: string, text: string): Promise<void>;
  requestAi(request: AiRequest, signal: AbortSignal, onEvent?: AiEventHandler): Promise<string>;
  codexModels(signal: AbortSignal): Promise<readonly AiModel[]>;
  codexAccount(action: "login" | "login-device" | "logout" | "status", signal: AbortSignal, onOutput: (text: string) => void): Promise<boolean>;
}
type Phase = "activating" | "active" | "deactivating" | "inactive" | "failed";
type Entry = {
  manifest: PluginManifest; definition: PluginDefinition; grants: Set<PluginPermission>;
  phase: Phase; controller: AbortController; resources: Set<Disposable>;
  activation?: Promise<void>; cleanup?: Promise<void>; entered: boolean;
};
type RegisteredCommand = PluginCommand & { entry: Entry; handler: CommandHandler };

export function validateManifest(value: PluginManifest): PluginManifest {
  const invalid = () => new PluginApiError("INVALID_MANIFEST", "Manifesto de plugin inválido.");
  if (!value || typeof value !== "object") throw invalid();
  if (value.apiVersion !== PLUGIN_API_VERSION) throw new PluginApiError("INCOMPATIBLE_API", "Versão da API de plugins incompatível.");
  if (typeof value.id !== "string" || value.id.length > 100 || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(value.id)
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100
    || typeof value.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)
    || !Array.isArray(value.permissions) || new Set(value.permissions).size !== value.permissions.length
    || value.permissions.some((permission) => !PLUGIN_PERMISSIONS.includes(permission))) throw invalid();
  const commands = value.commands ?? [];
  if (!Array.isArray(commands) || new Set(commands.map((command) => command?.id)).size !== commands.length
    || commands.some((command) => !command || typeof command.id !== "string"
      || !command.id.startsWith(`${value.id}.`) || !/^[a-zA-Z0-9.-]{1,160}$/.test(command.id)
      || typeof command.title !== "string" || !command.title.trim() || command.title.length > 100)) throw invalid();
  return Object.freeze({ ...value, permissions: Object.freeze([...value.permissions]),
    commands: Object.freeze(commands.map((command) => Object.freeze({ id: command.id, title: command.title }))) });
}

function inactive() { return new PluginApiError("PLUGIN_INACTIVE", "O plugin não está ativo neste workspace."); }
function pluginError(cause: unknown): PluginApiError {
  return cause instanceof PluginApiError ? cause : new PluginApiError("PLUGIN_FAILED", "Falha na execução do plugin.", { cause });
}

// A hung asynchronous plugin must not block workspace teardown. Its context is
// revoked synchronously; cooperative work can additionally observe AbortSignal.
function bounded<T>(action: () => T | Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(inactive()));
    const timer = setTimeout(() => finish(() => reject(new PluginApiError("TIMEOUT", "O plugin excedeu o tempo limite."))), timeoutMs);
    const finish = (settle: () => void) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); settle(); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw inactive();
      return action();
    }).then((result) => finish(() => resolve(result)), (error) => finish(() => reject(pluginError(error))));
  });
}

export class PluginHost {
  private readonly entries = new Map<string, Entry>();
  private readonly commands = new Map<string, RegisteredCommand>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private disposal?: Promise<void>;

  constructor(private readonly workspace: PluginWorkspaceServices, private readonly settings: PluginSettingsStore,
    private readonly report: (error: PluginApiError, pluginId: string) => void = () => {},
    private readonly lifecycleTimeoutMs = 5000, private readonly integrations?: PluginIntegrations) {}

  async activate(definition: PluginDefinition, granted: readonly PluginPermission[] = []): Promise<void> {
    if (this.disposed) throw inactive();
    const manifest = validateManifest(definition?.manifest);
    if (typeof definition.activate !== "function" || (definition.deactivate !== undefined && typeof definition.deactivate !== "function")) {
      throw new PluginApiError("INVALID_MANIFEST", "Ciclo de vida do plugin inválido.");
    }
    if (!Array.isArray(granted) || granted.some((permission) => !manifest.permissions.includes(permission))) {
      throw new PluginApiError("PERMISSION_DENIED", "A permissão concedida não foi declarada pelo plugin.");
    }
    const previous = this.entries.get(manifest.id);
    if (previous && previous.phase !== "inactive" && previous.phase !== "failed") {
      throw new PluginApiError("PLUGIN_EXISTS", "O plugin já está registrado neste workspace.");
    }
    const entry: Entry = { manifest, definition: { manifest, activate: definition.activate.bind(definition),
      deactivate: definition.deactivate?.bind(definition) }, grants: new Set(granted), phase: "activating",
      controller: new AbortController(), resources: new Set(), entered: false };
    this.entries.set(manifest.id, entry);
    entry.activation = bounded(() => {
      entry.entered = true;
      return entry.definition.activate(this.context(entry));
    }, this.lifecycleTimeoutMs, entry.controller.signal).then(() => {
      this.check(entry);
      entry.phase = "active";
      this.changed();
    });
    try { await entry.activation; }
    catch (cause) {
      await this.cleanup(entry);
      entry.phase = "failed";
      this.changed();
      throw pluginError(cause);
    }
  }

  deactivate(pluginId: string): Promise<void> {
    const entry = this.entries.get(pluginId);
    return entry ? this.cleanup(entry) : Promise.resolve();
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.disposal = Promise.all([...this.entries.values()].map((entry) => this.cleanup(entry))).then(() => {
      this.entries.clear(); this.listeners.clear();
    });
    return this.disposal;
  }

  listCommands(): readonly PluginCommand[] {
    return [...this.commands.values()].filter(({ entry }) => entry.phase === "active")
      .map(({ id, title }) => ({ id, title }));
  }
  status(pluginId: string): Phase | undefined { return this.entries.get(pluginId)?.phase; }
  onDidChangeCommands(listener: () => void): Disposable {
    if (this.disposed) throw inactive();
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  async executeCommand(id: string, args: readonly JsonValue[] = []): Promise<JsonValue | void> {
    const command = this.commands.get(id);
    if (!command || command.entry.phase !== "active" || this.disposed) {
      throw new PluginApiError("COMMAND_NOT_FOUND", "Comando de plugin indisponível.");
    }
    if (!Array.isArray(args)) throw new PluginApiError("INVALID_ARGUMENT", "Os argumentos devem ser uma lista JSON.");
    const values = copyJson(args) as JsonValue[];
    try {
      const result = await bounded(() => command.handler(values, command.entry.controller.signal), 30_000, command.entry.controller.signal);
      this.check(command.entry);
      return result === undefined ? undefined : copyJson(result);
    } catch (cause) {
      if (cause instanceof PluginApiError && cause.code === "TIMEOUT") await this.cleanup(command.entry);
      throw pluginError(cause);
    }
  }

  private check(entry: Entry, permission?: PluginPermission) {
    if (this.disposed || entry.controller.signal.aborted || this.entries.get(entry.manifest.id) !== entry) throw inactive();
    if (permission && !entry.grants.has(permission)) throw new PluginApiError("PERMISSION_DENIED", `Permissão necessária: ${permission}.`);
  }
  private notify(error: unknown, entry: Entry) {
    try { this.report(pluginError(error), entry.manifest.id); } catch { /* Reporting cannot interrupt cleanup. */ }
  }
  private changed() {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* One UI listener must not break the registry. */ }
    }
  }
  private own(entry: Entry, resource: Disposable): Disposable {
    if (!resource || typeof resource.dispose !== "function") throw new PluginApiError("INVALID_ARGUMENT", "Recurso descartável inválido.");
    try { this.check(entry); } catch (cause) { try { resource.dispose(); } catch (error) { this.notify(error, entry); } throw cause; }
    let disposed = false;
    const tracked = { dispose: () => {
      if (disposed) return;
      disposed = true;
      entry.resources.delete(tracked);
      try { resource.dispose(); } catch (error) { this.notify(error, entry); }
    } };
    entry.resources.add(tracked);
    return tracked;
  }
  private cleanup(entry: Entry): Promise<void> {
    if (entry.cleanup) return entry.cleanup;
    entry.phase = "deactivating";
    entry.controller.abort();
    for (const resource of [...entry.resources].reverse()) resource.dispose();
    this.changed();
    entry.cleanup = (async () => {
      await entry.activation?.catch(() => {});
      if (entry.entered && entry.definition.deactivate) {
        try { await bounded(() => entry.definition.deactivate!(), this.lifecycleTimeoutMs); }
        catch (cause) { this.notify(cause, entry); }
      }
      entry.phase = "inactive";
      this.changed();
    })();
    return entry.cleanup;
  }

  private context(entry: Entry): PluginContext {
    const require = (permission: PluginPermission) => this.check(entry, permission);
    const integration = (permission: PluginPermission) => {
      require(permission);
      if (!this.integrations) throw new PluginApiError("PLUGIN_FAILED", "Integração indisponível neste workspace.");
      return this.integrations;
    };
    const withCancellation = async <T,>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      require("ai.request");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      entry.controller.signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted || entry.controller.signal.aborted) abort();
      try { const result = await action(controller.signal); require("ai.request"); return result; }
      finally { signal.removeEventListener("abort", abort); entry.controller.signal.removeEventListener("abort", abort); }
    };
    const snapshot = () => { const value = this.workspace.getActiveDocument(); return value ? Object.freeze({ ...value }) : null; };
    return Object.freeze({
      apiVersion: PLUGIN_API_VERSION, pluginId: entry.manifest.id, signal: entry.controller.signal,
      subscriptions: Object.freeze({ add: (resource: Disposable) => this.own(entry, resource) }),
      workspace: Object.freeze({ getInfo: () => { require("workspace.read"); return Object.freeze({ ...this.workspace.getInfo() }); } }),
      editor: Object.freeze({
        getActiveDocument: () => { require("editor.read"); return snapshot(); },
        replaceActiveDocument: (change: DocumentReplacement) => {
          require("editor.write");
          if (!change || typeof change.documentId !== "string" || !Number.isSafeInteger(change.expectedVersion)
            || change.expectedVersion < 1 || typeof change.text !== "string") throw new PluginApiError("INVALID_ARGUMENT", "Edição de documento inválida.");
          this.workspace.replaceActiveDocument({ ...change });
        },
        onDidChangeActiveDocument: (listener: (document: EditorDocument | null) => void) => {
          require("editor.read");
          if (typeof listener !== "function") throw new PluginApiError("INVALID_ARGUMENT", "Listener inválido.");
          return this.own(entry, this.workspace.onDidChangeActiveDocument((value) => {
            if (entry.controller.signal.aborted) return;
            try {
              void Promise.resolve(listener(value ? Object.freeze({ ...value }) : null)).catch((cause) => this.notify(cause, entry));
            } catch (cause) { this.notify(cause, entry); }
          }));
        },
      }),
      commands: Object.freeze({ register: (id: string, handler: CommandHandler) => {
        require("commands.register");
        const declared = entry.manifest.commands?.find((command) => command.id === id);
        if (!declared || typeof handler !== "function") throw new PluginApiError("INVALID_ARGUMENT", "O comando deve ser declarado no manifesto.");
        if (this.commands.has(id)) throw new PluginApiError("COMMAND_EXISTS", "O comando já foi registrado.");
        this.commands.set(id, { ...declared, handler, entry });
        const resource = this.own(entry, { dispose: () => { this.commands.delete(id); this.changed(); } });
        this.changed();
        return resource;
      } }),
      ui: Object.freeze({
        registerPanel: (panel: PluginPanel) => this.own(entry, integration("ui.panel").registerPanel(entry.manifest.id, panel)),
        openPanel: () => integration("ui.panel").openPanel(entry.manifest.id),
      }),
      appearance: Object.freeze({ setTheme: (theme: ThemeId) => {
        if (!["crimson", "dawn", "midnight"].includes(theme)) throw new PluginApiError("INVALID_ARGUMENT", "Tema inválido.");
        integration("appearance.write").setTheme(theme);
      } }),
      files: Object.freeze({
        list: () => integration("files.read").listFiles().map((file) => Object.freeze({ ...file })),
        scan: async () => { const files = await integration("files.read").scanFiles(); require("files.read"); return files.map((file) => Object.freeze({ ...file })); },
        getSelection: () => { const file = integration("files.read").selectedFile(); return file ? Object.freeze({ ...file }) : null; },
        readText: async (path: string) => { const text = await integration("files.read").readText(path); require("files.read"); return text; },
        exportText: async (name: string, text: string) => { await integration("files.export").exportText(name, text); require("files.export"); },
      }),
      ai: Object.freeze({
        models: (signal: AbortSignal) => withCancellation(signal, (cancel) => integration("ai.request").codexModels(cancel)),
        request: (request: AiRequest, signal: AbortSignal, onEvent?: AiEventHandler) => withCancellation(signal, (cancel) => {
          if (request.accessMode !== undefined) require("ai.execute");
          return integration("ai.request").requestAi(request, cancel, onEvent);
        }),
        account: (action: "login" | "login-device" | "logout" | "status", signal: AbortSignal, onOutput: (text: string) => void) =>
          withCancellation(signal, (cancel) => integration("ai.request").codexAccount(action, cancel, (text) => { if (!cancel.aborted) onOutput(text); })),
      }),
      settings: Object.freeze({
        get: (key: string) => { require("settings.read"); return this.settings.get(entry.manifest.id, key); },
        set: (key: string, value: JsonValue) => { require("settings.write"); this.settings.set(entry.manifest.id, key, value); },
        delete: (key: string) => { require("settings.write"); this.settings.delete(entry.manifest.id, key); },
      }),
    });
  }
}
