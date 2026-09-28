import { useEffect, useRef, useState } from "react";
import type { AiApproval, AiModel, BuiltinPlugin, CopilotAccessMode, EditorDocument, PluginContext } from "./api";

type Message = {
  id: string; role: "user" | "assistant"; text: string; context?: string;
  document?: EditorDocument; failed?: boolean; attachment?: string;
};

function conversationPrompt(messages: Message[], next: string, provider: string) {
  const limit = provider === "codex" ? 20_000 : 80_000;
  if (next.length > limit) throw new Error("O código anexado é muito grande. Reduza o conteúdo antes de enviar.");
  const history: string[] = [];
  let size = next.length;
  for (const message of [...messages].reverse()) {
    if (message.failed) continue;
    const part = (message.role === "user" ? "Usuário: " : "Assistente: ") + (message.context ?? message.text);
    if (size + part.length + 100 > limit) break;
    history.unshift(part);
    size += part.length + 2;
  }
  return history.length ? "Histórico da conversa:\n\n" + history.join("\n\n") + "\n\nPedido atual do usuário:\n" + next : next;
}

function MessageText({ text }: { text: string }) {
  // Render code as text, never HTML returned by a provider.
  const fence = String.fromCharCode(96).repeat(3);
  return <>{text.split(fence).map((part, index) => index % 2
    ? <pre key={index}><code>{part.replace(/^[^\n]*\n/, "")}</code></pre>
    : <div className="copilot-prose" key={index}>{part}</div>)}</>;
}

