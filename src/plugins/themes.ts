import type { ThemeId } from "./api";
export const themes: { id: ThemeId; name: string; description: string; background: string; foreground: string; accent: string }[] = [
  { id: "crimson", name: "Crimson", description: "Escuro com detalhes vermelhos", background: "#0d0d0e", foreground: "#e5e5e5", accent: "#ff5a60" },
  { id: "dawn", name: "Amanhecer", description: "Claro e suave", background: "#fffaf5", foreground: "#302a28", accent: "#ad233d" },
  { id: "midnight", name: "Meia-noite", description: "Azul profundo", background: "#0c1626", foreground: "#dce8f9", accent: "#80baff" },
];
export const validTheme = (value: unknown): ThemeId => themes.find((theme) => theme.id === value)?.id ?? "crimson";
