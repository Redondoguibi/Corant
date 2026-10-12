import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PluginContext, PluginDefinition, PluginManifest } from "./api";
import { PluginHost, validateManifest } from "./host";

export interface ExternalManifest extends PluginManifest {
  entrypoint: string;
}
export interface CatalogEntry {
  folder: string;
  manifest: unknown;
  fingerprint: string | null;
  error: string | null;
}
export interface Catalog {
  directory: string;
  plugins: CatalogEntry[];
}
export interface PluginPackage {
  manifest: unknown;
  source: string;
  fingerprint: string;
}
export interface ExternalServices {
  list(): Promise<Catalog>;
  install(source: string): Promise<string>;
  remove(folder: string): Promise<void>;
  load(folder: string, fingerprint: string): Promise<PluginPackage>;
}
export const externalServices: ExternalServices = {
  list: () => invoke("external_plugins_list"),
  install: (source) => invoke("external_plugins_install", { source }),
  remove: (folder) => invoke("external_plugins_remove", { folder }),
  load: (folder, fingerprint) =>
    invoke("external_plugins_load", { folder, fingerprint }),
};
export function externalManifest(value: unknown): ExternalManifest {
  const manifest = validateManifest(value as PluginManifest);
  const entrypoint = (value as { entrypoint?: unknown }).entrypoint;
  if (
    manifest.id.startsWith("corant.") ||
    typeof entrypoint !== "string" ||
    entrypoint.length > 200 ||
    !entrypoint
      .split("/")
      .every(
        (part) =>
          part !== "." && part !== ".." && /^[a-zA-Z0-9_.-]+$/.test(part),
      ) ||
    !/\.(m?js)$/.test(entrypoint)
  ) {
    throw new Error(
      "ID reservado ou entrypoint inválido. Use um módulo .js/.mjs relativo ao plugin.",
    );
  }
  return { ...manifest, entrypoint };
}
export async function importPlugin(
  source: string,
  manifest: ExternalManifest,
): Promise<PluginDefinition> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const module = await Promise.race([
      import(/* @vite-ignore */ url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "O módulo excedeu o tempo de carregamento. Reinicie o app antes de tentar novamente.",
              ),
            ),
          5000,
        );
      }),
    ]);
    if (
      typeof module.activate !== "function" ||
      (module.deactivate !== undefined &&
        typeof module.deactivate !== "function")
    )
      throw new Error(
        "O módulo deve exportar activate(context) e, opcionalmente, deactivate().",
      );
    return {
      manifest,
      activate: (api: PluginContext) =>
        module.activate(api, Object.freeze({ React })),
      deactivate: module.deactivate ? () => module.deactivate() : undefined,
    };
  } finally {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
}
export type ExternalRow = {
  folder: string;
  manifest?: ExternalManifest;
  fingerprint?: string;
  error?: string;
  active: boolean;
  approved: boolean;
  removable: boolean;
};
export type ExternalState = {
  directory: string;
  rows: ExternalRow[];
  busy: boolean;
  error: string;
};
const folderPattern = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
export class ExternalPluginManager {
  private state: ExternalState = {
    directory: "",
    rows: [],
    busy: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private loaded = new Map<string, string>();
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private hostSubscription: { dispose(): void };
  constructor(
    private host: PluginHost,
    private projectPath: string,
    private services: ExternalServices = externalServices,
    private storage: Pick<
      Storage,
      "getItem" | "setItem" | "removeItem"
    > = localStorage,
    private importer: typeof importPlugin = importPlugin,
  ) {
    this.hostSubscription = host.onDidChangeCommands(() => this.sync());
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(patch: Partial<ExternalState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private sync() {
    this.update({
      rows: this.state.rows.map((row) => ({
        ...row,
        active: row.manifest
          ? this.host.status(row.manifest.id) === "active"
          : false,
      })),
    });
  }
  private key(id: string) {
    return `corant:external-enabled:1:${JSON.stringify([this.projectPath, id])}`;
  }
  private approval(id: string) {
    return this.storage.getItem(this.key(id));
  }
  private check() {
    if (this.closed) throw new Error("O workspace foi fechado.");
  }
  private run(work: () => Promise<void>): Promise<void> {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        this.check();
        this.update({ busy: true, error: "" });
        try {
          await work();
        } catch (error) {
          this.update({ error: String(error) });
          throw error;
        } finally {
          this.update({ busy: false });
        }
      });
    this.queue = next;
    return next;
  }
  refresh() {
    return this.run(() => this.discover());
  }
  private async discover() {
    const catalog = await this.services.list();
    this.check();
    const rows = catalog.plugins.map((item) => {
      const row: ExternalRow = {
        folder: item.folder,
        error: item.error ?? undefined,
        active: false,
        approved: false,
        removable:
          folderPattern.test(item.folder) && !item.folder.startsWith("corant."),
      };
      if (!row.error)
        try {
          row.manifest = externalManifest(item.manifest);
          if (
            row.manifest.id !== item.folder ||
            !item.fingerprint ||
            !/^[a-f0-9]{64}$/.test(item.fingerprint)
          )
            throw new Error("Identidade do pacote inválida.");
          row.fingerprint = item.fingerprint;
          row.approved = this.approval(row.manifest.id) === item.fingerprint;
        } catch (error) {
          row.error = String(error);
        }
      return row;
    });
    for (const [id, fingerprint] of this.loaded) {
      const row = rows.find((row) => row.manifest?.id === id);
      if (
        !row ||
        row.error ||
        row.fingerprint !== fingerprint ||
        !row.approved
      ) {
        await this.host.deactivate(id);
        this.loaded.delete(id);
      }
    }
    this.check();
    this.update({ directory: catalog.directory, rows });
    for (const row of rows) {
      if (row.approved && !row.error && !this.loaded.has(row.folder)) {
        try {
          await this.activate(row);
        } catch (error) {
          if (this.closed) return;
          this.rowError(row.folder, error);
        }
      }
    }
    this.sync();
  }
  private rowError(folder: string, error: unknown) {
    this.update({
      rows: this.state.rows.map((row) =>
        row.folder === folder
          ? { ...row, error: String(error), active: false }
          : row,
      ),
    });
  }
  private async activate(row: ExternalRow) {
    this.check();
    if (!row.manifest || !row.fingerprint) throw new Error("Plugin inválido.");
    const pkg = await this.services.load(row.folder, row.fingerprint);
    this.check();
    const manifest = externalManifest(pkg.manifest);
    if (
      manifest.id !== row.folder ||
      pkg.fingerprint !== row.fingerprint ||
      JSON.stringify(manifest) !== JSON.stringify(row.manifest)
    )
      throw new Error("O plugin mudou. Atualize e autorize a nova versão.");
    const definition = await this.importer(pkg.source, manifest);
    this.check();
    await this.host.activate(definition, manifest.permissions);
    this.check();
    this.loaded.set(manifest.id, pkg.fingerprint);
    this.sync();
  }
  enable(folder: string, fingerprint: string) {
    return this.run(async () => {
      const row = this.state.rows.find((row) => row.folder === folder);
      if (!row?.manifest || row.fingerprint !== fingerprint)
        throw new Error("O catálogo mudou. Revise o plugin novamente.");
      if (this.host.status(folder) === "active") return;
      // Approval applies to these exact manifest and entrypoint bytes only.
      await this.activate(row);
      this.check();
      try {
        this.storage.setItem(this.key(folder), fingerprint);
      } catch (error) {
        await this.host.deactivate(folder);
        this.loaded.delete(folder);
        throw error;
      }
      this.update({
        rows: this.state.rows.map((item) =>
          item.folder === folder
            ? { ...item, approved: true, active: true, error: undefined }
            : item,
        ),
      });
    });
  }
  disable(folder: string) {
    return this.run(async () => {
      // If persistence fails, keep the failure visible and still revoke this session.
      let failure: unknown;
      try {
        this.storage.removeItem(this.key(folder));
      } catch (error) {
        failure = error;
      }
      await this.host.deactivate(folder);
      this.loaded.delete(folder);
      this.check();
      this.update({
        rows: this.state.rows.map((row) =>
          row.folder === folder
            ? { ...row, active: false, approved: false }
            : row,
        ),
      });
      if (failure) throw failure;
    });
  }
  install(source: string) {
    return this.run(async () => {
      const id = await this.services.install(source);
      this.check();
      this.storage.removeItem(this.key(id));
      await this.discover();
    });
  }
  remove(folder: string) {
    return this.run(async () => {
      this.storage.removeItem(this.key(folder));
      await this.host.deactivate(folder);
      this.loaded.delete(folder);
      this.check();
      this.sync();
      await this.services.remove(folder);
      this.check();
      await this.discover();
    });
  }
  dispose() {
    this.closed = true;
    this.hostSubscription.dispose();
    this.listeners.clear();
    return Promise.all(
      [...this.loaded.keys()].map((id) => this.host.deactivate(id)),
    ).then(() => {});
  }
}
