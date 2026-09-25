# Corant

> Workspace desktop local-first para desenvolvimento e projetos criativos/técnicos.

O **Corant** é um aplicativo desktop focado em trabalhar diretamente com projetos locais. A proposta é combinar gerenciamento de arquivos, edição de código, ferramentas integradas e, futuramente, plugins e automações em um único workspace.

A filosofia do produto é simples: **abrir um projeto → ter as ferramentas integradas → começar a trabalhar**.

## Visão do produto

O Corant é pensado como uma alternativa mais integrada e focada a um editor de código tradicional.

- **Local-first:** o projeto vive no filesystem local.
- **Sem conta obrigatória:** o núcleo não depende de uma conta online.
- **Sem backend obrigatório:** o produto principal não depende de um servidor ou banco de dados central.
- **Projeto como unidade principal:** o usuário abre ou cria um projeto e trabalha dentro dele.
- **Extensível:** plugins fazem parte da visão de longo prazo, mas só serão definidos depois da estabilização do núcleo.

### Corant vs. VS Code

A diferenciação planejada não é competir com o ecossistema gigantesco do VS Code em todas as áreas.

- **VS Code:** editor primeiro → extensões → montar o ambiente.
- **Corant:** workspace primeiro → ferramentas integradas → começar a trabalhar.

## Stack atual

- **Tauri 2** — aplicação desktop e integração nativa
- **Rust** — operações nativas, filesystem e recursos de sistema
- **React 19** — interface
- **TypeScript** — lógica do frontend
- **Vite** — build/dev server
- **Monaco Editor** — edição de texto/código

Dependências principais podem ser consultadas em [`package.json`](package.json).

## Estado atual

O projeto está sendo desenvolvido incrementalmente através de um roadmap de sete partes.

### ✅ Parte 1 — Explorer completo

A base do Explorer já está implementada e trabalha com o filesystem real do projeto.

Inclui:

- criar arquivo;
- criar pasta;
- renomear arquivos e pastas;
- excluir arquivos e pastas;
- expandir/recolher pastas;
- selecionar arquivos e pastas;
- atualizar a árvore do projeto;
- menu de contexto próprio no Explorer com ações para arquivos, pastas e raiz do projeto;
- abrir arquivos de texto reais;
- detecção básica de linguagem por extensão;
- integração com o autosave.

O Explorer é implementado principalmente em [`Workspace.tsx`](src/components/editor/Workspace.tsx) e no serviço [`projectFilesystem.ts`](src/services/projectFilesystem.ts).

### ✅ Parte 2 — Sistema de abas

O editor possui uma estrutura de múltiplas abas integrada ao Explorer.

Inclui:

- várias abas abertas ao mesmo tempo;
- uma aba por arquivo aberto;
- reutilização da aba existente ao reabrir um arquivo;
- troca rápida entre arquivos;
- fechamento de abas;
- seleção automática de outra aba ao fechar a ativa;
- indicação visual da aba ativa;
- nome e identificação do tipo de arquivo;
- indicador de arquivo modificado;
- confirmação antes de fechar uma aba com alterações pendentes;
- atualização das abas ao renomear arquivos;
- remoção segura das abas quando arquivos/pastas abertos são excluídos;
- menu de contexto nas abas com Fechar, Fechar Outras, Fechar à Direita e Fechar Todas;
- integração com o autosave e recuperação.

> Os atalhos `Ctrl + Tab` e `Ctrl + W` estão disponíveis desde a Parte 5. Grupos/divisão de editores continuam planejados.

### ✅ Parte 3 — Autosave + recuperação

A primeira implementação de autosave foi evoluída para uma camada inicial de recuperação local.

O Corant agora mantém snapshots de recuperação locais enquanto o usuário edita um arquivo. Se o conteúdo recuperável for diferente da versão existente no disco quando o arquivo for aberto novamente, o usuário pode escolher restaurá-lo ou continuar com a versão salva.

Inclui atualmente:

