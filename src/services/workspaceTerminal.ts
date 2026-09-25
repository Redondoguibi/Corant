import { Channel, invoke } from "@tauri-apps/api/core";

export type TerminalEvent =
  | { type: "output"; sessionId: string; data: number[] }
  | { type: "exit"; sessionId: string; code: number | null; error: string | null };

// Serialize lifecycle operations across workspace mounts, including StrictMode's
// setup/cleanup cycle. A late start must be stopped before the next workspace starts.
let lifecycle: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = lifecycle.then(action);
  lifecycle = result.catch(() => undefined);
  return result;
}

export class WorkspaceTerminal {
  private generation = 0;
  private disposed = false;
  private sessionId: string | null = null;
  private ended = true;
  private inputQueue: Promise<unknown> = Promise.resolve();
  private resizeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly projectPath: string) {}

  start(cols: number, rows: number, onEvent: (event: TerminalEvent) => void): Promise<string> {
    const generation = ++this.generation;
    this.ended = true;
    return serialize(async () => {
      if (this.disposed || generation !== this.generation) throw new Error("Início do terminal cancelado.");
      await this.stopSession();
      if (this.disposed || generation !== this.generation) throw new Error("Início do terminal cancelado.");
      let channelSession: string | null = null;
      let exited = false;
      const channel = new Channel<TerminalEvent>((event) => {
        if (this.disposed || generation !== this.generation || exited) return;
        // A shell can produce output or exit before terminal_start resolves.
        channelSession ??= event.sessionId;
        if (event.sessionId !== channelSession) return;
        if (event.type === "exit") { exited = true; this.ended = true; }
        onEvent(event);
      });
      const id = await invoke<string>("terminal_start", { projectPath: this.projectPath, cols, rows, onEvent: channel });
      this.sessionId = id;
      if (this.disposed || generation !== this.generation) {
        await this.stopSession();
        throw new Error("Início do terminal cancelado.");
      }
      channelSession = id;
      this.ended = exited;
      return id;
    });
  }

  async input(data: Uint8Array | string): Promise<void> {
    const id = this.activeSession();
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data.slice();
    const send = this.inputQueue.then(async () => {
      for (let offset = 0; offset < bytes.byteLength; offset += 16 * 1024) {
        if (this.activeSession() !== id) throw new Error("A sessão do terminal mudou durante o envio.");
        await invoke("terminal_input", { sessionId: id, data: Array.from(bytes.subarray(offset, offset + 16 * 1024)) });
      }
    });
    this.inputQueue = send.catch(() => undefined);
    await send;
  }

  async resize(cols: number, rows: number): Promise<void> {
    const id = this.activeSession();
    const generation = this.generation;
    const resize = this.resizeQueue.then(async () => {
      if (generation !== this.generation || this.activeSession() !== id) return;
      await invoke("terminal_resize", { sessionId: id, cols, rows });
    });
    this.resizeQueue = resize.catch(() => undefined);
    await resize;
  }

  stop(): Promise<void> {
    ++this.generation; // Invalidate callbacks synchronously, before awaiting native cleanup.
    this.ended = true;
    return serialize(() => this.stopSession());
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.stop();
  }

  private activeSession(): string {
    if (this.disposed || this.ended || !this.sessionId) throw new Error("A sessão do terminal não está ativa.");
    return this.sessionId;
  }

  private async stopSession(): Promise<void> {
    if (!this.sessionId) return;
    await invoke("terminal_stop", { sessionId: this.sessionId });
    this.sessionId = null;
    this.ended = true;
  }
}
