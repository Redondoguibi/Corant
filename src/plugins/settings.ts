import { PluginApiError, type JsonValue } from "./api";

export function copyJson(value: unknown): JsonValue {
  const seen = new Set<object>();
  function check(item: unknown, depth: number): void {
    if (depth > 32) throw new Error("Estrutura muito profunda.");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || seen.has(item)) throw new Error("Valor JSON inválido.");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error("Objeto JSON inválido.");
    }
    seen.add(item);
    for (const child of Object.values(item)) check(child, depth + 1);
    seen.delete(item);
  }
  try {
    check(value, 0);
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error("Limite de 64 KiB excedido.");
    return JSON.parse(text) as JsonValue;
  } catch (cause) {
    throw new PluginApiError("INVALID_ARGUMENT", "Use um valor JSON válido de até 64 KiB.", { cause });
  }
}

export interface PluginSettingsStore {
  get(pluginId: string, key: string): JsonValue | undefined;
  set(pluginId: string, key: string, value: JsonValue): void;
  delete(pluginId: string, key: string): void;
}

// Namespaced by project and plugin; intended for preferences, never provider secrets.
export function createPluginSettings(projectPath: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): PluginSettingsStore {
  const path = (plugin: string, key: string) => {
    if (typeof key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key)) {
      throw new PluginApiError("INVALID_ARGUMENT", "Chave de configuração inválida.");
    }
    return `corant:plugin-settings:1:${JSON.stringify([projectPath, plugin, key])}`;
  };
  function access<T>(action: () => T): T {
    try { return action(); }
    catch (cause) {
      if (cause instanceof PluginApiError) throw cause;
      throw new PluginApiError("STORAGE_ERROR", "Não foi possível acessar as configurações do plugin.", { cause });
    }
  }
  return {
    get: (plugin, key) => access(() => {
      const text = storage.getItem(path(plugin, key));
      if (text === null) return undefined;
      return copyJson(JSON.parse(text));
    }),
    set: (plugin, key, value) => access(() => storage.setItem(path(plugin, key), JSON.stringify(copyJson(value)))),
    delete: (plugin, key) => access(() => storage.removeItem(path(plugin, key))),
  };
}
