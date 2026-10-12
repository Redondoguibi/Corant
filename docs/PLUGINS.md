# Plugins externos do Corant — API v1

## Instalar e gerenciar

1. Abra um projeto e acesse **Executar → Gerenciar plugins…**.
2. Clique **Instalar plugin…** e escolha uma pasta contendo `manifest.json` e seu entrypoint JavaScript.
3. Revise as permissões e clique **Ativar**. A confirmação se aplica àquele manifesto e código exatos.
4. Use **Desativar** para revogar o contexto, comandos, painéis e subscriptions. **Remover** também apaga a cópia instalada; a pasta de origem permanece intacta.

A pasta global é `app_data_dir()/plugins`, resolvida pelo Tauri. O caminho completo aparece no gerenciador. Cada plugin ocupa `<pasta-de-plugins>/<id>/`. Também é possível colocar um pacote manualmente nessa pasta e clicar **Atualizar plugins**. A descoberta ocorre ao abrir o workspace e ao atualizar o gerenciador; não há watcher ou atualização pela internet.

A instalação copia somente `manifest.json` e o entrypoint, preservando sua estrutura relativa. Arquivos auxiliares e dependências devem ser incorporados ao bundle. Instalações existentes nunca são sobrescritas: desative/remova a versão anterior antes de instalar outra.

A instalação é global; a ativação é lembrada por projeto no armazenamento local do WebView. Plugins novos começam desativados. Ao reabrir um projeto, apenas plugins previamente aprovados cujo manifesto e entrypoint mantenham o mesmo SHA-256 são reativados. Modificações exigem nova aprovação. As preferências da API `settings` são preservadas após remover um plugin; aprovações de outros projetos não são apagadas, mas só continuam válidas para os mesmos bytes.

## Contrato do pacote

Exemplo instalável: [`examples/plugins/example.word-count`](../examples/plugins/example.word-count).

```text
example.word-count/
├── manifest.json
└── index.js
```

```json
{
  "id": "example.word-count",
  "name": "Contagem de palavras",
  "version": "1.0.0",
  "apiVersion": 1,
  "entrypoint": "index.js",
  "permissions": ["commands.register", "editor.read", "ui.panel"],
  "commands": [
    { "id": "example.word-count.show", "title": "Contar palavras do documento" }
  ]
}
```

- `id`: segmentos minúsculos separados por pontos, com letras, números e hífens; até 100 caracteres. O prefixo `corant.` é reservado. A pasta instalada tem o mesmo nome do ID.
- `version`: versão estável `major.minor.patch`; `apiVersion` deve ser `1`.
- `entrypoint`: caminho relativo `.js` ou `.mjs`, por exemplo `dist/plugin.js`, sem `..`, caminhos absolutos ou barras invertidas. Links simbólicos/junctions no caminho do pacote não são aceitos.
- `permissions` e `commands`: seguem a validação e as regras do [`PluginHost`](../src/plugins/host.ts). IDs de comandos devem começar com `<id-do-plugin>.`.
- Limites: manifesto de 32 KiB, módulo de 8 MiB e catálogo de até 128 entradas.

O entrypoint deve ser um **módulo ES autossuficiente**, já compilado. Não são suportados TypeScript/JSX diretamente, CommonJS, imports relativos, resolução de pacotes npm, importação de CSS ou arquivos auxiliares em tempo de execução. Incorpore dependências e recursos ao bundle. O Corant carrega o módulo com `import()` a partir de uma URL Blob, sem alterar o bundle do aplicativo.

```js
export function activate(api, { React }) {
  api.ui.registerPanel({
    title: "Olá",
    render: () => React.createElement("p", null, "Meu plugin"),
  });
  api.commands.register("autor.plugin.abrir", () => api.ui.openPanel());
}

export function deactivate() {
  // Opcional: libere recursos que não foram registrados em subscriptions.
}
```

O manifesto desse segundo exemplo deve declarar o ID `autor.plugin`, o comando `autor.plugin.abrir` e as permissões `commands.register` e `ui.panel`. O segundo argumento de `activate` fornece a instância React do Corant; use-a para criar componentes/painéis, evitando uma segunda cópia de React. O manifesto utilizado pelo host vem exclusivamente do `manifest.json`.

O contrato completo está em [`src/plugins/api.ts`](../src/plugins/api.ts). Registre recursos em `api.subscriptions.add({ dispose() {} })` e respeite `api.signal`. A importação e os hooks assíncronos de ciclo de vida possuem limite de tempo. Falhas na ativação revogam os recursos registrados; erro no render de um painel é contido e exibido sem derrubar o workspace.

## Confiança e limites

Plugins externos compartilham o contexto JavaScript do aplicativo. **Não existe sandbox.** As permissões do PluginHost controlam chamadas pela API, mas não impedem que um módulo acesse diretamente DOM, armazenamento, rede ou APIs nativas disponíveis ao WebView. A confirmação de ativação deixa isso explícito. Instale e ative apenas código de origem confiável.

Desativar revoga a API e executa o cleanup cooperativo; não desfaz efeitos já produzidos nem descarrega completamente um módulo ES da memória. O plugin deve encerrar seus próprios timers/listeners e tarefas. Loops síncronos podem bloquear o WebView e `await` no topo do módulo pode continuar após o timeout; nesse caso, reinicie o aplicativo. Isolamento em outro processo/worker, marketplace, assinaturas, atualização automática, ZIP e resolução de dependências ficam fora desta implementação.