- autosave após aproximadamente 500 ms de inatividade;
- timers independentes por arquivo, mantendo o autosave ao trocar de aba;
- snapshot de recuperação local durante a edição;
- recuperação de conteúdo após encerramento inesperado/crash;
- comparação entre snapshot recuperável e arquivo salvo no disco;
- confirmação antes de restaurar uma versão recuperável;
- limpeza do snapshot após salvamento bem-sucedido ou rejeição da recuperação;
- integração com indicadores de alterações das abas;
- recuperação mantida localmente, sem backend.

A implementação inicial de recuperação está em [`recoveryStore.ts`](src/services/recoveryStore.ts), integrada ao [`Workspace.tsx`](src/components/editor/Workspace.tsx).

> Esta é a primeira versão robusta da recuperação. Melhorias futuras podem substituir o armazenamento do WebView por um journal nativo/Tauri se isso se mostrar necessário.

### ✅ Parte 4 — Busca global

A busca global foi implementada dentro do workspace em duas camadas integradas.

Inclui atualmente:

- busca por nome de arquivos e pastas em todo o projeto;
- busca por conteúdo nos arquivos de texto relevantes;
- resultados de conteúdo agrupados por arquivo e linha;
- abertura direta de arquivos a partir dos resultados;
- posicionamento do Monaco Editor na linha e coluna do resultado selecionado;
- integração com o sistema de abas existente, sem criar abas duplicadas;
- uso do conteúdo em memória para arquivos já carregados, incluindo alterações ainda recentes;
- debounce e cancelamento cooperativo de buscas antigas para manter a interface responsiva;
- exclusão inicial de diretórios de dependências/artefatos comuns, como `.git`, `node_modules`, `target`, `dist`, `build`, `.next` e `coverage`;
- exclusão de extensões binárias comuns da busca textual;
- limites de resultados para evitar renderizações excessivas em buscas muito amplas.

A interface está em [`GlobalSearchPanel.tsx`](src/components/editor/GlobalSearchPanel.tsx), a lógica de busca está em [`projectSearch.ts`](src/services/projectSearch.ts) e a navegação para resultados é integrada ao [`Workspace.tsx`](src/components/editor/Workspace.tsx) e ao [`MonacoEditor.tsx`](src/components/editor/monaco/MonacoEditor.tsx).

### ✅ Parte 5 — Menus funcionais

O workspace agora possui menus suspensos com navegação por teclado, atalhos visíveis, fechamento com `Esc`/clique externo e ações habilitadas conforme o contexto.

Inclui:

- `Arquivo`: criar arquivo/pasta, abrir projeto, salvar, salvar tudo, fechar abas/projeto e sair;
- `Editar`: desfazer/refazer, recortar/copiar/colar, excluir, selecionar tudo, localizar e substituir no Monaco;
- `Seleção`: selecionar linha, expandir/reduzir seleção e selecionar ocorrências;
- `Exibir`: Explorer, busca global, barra lateral, minimapa, quebra de linha, navegação entre abas e atualização do Explorer;
- `Ajuda`: guia local de uso/atalhos e informações da versão;
- `Terminal`: abre o terminal integrado; `Executar` lista comandos registrados por plugins internos quando disponíveis. O executor de tarefas continua planejado.

Salvar tudo inclui arquivos carregados com alterações, mesmo em abas inativas. As gravações são serializadas por arquivo para evitar conflitos entre autosave e salvamento manual. Abrir/fechar projeto e sair (inclusive pelo botão da janela) oferecem salvar alterações pendentes ou cancelar; uma falha de salvamento mantém o workspace aberto. Cada arquivo mantém seu próprio histórico de desfazer durante a sessão do projeto.

Renomear e excluir bloqueiam novas gravações nos caminhos afetados e aguardam as já iniciadas, inclusive para pastas. Renomear migra conteúdos, abas e recovery dos descendentes; excluir limpa também snapshots de arquivos fechados ou ainda não abertos. Models antigos do Monaco são descartados nessas operações, para não reutilizar conteúdo ou histórico ao recriar um caminho. O histórico de desfazer recomeça após renomear.

Ao fechar uma aba ainda modificada, a confirmação **Descartar e fechar** remove alterações não salvas, cache, recovery e histórico daquela aba; cancelar preserva o trabalho. Gravações já iniciadas são aguardadas antes da confirmação, mantendo a versão efetivamente salva no disco.

