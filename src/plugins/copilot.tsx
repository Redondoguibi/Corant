import { useEffect, useRef, useState } from "react";
import type { AiModel, BuiltinPlugin, EditorDocument, PluginContext } from "./api";

function Copilot({ api }: { api: PluginContext }) {
  const [provider, setProvider] = useState<"openrouter" | "codex">(() => api.settings.get("provider") === "codex" ? "codex" : "openrouter");
  const [model, setModel] = useState(() => String(api.settings.get("model") ?? ""));
  const [models, setModels] = useState<readonly AiModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const refreshModels = useRef<() => void>(() => {});
  const [key, setKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [attach, setAttach] = useState(false);
  const [edit, setEdit] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginOutput, setLoginOutput] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ text: string; document: EditorDocument | null } | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api.ai.account("status", controller.signal, () => {}).then(setAuthenticated).catch(() => {});
    return () => { controller.abort(); operation.current?.abort(); };
  }, [api]);
  useEffect(() => {
    setModels([]);
    setModelsError("");
    if (provider !== "codex" || !authenticated) {
      setModelsLoading(false);
      refreshModels.current = () => {};
      return;
    }
    const controller = new AbortController();
    let loading = false;
    let hasLoaded = false;
    let lastAttempt = 0;
    async function refresh() {
      // Model discovery shares the native operation slot with login and requests.
      if (controller.signal.aborted || loading || operation.current) return;
      loading = true;
      lastAttempt = Date.now();
      setModelsLoading(true);
      setModelsError("");
      try {
        const available = await api.ai.models(controller.signal);
        if (controller.signal.aborted) return;
        hasLoaded = true;
        setModels(available);
        setModel((selected) => available.some((item) => item.model === selected) ? selected : "");
        if (!available.length) setModelsError("O Codex não retornou modelos. Você pode usar o padrão.");
      } catch (cause) {
        if (!controller.signal.aborted) {
          setModelsError(String(cause));
          // Temporary failures must not discard a usable catalog or selection.
          if (!hasLoaded) setModel("");
        }
      } finally {
        loading = false;
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    }
    const whenVisible = (age: number) => {
      if (document.visibilityState === "visible" && Date.now() - lastAttempt >= age) void refresh();
    };
    const onFocus = () => whenVisible(60_000);
    refreshModels.current = () => { void refresh(); };
    void refresh();
    // Retry due refreshes once an ongoing request has released the native slot.
    const timer = window.setInterval(() => whenVisible(5 * 60_000), 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      refreshModels.current = () => {};
    };
  }, [api, provider, authenticated]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError("");
    try { await action(controller.signal); } catch (e) { if (!controller.signal.aborted) setError(String(e)); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
  }
  function account(action: "login" | "login-device" | "logout") {
    if (operation.current) return;
    setLoginOutput(""); setAuthenticated(false);
    setLoginPending(action !== "logout");
    void run(async (signal) => {
      try {
        const loggedIn = await api.ai.account(action, signal, (text) => {
          if (!signal.aborted) setLoginOutput((current) => (current + text).slice(-16000));
        });
        if (!signal.aborted) setAuthenticated(loggedIn);
      } finally {
        // Links/codes only belong to the live CLI attempt, never a later retry.
        setLoginOutput("");
        setLoginPending(false);
      }
    });
  }
  function cancel() {
    operation.current?.abort();
    setLoginOutput("");
    setLoginPending(false);
  }
  function send() {
    setResult(null);
    void run(async (signal) => {
      const document = attach || edit ? api.editor.getActiveDocument() : null;
      if ((attach || edit) && !document) throw new Error("Abra um documento para anexar ou editar.");
      api.settings.set("provider", provider); api.settings.set("model", model);
      const context = document ? `\n\nDocumento: ${document.path}\n${document.text}` : "";
      const instruction = edit ? "Retorne somente o conteúdo completo do documento modificado, sem explicações nem cercas Markdown.\n" : "";
      const text = await api.ai.request({ provider, model, apiKey: provider === "openrouter" ? key : "", prompt: instruction + prompt + context }, signal);
      if (!signal.aborted) setResult({ text, document: edit ? document : null });
    });
  }
  return <div className="plugin-content">
    <fieldset disabled={busy}>
      <label>Provedor<select value={provider} onChange={(e) => { setProvider(e.target.value as typeof provider); setModel(""); setResult(null); }}><option value="openrouter">OpenRouter</option><option value="codex">Codex</option></select></label>
      {provider === "openrouter" ? <label>Chave OpenRouter<input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /><small>A chave permanece somente na memória deste painel.</small></label> : <><p>{authenticated ? "Conectado ao Codex" : "Entre com sua conta para usar o Codex."}</p><button disabled={modelsLoading} onClick={() => account(authenticated ? "logout" : "login")}>{authenticated ? "Sair do Codex" : "Entrar com Codex"}</button>{!authenticated && <button onClick={() => account("login-device")}>Entrar por código</button>}<small>O login abre seu navegador. Mantenha este painel aberto até concluir. Se precisar, use Entrar por código; essa opção exige login por dispositivo habilitado na conta.</small></>}
      {provider === "codex" ? <>
        <label>Modelo<select aria-label="Modelo" value={models.some((item) => item.model === model) ? model : ""} disabled={!authenticated || modelsLoading} onChange={(e) => setModel(e.target.value)}>
          <option value="">{modelsLoading ? "Carregando modelos…" : "Padrão do Codex"}</option>
          {models.map((item) => <option key={item.model} value={item.model}>{item.displayName}{item.isDefault ? " (recomendado)" : ""}</option>)}
        </select></label>
        <button disabled={!authenticated || modelsLoading} onClick={() => refreshModels.current()}>Atualizar modelos</button>
        {authenticated && <small>A lista é atualizada automaticamente a cada 5 minutos e ao voltar ao aplicativo.</small>}
        {!authenticated && <small>Entre com Codex para consultar os modelos disponíveis.</small>}
        {modelsError && <p role="status">{modelsError}</p>}
      </> : <label>Modelo<input maxLength={160} value={model} placeholder="provedor/modelo" onChange={(e) => setModel(e.target.value)} /></label>}
      <label>Pedido<textarea rows={5} maxLength={80000} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
      <label><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />Anexar documento ativo</label>
      <label><input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} />Propor alteração do documento ativo</label>
      <small>O documento é enviado ao provedor somente quando uma dessas opções está marcada. Revise a resposta antes de aplicar.</small>
      <button className="plugin-primary" disabled={!prompt.trim() || (provider === "codex" && (!authenticated || modelsLoading))} onClick={send}>Enviar</button>
    </fieldset>
    {loginPending && <p role="status">Aguardando login no navegador. Se a página informar sessão encerrada, cancele esta tentativa e inicie um novo login.</p>}
    {busy && <button onClick={cancel}>Cancelar operação</button>}
    {loginOutput && <pre aria-label="Login Codex">{loginOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")}</pre>}
    {result && <><textarea aria-label="Resposta do Copilot" rows={12} readOnly value={result.text} />{result.document && <button disabled={busy} onClick={() => { try { api.editor.replaceActiveDocument({ documentId: result.document!.id, expectedVersion: result.document!.version, text: result.text }); setResult({ ...result, document: null }); } catch (e) { setError(String(e)); } }}>Aplicar ao documento</button>}</>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
const permissions = ["commands.register", "settings.read", "settings.write", "ui.panel", "editor.read", "editor.write", "ai.request"] as const;
export const copilot: BuiltinPlugin = { grants: permissions, definition: {
  manifest: { id: "corant.copilot", name: "Copilot", version: "1.0.0", apiVersion: 1, permissions, commands: [{ id: "corant.copilot.open", title: "Copilot — assistente" }] },
  activate(api) { api.ui.registerPanel({ title: "Copilot", render: () => <Copilot api={api} /> }); api.commands.register("corant.copilot.open", () => api.ui.openPanel()); },
} };
