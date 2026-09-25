export const PLUGIN_API_VERSION = 1 as const;

export const PLUGIN_PERMISSIONS = [
  "workspace.read", "editor.read", "editor.write", "commands.register", "settings.read", "settings.write",
] as const;
export type PluginPermission = typeof PLUGIN_PERMISSIONS[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Disposable { dispose(): void }
export interface PluginCommand { readonly id: string; readonly title: string }
export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  readonly permissions: readonly PluginPermission[];
  readonly commands?: readonly PluginCommand[];
}
export interface ProjectInfo { readonly name: string; readonly path: string }
export interface EditorDocument {
  readonly id: string;
  readonly path: string;
  readonly version: number;
  readonly language: string;
  readonly text: string;
}
export interface DocumentReplacement {
  readonly documentId: string;
  readonly expectedVersion: number;
  readonly text: string;
}
export type CommandHandler = (args: readonly JsonValue[], signal: AbortSignal) => JsonValue | void | Promise<JsonValue | void>;

export interface PluginContext {
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  readonly pluginId: string;
  readonly signal: AbortSignal;
  readonly subscriptions: { add(resource: Disposable): Disposable };
  readonly workspace: { getInfo(): ProjectInfo };
  readonly editor: {
    getActiveDocument(): EditorDocument | null;
    replaceActiveDocument(change: DocumentReplacement): void;
    onDidChangeActiveDocument(listener: (document: EditorDocument | null) => void): Disposable;
  };
  readonly commands: { register(id: string, handler: CommandHandler): Disposable };
  readonly settings: {
    get(key: string): JsonValue | undefined;
    set(key: string, value: JsonValue): void;
    delete(key: string): void;
  };
}

// Definitions execute as trusted application code. This API is not a JS sandbox.
export interface PluginDefinition {
  readonly manifest: PluginManifest;
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
export interface BuiltinPlugin {
  readonly definition: PluginDefinition;
  // Granted by Corant, separately from the plugin's requested permissions.
  readonly grants: readonly PluginPermission[];
}

export type PluginErrorCode = "INVALID_MANIFEST" | "INCOMPATIBLE_API" | "PERMISSION_DENIED" | "INVALID_ARGUMENT"
  | "PLUGIN_INACTIVE" | "PLUGIN_EXISTS" | "PLUGIN_FAILED" | "TIMEOUT" | "COMMAND_NOT_FOUND"
  | "COMMAND_EXISTS" | "DOCUMENT_CHANGED" | "WORKSPACE_BUSY" | "STORAGE_ERROR";
export class PluginApiError extends Error {
  constructor(readonly code: PluginErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PluginApiError";
  }
}