Atalhos principais: `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`, `Ctrl+W`, `Ctrl+Tab`/`Ctrl+Shift+Tab`, `Ctrl+Shift+E`, `Ctrl+Shift+F`, `Ctrl+B`, `Alt+Z` e `F1`.

A interface dos menus está em [`WorkspaceMenuBar.tsx`](src/components/editor/WorkspaceMenuBar.tsx), integrada ao [`Workspace.tsx`](src/components/editor/Workspace.tsx).

### ✅ Parte 6 — Terminal integrado

O workspace utiliza **uma única sessão de terminal por vez**, iniciada no diretório do projeto atual. O painel integrado usa xterm.js e pode ser ocultado sem interromper o shell; oferece reinício, encerramento e redimensionamento.

O backend Tauri/Rust usa ConPTY no Windows e encerra a árvore de processos ao fechar ou trocar o projeto.

### ⏳ Parte 7 — Sistema de plugins

A base da API v1 para plugins internos está implementada em [`src/plugins/api.ts`](src/plugins/api.ts) e [`src/plugins/host.ts`](src/plugins/host.ts). Inclui manifesto versionado, permissões declaradas e concedidas separadamente, ativação/desativação com cancelamento, comandos no menu Executar, acesso ao documento ativo e configurações locais por projeto/plugin. Edições preservam desfazer, autosave e recuperação, e rejeitam documentos ou versões antigos.

O catálogo explícito em [`src/plugins/builtins.ts`](src/plugins/builtins.ts) está vazio até a implementação dos plugins nativos. Essa API executa módulos internos confiáveis; não é um sandbox para código externo. Instalação/remoção, isolamento de plugins externos, integrações adicionais de UI e capacidades nativas continuam planejados. Configurações armazenam preferências, não chaves de API ou outros segredos.

O sistema completo contempla:

- API de plugins;
- ciclo de vida;
- instalação/remoção;
- comandos;
- settings;
- integração de UI;
- versionamento;
- permissões e capacidades nativas.

Plugins nativos planejados:

#### Copilot

Assistente de IA em que o usuário fornece sua própria chave de API e escolhe o provedor/modelo.

#### Good Vibes

Plugin nativo de aparência/temas, com múltiplas opções de tema incluindo variações claras e escuras.

#### Commands

Sistema de comandos configuráveis por formulário para automatizar tarefas repetitivas sem exigir que o usuário programe um plugin.

Exemplo de fluxo: escolher pasta inicial, selecionar arquivos/pastas, definir formato de saída (`md`, `txt`, `json` etc.) e decidir se os conteúdos dos arquivos serão incluídos.

## Recursos planejados além do roadmap principal

O produto completo também prevê:

- editor de imagens integrado;
- formas básicas, texto, cores, gradientes e camadas;
- preview por tipo de arquivo;
- importação/exportação de projetos e pastas em formatos de arquivo compactado comuns;
- drag and drop para importação;
- histórico/versionamento local;
- configurações por workspace;
- atalhos personalizáveis com importação/exportação;
- projetos recentes e favoritos;
- busca rápida por nome de arquivo;
- integração Git via plugin da comunidade, em vez de depender de Git como funcionalidade nativa obrigatória.

## Menus de contexto

O menu de contexto padrão do WebView foi desativado. O Corant agora utiliza menus próprios nas áreas em que existem ações da aplicação, com comportamento visual próximo ao de um editor desktop.

Atualmente:

- Explorer: ações de criação, abertura, renomeação, exclusão e atualização conforme o alvo clicado;
- abas: fechar a aba, fechar outras, fechar à direita e fechar todas;
- cliques fora do menu, `Esc`, redimensionamento e perda de foco fecham o menu;
- o menu se reposiciona para permanecer dentro da janela;
- o Monaco mantém seu próprio menu de contexto de editor.

## Editor

O Corant utiliza Monaco Editor para edição textual.

A configuração atual inclui, entre outros recursos:

- tema escuro;
- minimapa;
- layout automático;
- smooth scrolling;
- bracket pair colorization;
- guias de indentação;
- sugestões de código;
- comportamento de cursor suave.

A linguagem do arquivo é inferida principalmente pela extensão. Extensões desconhecidas podem ser abertas como texto puro.

