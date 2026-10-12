import { readFile, stat } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

const imageTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
  svg: "image/svg+xml",
  tif: "image/tiff", tiff: "image/tiff",
};
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export function imageMimeType(path: string): string | null {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : null;
}

export async function readProjectImage(path: string, projectPath?: string, relativePath?: string): Promise<Blob> {
  const type = imageMimeType(path);
  if (!type) throw new Error("Formato de imagem não suportado.");
  if (type === "image/tiff") {
    if (!projectPath || !relativePath) throw new Error("Abra o TIFF dentro de um projeto.");
    const bytes = await invoke<ArrayBuffer | number[]>("image_read_tiff", { projectPath, path: relativePath });
    return new Blob([new Uint8Array(bytes)], { type: "image/png" });
  }
  const info = await stat(path);
  if (!info.isFile) throw new Error("O caminho não é um arquivo.");
  if (info.size > MAX_IMAGE_BYTES) throw new Error("A imagem excede o limite de 32 MiB.");
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("A imagem excede o limite de 32 MiB.");
  return new Blob([new Uint8Array(bytes)], { type });
}
