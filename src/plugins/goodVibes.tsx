import { useState } from "react";
import type { BuiltinPlugin, PluginContext, ThemeId } from "./api";
import { themes, validTheme } from "./themes";

function GoodVibes({ api }: { api: PluginContext }) {
  const [selected, setSelected] = useState(() => validTheme(api.settings.get("theme")));
  const [error, setError] = useState("");
  function choose(theme: ThemeId) {
    try { api.settings.set("theme", theme); api.appearance.setTheme(theme); setSelected(theme); setError(""); }
    catch (cause) { setError(String(cause)); }
  }
  return <div className="plugin-content"><p>Escolha a aparência deste projeto.</p>
    <div className="theme-options" role="group" aria-label="Temas">
      {themes.map((theme) => <button key={theme.id} aria-pressed={selected === theme.id} onClick={() => choose(theme.id)}>
        <span className="theme-preview" style={{ background: theme.background, color: theme.foreground, borderColor: theme.accent }}>Aa <span style={{ color: theme.accent }}>●</span></span>
        <strong>{theme.name}</strong><small>{theme.description}</small>
      </button>)}
    </div>{error && <p role="alert">{error}</p>}
  </div>;
}
const permissions = ["commands.register", "settings.read", "settings.write", "ui.panel", "appearance.write"] as const;
export const goodVibes: BuiltinPlugin = { grants: permissions, definition: {
  manifest: { id: "corant.good-vibes", name: "Good Vibes", version: "1.0.0", apiVersion: 1, permissions,
    commands: [{ id: "corant.good-vibes.open", title: "Good Vibes — escolher tema" }] },
  activate(api) {
    api.ui.registerPanel({ title: "Good Vibes", render: () => <GoodVibes api={api} /> });
    api.commands.register("corant.good-vibes.open", () => api.ui.openPanel());
    api.appearance.setTheme(validTheme(api.settings.get("theme")));
  },
} };
