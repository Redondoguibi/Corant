import { useState, useSyncExternalStore } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import type { ExternalPluginManager, ExternalRow } from "./externalPlugins";

export function ExternalPluginsPanel({
  manager,
}: {
  manager: ExternalPluginManager;
}) {
  const state = useSyncExternalStore(manager.subscribe, manager.snapshot);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const busy = pending || state.busy;
  async function run(work: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  }
  async function install() {
    const source = await open({
      directory: true,
      multiple: false,
      title: "Instalar plugin: escolha a pasta com manifest.json",
    });
    if (typeof source === "string") await manager.install(source);
  }
  async function enable(row: ExternalRow) {
    if (!row.manifest || !row.fingerprint) return;
    const accepted = await confirm(
      `Ativar “${row.manifest.name}” (${row.manifest.id}) neste projeto?\n\nPermissões solicitadas:\n${row.manifest.permissions.join("\n") || "Nenhuma permissão da API"}\n\nO plugin executa JavaScript no aplicativo, sem sandbox. Essas permissões não impedem acesso direto ao aplicativo e às APIs nativas. Ative somente código de uma fonte em que você confia.`,
      {
        title: "Confiar e ativar plugin",
        kind: "warning",
        okLabel: "Confiar e ativar",
        cancelLabel: "Cancelar",
      },
    );
    if (accepted) await manager.enable(row.folder, row.fingerprint);
  }
  async function remove(row: ExternalRow) {
    if (
      await confirm(
        `Remover a pasta instalada de “${row.manifest?.name ?? row.folder}”? O plugin será desativado neste workspace. A pasta de origem da instalação será preservada.`,
        {
          title: "Remover plugin",
          kind: "warning",
          okLabel: "Remover plugin",
          cancelLabel: "Cancelar",
        },
      )
    )
      await manager.remove(row.folder);
  }
  return (
    <div className="plugin-content external-plugins">
      <p>
        Instale uma pasta com <code>manifest.json</code> e um módulo JavaScript.
        Plugins novos ficam desativados.
      </p>
      <p>
        <strong>Somente plugins confiáveis.</strong> O código compartilha o
        ambiente do Corant; não há sandbox. A ativação é salva por projeto.
      </p>
      <div className="plugin-button-row">
        <button disabled={busy} onClick={() => void run(install)}>
          Instalar plugin…
        </button>
        <button
          disabled={busy}
          onClick={() => void run(() => manager.refresh())}
        >
          Atualizar plugins
        </button>
      </div>
      <label>
        Pasta de plugins
        <input aria-label="Pasta de plugins" readOnly value={state.directory} />
      </label>
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      {busy && <p role="status">Atualizando plugins…</p>}
      {!state.rows.length && !busy && <p>Nenhum plugin externo instalado.</p>}
      {state.rows.map((row) => (
        <section
          className="external-plugin-card"
          key={row.folder}
          aria-label={row.manifest?.name ?? row.folder}
        >
          <strong>{row.manifest?.name ?? row.folder}</strong>
          <small>
            {row.manifest?.id ?? row.folder}
            {row.manifest ? ` · ${row.manifest.version}` : ""}
          </small>
          <p>
            {row.active ? "Ativo" : row.error ? "Indisponível" : "Desativado"}
          </p>
          {row.manifest && (
            <details>
              <summary>Permissões solicitadas</summary>
              <ul>
                {row.manifest.permissions.map((permission) => (
                  <li key={permission}>{permission}</li>
                ))}
              </ul>
              {!row.manifest.permissions.length && (
                <p>Nenhuma permissão da API.</p>
              )}
            </details>
          )}
          {row.error && <p role="alert">{row.error}</p>}
          <div className="plugin-button-row">
            {row.active || row.approved ? (
              <button
                disabled={busy}
                onClick={() => void run(() => manager.disable(row.folder))}
              >
                Desativar
              </button>
            ) : (
              <button
                disabled={busy || !!row.error || !row.manifest}
                onClick={() => void run(() => enable(row))}
              >
                Ativar
              </button>
            )}
            <button
              disabled={busy || !row.removable}
              onClick={() => void run(() => remove(row))}
            >
              Remover
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
