import { Component, type ReactNode } from "react";
import type { PluginPanel } from "./api";

function PanelContent({ panel }: { panel: PluginPanel }) {
  return <>{panel.render()}</>;
}

export class PluginPanelView extends Component<
  { panel: PluginPanel },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? (
      <p className="plugin-content" role="alert">
        O painel deste plugin falhou. Desative-o em Executar → Gerenciar
        plugins.
      </p>
    ) : (
      <PanelContent panel={this.props.panel} />
    );
  }
}