function Copilot({ api }: { api: PluginContext }) {
  const [provider, setProvider] = useState<"openrouter" | "codex">(() => api.settings.get("provider") === "openrouter" ? "openrouter" : "codex");
  const [model, setModel] = useState(() => String(api.settings.get("model") ?? ""));
  const [models, setModels] = useState<readonly AiModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const refreshModels = useRef<() => void>(() => {});
  const resumeModels = useRef<() => void>(() => {});
  const [key, setKey] = useState("");
  const [openRouterReady, setOpenRouterReady] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attached, setAttached] = useState<EditorDocument | null>(null);
  const [edit, setEdit] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginOutput, setLoginOutput] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [loginFailed, setLoginFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [accessMode, setAccessMode] = useState<CopilotAccessMode>("ask");
  const [confirmFull, setConfirmFull] = useState(false);
  const [approvals, setApprovals] = useState<Array<AiApproval & { respond: (id: string, approved: boolean) => Promise<void> }>>([]);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState("");
  const operation = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ready = provider === "codex" ? authenticated : openRouterReady;
  useEffect(() => {
    const controller = new AbortController();
    void api.ai.account("status", controller.signal, () => {}).then((value) => { if (!controller.signal.aborted) setAuthenticated(value); }).catch(() => {});
    return () => { controller.abort(); operation.current?.abort(); };
  }, [api]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy, approvals, agentStatus]);
  useEffect(() => { if (!busy) resumeModels.current(); }, [busy]);
  useEffect(() => {
    setModels([]);
    setModelsError("");
    if (provider !== "codex" || !authenticated) {
      setModelsLoading(false);
      refreshModels.current = () => {};
      resumeModels.current = () => {};
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
    resumeModels.current = () => whenVisible(5 * 60_000);
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
      resumeModels.current = () => {};
    };
  }, [api, provider, authenticated]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError("");
    try { await action(controller.signal); } catch (e) { if (!controller.signal.aborted) setError(String(e)); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); setApprovals([]); setApprovalBusy(null); } }
  }
  function account(action: "login" | "login-device" | "logout") {
    if (operation.current || modelsLoading) return;
    setLoginOutput(""); setAuthenticated(false); setLoginFailed(false);
    setLoginPending(action !== "logout");
    if (action === "logout") { setMessages([]); setAttached(null); setPrompt(""); setAccessMode("ask"); setConfirmFull(false); }
    void run(async (signal) => {
      try {
        const loggedIn = await api.ai.account(action, signal, (text) => {
          if (!signal.aborted) setLoginOutput((current) => (current + text).slice(-16000));
        });
        if (!signal.aborted) setAuthenticated(loggedIn);
      } catch (cause) { if (!signal.aborted && action !== "logout") setLoginFailed(true); throw cause; }
      finally { setLoginOutput(""); setLoginPending(false); }
    });
  }
  function cancel() { operation.current?.abort(); setLoginOutput(""); setLoginPending(false); setApprovals([]); }
  function chooseProvider(value: "codex" | "openrouter") {
    if (value !== provider) {
      setProvider(value); setModel(""); setMessages([]); setPrompt(""); setAttached(null); setError("");
      setOpenRouterReady(false); setKey(""); setCredentialsOpen(false); setLoginFailed(false);
      setAccessMode("ask"); setConfirmFull(false); setEdit(false); setAgentStatus("");
      try { api.settings.set("provider", value); api.settings.set("model", ""); } catch (cause) { setError(String(cause)); }
    }
    setProviderOpen(false);
  }
  function attachCode() {
    try {
      const document = api.editor.getActiveDocument();
      if (!document) throw new Error("Abra um arquivo no editor para anexar seu código.");
      setAttached(document); setError("");
    } catch (cause) { setError(String(cause)); }
  }
  function login() {
    if (provider === "codex") account("login");
    else setCredentialsOpen(true);
  }
  function send() {
    if (!ready || !prompt.trim() || operation.current || modelsLoading || confirmFull) return;
    const text = prompt.trim();
    setAgentStatus("");
    void run(async (signal) => {
      const document = edit ? api.editor.getActiveDocument() : attached;
      if (edit && !document) throw new Error("Abra um documento para propor uma alteração.");
      api.settings.set("provider", provider); api.settings.set("model", model);
      const context = document ? "\n\nDocumento: " + document.path + "\n" + document.text : "";
      const instruction = edit ? "Retorne somente o conteúdo completo do documento modificado, sem explicações nem cercas Markdown.\n" : "";
      const content = instruction + text + context;
      const request = conversationPrompt(messages, content, provider);
      const userMessage: Message = { id: crypto.randomUUID(), role: "user", text, context: content, attachment: document?.path };
      setMessages((current) => [...current, userMessage]); setPrompt(""); setAttached(null);
      try {
        const response = await api.ai.request({ provider, model, apiKey: provider === "openrouter" ? key : "", prompt: request,
          ...(provider === "codex" ? { accessMode } : {}) }, signal, (event, respond) => {
            if (signal.aborted) return;
            if (event.type === "approval") setApprovals((current) => [...current.filter((item) => item.id !== event.approval.id), { ...event.approval, respond }]);
            else if (event.type === "resolved") setApprovals((current) => current.filter((item) => item.id !== event.id));
            else setAgentStatus(event.text);
          });
        if (!signal.aborted) setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: response, document: edit ? document ?? undefined : undefined }]);
        else setMessages((current) => current.map((item) => item.id === userMessage.id ? { ...item, failed: true } : item));
      } catch (cause) {
        if (!signal.aborted) setPrompt(text);
        setMessages((current) => current.map((item) => item.id === userMessage.id ? { ...item, failed: true } : item));
        throw cause;
      }
    });
  }
  function apply(message: Message) {
    if (!message.document) return;
    try {
      api.editor.replaceActiveDocument({ documentId: message.document.id, expectedVersion: message.document.version, text: message.text });
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, document: undefined } : item));
    } catch (cause) { setError(String(cause)); }
  }
  async function answerApproval(approval: typeof approvals[number], approved: boolean) {
    setApprovalBusy(approval.id);
    try {
      await approval.respond(approval.id, approved);
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
    } catch (cause) { setError(String(cause)); }
    finally { setApprovalBusy(null); }
  }
  return <div className={"plugin-content copilot-content " + (ready ? "is-chat" : "is-welcome")}>
    <div className="copilot-actions" role="group" aria-label="Ações do Copilot">
      <button disabled={busy || modelsLoading} aria-expanded={providerOpen} onClick={() => setProviderOpen(!providerOpen)}>Provedor · {provider === "codex" ? "Codex" : "OpenRouter"}</button>
      {!ready ? <button disabled={busy || provider !== "codex"} title={provider !== "codex" ? "Disponível para Codex" : "Login por código de dispositivo"} onClick={() => account("login-device")}>Entrar com código</button> : <button disabled={busy} onClick={attachCode}>Anexar arquivo</button>}
      {!ready ? <button disabled={busy} className="plugin-primary" onClick={login}>Fazer login</button>
        : <button disabled={busy || modelsLoading} onClick={() => { if (provider === "codex") account("logout"); else { setOpenRouterReady(false); setKey(""); setMessages([]); setPrompt(""); setAttached(null); } }}>Sair{provider === "codex" ? " do Codex" : ""}</button>}
    </div>
    {providerOpen && <div className="copilot-settings"><label>Provedor<select aria-label="Provedor" value={provider} onChange={(e) => chooseProvider(e.target.value as typeof provider)}><option value="codex">Codex</option><option value="openrouter">OpenRouter</option></select></label></div>}
    {!ready && <section className="copilot-welcome"><span className="copilot-mark" aria-hidden="true">✦</span><h2>Seu código, em conversa</h2><p>Escolha um provedor e faça login para começar.</p><small>Fazer login abre o navegador. Entrar com código usa um código de dispositivo para conectar sua conta.</small></section>}
    {!ready && attached && <div className="copilot-attachment"><span>{attached.path.split(/[\\/]/).pop()} anexado</span><button aria-label="Remover código anexado" onClick={() => setAttached(null)}>×</button></div>}
    {credentialsOpen && !ready && provider === "openrouter" && <form className="copilot-settings" onSubmit={(e) => { e.preventDefault(); if (!key.trim() || !model.trim()) return; setOpenRouterReady(true); setCredentialsOpen(false); setError(""); }}>
      <label>Chave OpenRouter<input type="password" autoComplete="off" required value={key} onChange={(e) => setKey(e.target.value)} /></label>
      <label>Modelo<input required maxLength={160} value={model} placeholder="provedor/modelo" onChange={(e) => setModel(e.target.value)} /></label>
      <small>A chave fica somente na memória. A conexão será verificada ao enviar a primeira mensagem.</small><button type="submit">Conectar OpenRouter</button>
    </form>}
    {loginPending && <p role="status">Aguardando login no navegador. Mantenha este painel aberto até concluir.</p>}
    {loginFailed && !ready && provider === "codex" && <small>Tente novamente ou use Entrar com código. O login por dispositivo precisa estar habilitado na sua conta.</small>}
    {loginOutput && <pre aria-label="Login Codex">{loginOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")}</pre>}
    {ready && <>
      <div className="copilot-chat-heading"><small>{provider === "codex" ? "Conectado ao Codex" : "OpenRouter configurado"}</small><button disabled={busy} onClick={() => { setMessages([]); setError(""); }}>Nova conversa</button></div>
      <div role="log" aria-label="Conversa com Copilot" aria-live="polite" className="copilot-messages">
        {!messages.length && <div className="copilot-chat-empty"><h3>Como posso ajudar?</h3><p>Pergunte sobre seu código, investigue um erro ou peça uma alteração.</p></div>}
        {messages.map((message) => <article className={"copilot-message " + message.role} key={message.id} aria-label={message.role === "user" ? "Sua mensagem" : "Resposta do Copilot"}>
          <strong>{message.role === "user" ? "Você" : "Copilot"}</strong>
          {message.attachment && <small>Código: {message.attachment.split(/[\\/]/).pop()}</small>}
          <MessageText text={message.text} />
          {message.failed && <small>Envio não concluído.</small>}
          {message.role === "assistant" && <div className="plugin-button-row"><button onClick={() => void navigator.clipboard.writeText(message.text).catch(() => setError("Não foi possível copiar a resposta."))}>Copiar resposta</button>{message.document && <button disabled={busy} onClick={() => apply(message)}>Aplicar ao documento</button>}</div>}
        </article>)}
        {busy && <p role="status" className="copilot-thinking">{approvals.length ? "Aguardando sua aprovação…" : "Copilot está trabalhando…"}</p>}
        {agentStatus && <p role="status">{agentStatus}</p>}
        {approvals.map((approval) => <section className="copilot-approval" role="region" aria-label="Aprovação pendente" key={approval.id}>
          <strong>{approval.title}</strong><pre>{approval.detail}</pre>
          <div className="plugin-button-row"><button disabled={approvalBusy !== null || !approval.canApprove} onClick={() => void answerApproval(approval, true)}>Aprovar uma vez</button><button disabled={approvalBusy !== null} onClick={() => void answerApproval(approval, false)}>Recusar</button></div>
        </section>)}
        <div ref={end} />
      </div>
      <form className="copilot-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {attached && <div className="copilot-attachment"><span>{attached.path.split(/[\\/]/).pop()}</span><button type="button" aria-label="Remover código anexado" onClick={() => setAttached(null)}>×</button></div>}
        <textarea aria-label="Pedido" placeholder="Pergunte ao Copilot…" rows={3} maxLength={80000} value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <div className="copilot-composer-tools">
          {provider === "codex" ? <><select aria-label="Modelo" title="Modelos atualizados automaticamente" disabled={busy || modelsLoading} value={models.some((item) => item.model === model) ? model : ""} onChange={(e) => setModel(e.target.value)}><option value="">{modelsLoading ? "Carregando modelos…" : "Padrão do Codex"}</option>{models.map((item) => <option key={item.model} value={item.model}>{item.displayName}{item.isDefault ? " (recomendado)" : ""}</option>)}</select><button type="button" aria-label="Atualizar modelos" title="Atualiza automaticamente a cada 5 minutos" disabled={busy || modelsLoading} onClick={() => refreshModels.current()}>↻</button></>
            : <input aria-label="Modelo" maxLength={160} value={model} placeholder="provedor/modelo" disabled={busy} onChange={(e) => setModel(e.target.value)} />}
          <button type="submit" className="plugin-primary" disabled={busy || modelsLoading || confirmFull || !prompt.trim()}>Enviar</button>
        </div>
        {provider === "codex" ? <>
          <label>Permissões<select aria-label="Permissões do Copilot" value={accessMode} disabled={busy || confirmFull} onChange={(e) => {
            const mode = e.target.value as CopilotAccessMode;
            if (mode === "full") setConfirmFull(true); else setAccessMode(mode);
          }}><option value="ask">Solicitar aprovação</option><option value="auto">Aprovar por mim</option><option value="full">Acesso completo</option></select></label>
          <small>{accessMode === "ask" ? "Leitura permitida. Alterações e ações fora do ambiente protegido solicitam sua aprovação." : accessMode === "auto" ? "Edita o projeto; o Codex revisa automaticamente ações que precisam de aprovação." : "Pode alterar arquivos e executar comandos no computador, com rede e sem pedir aprovação."}</small>
          {confirmFull && <div className="copilot-approval" role="alert"><p>Acesso completo permite ações fora deste projeto e comandos sem aprovação. Ativar nesta sessão?</p><div className="plugin-button-row"><button type="button" onClick={() => { setAccessMode("full"); setConfirmFull(false); }}>Ativar acesso completo</button><button type="button" onClick={() => setConfirmFull(false)}>Manter proteção</button></div></div>}
        </> : <><label className="copilot-edit-option"><input type="checkbox" checked={edit} disabled={busy} onChange={(e) => setEdit(e.target.checked)} />Propor alteração do documento ativo</label><small>OpenRouter propõe alterações para aplicar manualmente. Acesso direto ao projeto disponível com Codex.</small></>}
        <small>Enter envia · Shift+Enter quebra linha</small>
      </form>
      {modelsError && provider === "codex" && <p role="status">{modelsError}</p>}
    </>}
    {busy && <button onClick={cancel}>Cancelar operação</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
const permissions = ["commands.register", "settings.read", "settings.write", "ui.panel", "editor.read", "editor.write", "ai.request", "ai.execute"] as const;
export const copilot: BuiltinPlugin = { grants: permissions, definition: {
  manifest: { id: "corant.copilot", name: "Copilot", version: "1.0.0", apiVersion: 1, permissions, commands: [{ id: "corant.copilot.open", title: "Copilot — assistente" }] },
  activate(api) { api.ui.registerPanel({ title: "Copilot", render: () => <Copilot api={api} /> }); api.commands.register("corant.copilot.open", () => api.ui.openPanel()); },
} };
