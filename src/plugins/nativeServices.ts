import { Channel, invoke } from "@tauri-apps/api/core";
import type { AiModel, AiRequest } from "./api";

async function cancellable<T>(command: string, args: object, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Operação cancelada.");
  const requestId = crypto.randomUUID();
  const cancel = () => { void invoke("copilot_cancel", { requestId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await invoke<T>(command, { ...args, requestId });
    if (signal.aborted) throw new Error("Operação cancelada.");
    return result;
  } finally { signal.removeEventListener("abort", cancel); }
}
export function requestAi(projectPath: string, request: AiRequest, signal: AbortSignal) {
  return cancellable<string>("copilot_request", { projectPath, request }, signal);
}
export function codexAccount(projectPath: string, action: "login" | "login-device" | "logout" | "status", signal: AbortSignal, onOutput: (text: string) => void) {
  const decoder = new TextDecoder();
  const onOutputChannel = new Channel<number[]>((bytes) => { if (!signal.aborted) onOutput(decoder.decode(new Uint8Array(bytes), { stream: true })); });
  return cancellable<boolean>("copilot_account", { projectPath, action, onOutput: onOutputChannel }, signal);
}

export function codexModels(projectPath: string, signal: AbortSignal) {
  return cancellable<AiModel[]>("copilot_models", { projectPath }, signal);
}