## Arquitetura do workspace

A interface atual segue aproximadamente esta estrutura:

```text
Corant
└── Projeto
    ├── Barra de título
    ├── Menu
    ├── Explorer
    ├── Abas
    ├── Editor Monaco
    └── Barra de status
```

O projeto aberto é mantido no estado da aplicação e passado para o `Workspace` com nome e caminho local.

## Identidade visual

A identidade do Corant usa um símbolo próprio inspirado em tinta/corante vermelho, com uma estética suave e orgânica em vez de pixel art.

Características principais:

- vermelho/crimson;
- forma orgânica;
- gradientes;
- brilho e profundidade interna;
- sombra suave;
- fundo transparente;
- sem gotas externas separadas.

Asset principal:

[`public/corant-dye.svg`](public/corant-dye.svg)

O SVG funciona como arte-fonte da identidade. Os assets nativos de aplicação são gerados a partir dele para os formatos exigidos por cada plataforma.

## Estrutura do repositório

```text
Corant/
├── src/                  # frontend React/TypeScript
│   ├── app/              # estado principal da aplicação
│   ├── components/       # componentes da interface
│   ├── services/         # serviços do frontend, incluindo filesystem e recovery
│   └── styles/           # estilos globais e do workspace
├── src-tauri/            # backend nativo Tauri/Rust
├── public/               # assets públicos, incluindo a identidade visual
├── plugins/              # espaço reservado para plugins
├── tests/                # espaço reservado para testes
├── docs/                 # documentação adicional
├── scripts/              # scripts auxiliares
├── SPEC.md               # especificação de produto e técnica
├── package.json          # dependências e scripts
└── README.md             # visão geral do projeto
```

## Desenvolvimento local

Requisitos básicos:

- Node.js/npm
- Rust/Cargo
- ambiente de desenvolvimento compatível com Tauri 2

Instalar dependências:

```powershell
npm install
```

Executar o frontend:

```powershell
npm run dev
```

Executar o aplicativo Tauri em desenvolvimento:

```powershell
npm run tauri dev
```

Build do frontend:

```powershell
npm run build
```

Testes automatizados dos menus e da fila de salvamento:

```powershell
npm test
```

Os testes usam Playwright com Microsoft Edge instalado. Para usar outro navegador compatível, defina `PLAYWRIGHT_CHANNEL` (por exemplo, `chrome`). Os testes de interface executam o Monaco real com os assets instalados e simulam as chamadas nativas do Tauri; não substituem uma verificação manual no aplicativo desktop.

## Configuração Tauri

A configuração principal está em [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json).

A aplicação atualmente é configurada como uma janela desktop redimensionável e usa os assets gerados no diretório de ícones do Tauri.

O Explorer usa permissões explícitas do Tauri para as operações de filesystem que já fazem parte do núcleo atual: listar diretórios, ler e escrever arquivos de texto, criar pastas, renomear e excluir arquivos/pastas. Essas permissões são declaradas em [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json) e continuam limitadas pelo scope dinâmico da pasta de projeto autorizada pelo Corant, em vez de conceder acesso irrestrito ao filesystem do computador.

O Vite também é configurado para ignorar `src-tauri` no watcher, evitando conflitos com arquivos gerados pelo Cargo durante o desenvolvimento.

## Documentação

O documento de referência mais completo do projeto é o [`SPEC.md`](SPEC.md).

Ele descreve decisões de produto, arquitetura, estado atual, roadmap, requisitos planejados e restrições importantes. Quando houver dúvida sobre uma decisão do produto, o `SPEC.md` deve ser consultado antes de introduzir uma nova arquitetura.

## Princípios para desenvolvimento

Ao continuar o desenvolvimento do Corant:

1. preservar a arquitetura existente quando ela já atende ao requisito;
2. evitar duplicação de sistemas;
3. não implementar funcionalidades futuras antecipadamente só por conveniência;
4. manter o produto local-first;
5. priorizar segurança contra perda de dados;
6. separar claramente funcionalidades atuais de funcionalidades planejadas;
7. manter o workspace como centro da experiência.

## Licença e status

O Corant está em desenvolvimento ativo e ainda não representa uma versão final de distribuição.
