# Corant

> Workspace desktop local-first para organizar arquivos, editar documentos e trabalhar em projetos de qualquer área.

O **Corant** é um aplicativo desktop focado em trabalhar diretamente com projetos locais. A proposta é combinar gerenciamento de arquivos, edição de texto/código, terminal e plugins em um único workspace.

A filosofia do produto é simples: **abrir um projeto → ter as ferramentas integradas → começar a trabalhar**.

## Visão do produto

O Corant reúne ferramentas para projetos e tarefas do dia a dia; seu uso não se limita à programação.

- **Local-first:** o projeto vive no filesystem local.
- **Sem conta obrigatória:** o núcleo não depende de uma conta online.
- **Sem backend obrigatório:** o produto principal não depende de um servidor ou banco de dados central.
- **Projeto como unidade principal:** o usuário abre ou cria um projeto e trabalha dentro dele.
- **Extensível:** a API v1, três plugins internos e carregamento de plugins externos confiáveis estão implementados.

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
- **xterm.js** — interface do terminal, conectada ao backend ConPTY no Windows

Dependências principais podem ser consultadas em [`package.json`](package.json).

## Estado atual

As Partes 1–6 estão implementadas, assim como a API interna e os três plugins da Parte 7. Plugins externos podem ser instalados por pasta e gerenciados no workspace; marketplace e isolamento permanecem planejados.

Na tela inicial, é possível criar um projeto escolhendo nome e pasta de destino ou abrir uma pasta existente.

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
- `Terminal`: abre o terminal integrado; `Executar` lista comandos registrados por plugins e oferece o gerenciador de plugins externos. O executor de tarefas continua planejado.

Salvar tudo inclui arquivos carregados com alterações, mesmo em abas inativas. As gravações são serializadas por arquivo para evitar conflitos entre autosave e salvamento manual. Abrir/fechar projeto e sair (inclusive pelo botão da janela) oferecem salvar alterações pendentes ou cancelar; uma falha de salvamento mantém o workspace aberto. Cada arquivo mantém seu próprio histórico de desfazer durante a sessão do projeto.

Renomear e excluir bloqueiam novas gravações nos caminhos afetados e aguardam as já iniciadas, inclusive para pastas. Renomear migra conteúdos, abas e recovery dos descendentes; excluir limpa também snapshots de arquivos fechados ou ainda não abertos. Models antigos do Monaco são descartados nessas operações, para não reutilizar conteúdo ou histórico ao recriar um caminho. O histórico de desfazer recomeça após renomear.

Ao fechar uma aba ainda modificada, a confirmação **Descartar e fechar** remove alterações não salvas, cache, recovery e histórico daquela aba; cancelar preserva o trabalho. Gravações já iniciadas são aguardadas antes da confirmação, mantendo a versão efetivamente salva no disco.

Atalhos principais: `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`, `Ctrl+W`, `Ctrl+Tab`/`Ctrl+Shift+Tab`, `Ctrl+Shift+E`, `Ctrl+Shift+F`, `Ctrl+B`, `Alt+Z` e `F1`.

A interface dos menus está em [`WorkspaceMenuBar.tsx`](src/components/editor/WorkspaceMenuBar.tsx), integrada ao [`Workspace.tsx`](src/components/editor/Workspace.tsx).

### ✅ Parte 6 — Terminal integrado

O workspace utiliza **uma única sessão de terminal por vez**, iniciada no diretório do projeto atual. O painel integrado usa xterm.js e pode ser ocultado sem interromper o shell; oferece reinício, encerramento e redimensionamento.

O backend Tauri/Rust usa PTY real via ConPTY e, nesta versão, o terminal requer Windows. A prioridade de shell é `pwsh.exe`, `powershell.exe`, `%COMSPEC%` e `cmd.exe`. O shell inicia na pasta do projeto; parar/reiniciar, fechar/trocar o projeto ou encerrar o app provoca o encerramento da sessão e de seus processos. Eventos carregam a identificação da sessão para descartar saída atrasada de sessões antigas.

### Parte 7 — API e plugins internos/externos

A API v1 está em [`src/plugins/api.ts`](src/plugins/api.ts) e [`src/plugins/host.ts`](src/plugins/host.ts). Inclui manifesto versionado, permissões declaradas e concedidas separadamente, ativação/desativação com cancelamento, comandos, painéis, acesso ao documento ativo e configurações locais por projeto/plugin. Edições pela API preservam desfazer, autosave e recuperação e rejeitam documentos ou versões antigos.

O catálogo em [`src/plugins/builtins.ts`](src/plugins/builtins.ts) inclui os três plugins abaixo, disponíveis pelo menu **Executar**. Além deles, o gerenciador permite instalar, remover, ativar e desativar módulos externos confiáveis. Isolamento de código externo ainda não está implementado. As preferências locais dos plugins não armazenam chaves de API.

#### Plugins externos

Abra **Executar → Gerenciar plugins…**. O Corant descobre pacotes em `app_data_dir()/plugins/<id>/`, lê `manifest.json`, importa o entrypoint ES `.js`/`.mjs` e ativa pelo mesmo `PluginHost` usado pelos plugins internos. O caminho da pasta aparece no gerenciador. Instale escolhendo uma pasta ou coloque o pacote ali manualmente e atualize o catálogo.

Plugins novos começam desativados. A ativação é autorizada por projeto e vinculada ao manifesto/código; alterações exigem nova aprovação. Desativar remove comandos, painéis e subscriptions, e remover também exclui a cópia instalada. O código roda no mesmo ambiente do Corant, **sem sandbox**: as permissões da API não isolam código arbitrário. Use apenas plugins confiáveis.

O formato inicial usa um entrypoint autossuficiente, sem resolução de imports relativos ou pacotes npm. Veja o [guia de plugins externos](docs/PLUGINS.md) e o [exemplo instalável](examples/plugins/example.word-count).

#### Copilot

Assistente com chat e dois provedores: **Codex** e **OpenRouter**. Antes de conectar, o painel apresenta **Provedor**, **Entrar com código** e **Fazer login**. O chat abre quando a autenticação do Codex é detectada ou após configurar o OpenRouter.

- **Codex:** requer Windows e o Codex CLI no `PATH`, com suporte a `app-server`, descoberta de modelos e às políticas de aprovação usadas pelo Corant. O backend confere a política efetiva antes de enviar o pedido e rejeita configurações incompatíveis. O CLI deve ser instalado separadamente.
- **Login Codex:** **Fazer login** abre o navegador; **Entrar com código** inicia o login por dispositivo, que precisa estar habilitado na conta. Mantenha o painel aberto até concluir. O Corant usa seu próprio `CODEX_HOME` e o cofre de credenciais do sistema, sem aproveitar automaticamente o login do CLI pessoal. Links e códigos são descartados ao concluir, cancelar ou falhar.
- **Modelos Codex:** o dropdown consulta o catálogo do CLI, sem uma lista fixa no Corant. Atualiza aproximadamente a cada cinco minutos com o painel visível, ao recuperar o foco respeitando um intervalo mínimo e pelo botão de atualização. A disponibilidade depende do catálogo retornado pelo Codex; o Corant não instala atualizações do CLI.
- **OpenRouter:** usa chave de API e modelo informados pelo usuário. A chave fica somente na memória do painel. Propostas de substituição do documento ativo exigem aplicação manual e verificação de versão.

O Codex pode operar diretamente no projeto com três modos:

| Modo | Comportamento |
| --- | --- |
| Solicitar aprovação | Sandbox somente leitura; solicita aprovação quando necessário para ampliar acesso. |
| Aprovar por mim | Permite escrita no projeto e usa a revisão automática nativa do Codex para ações que exigem aprovação. |
| Acesso completo | Executa sem sandbox e sem solicitar aprovações, após ativação explícita na sessão. |

Aprovações são vinculadas à operação e descartadas no cancelamento. Antes de uma operação do agente, o editor salva alterações pendentes, bloqueia edições concorrentes e relê os arquivos ao terminar. Esses modos não se aplicam ao OpenRouter.

O usuário pode anexar explicitamente o arquivo aberto. O histórico do chat fica na memória do painel, sem persistência entre sessões; as respostas são exibidas ao concluir, sem transmissão gradual de tokens na interface. A integração não reproduz todos os recursos do app ou da extensão oficial do Codex. Os pedidos de IA dependem de serviços online e enviam a eles o conteúdo necessário ao pedido.

#### Good Vibes

Oferece os temas **Crimson**, **Amanhecer** e **Meia-noite**, incluindo interface, editor e terminal. A escolha é salva por projeto.

#### Commands

Catálogo de dez ferramentas locais para projetos de qualquer área:

| Ferramenta | Função |
| --- | --- |
| Exportar árvore de pastas | Gera a estrutura visual, Markdown ou JSON de uma pasta, incluindo subpastas e pastas vazias. |
| Juntar documentos | Reúne arquivos em uma exportação e permite salvar receitas de seleção. |
| Inventário de arquivos | Lista caminhos, tipos e extensões em CSV ou JSON. |
| Criar checklist | Converte linhas em itens de checklist Markdown. |
| Contar texto | Conta palavras, caracteres, linhas e parágrafos. |
| Maiúsculas e minúsculas | Converte a capitalização do texto. |
| Limpar espaços | Remove espaços nas extremidades das linhas e reduz linhas vazias repetidas. |
| Ordenar linhas | Ordena linhas em ordem crescente ou decrescente. |
| Remover linhas duplicadas | Mantém a primeira ocorrência, com opção de ignorar maiúsculas/minúsculas. |
| Localizar e substituir | Substitui ocorrências literais de um texto. |

Abra **Executar → Commands — ferramentas**. Para exportar uma árvore diretamente, clique com o botão direito numa pasta do Explorer e escolha **Exportar árvore da pasta…**. Escolha o formato, confira a prévia e defina o nome e a extensão do arquivo. Links simbólicos não são percorridos.

As ferramentas de texto recebem texto colado/digitado ou importado explicitamente do documento ativo; não alteram o original. Resultados podem ser copiados ou salvos em arquivos novos na raiz do projeto, sem sobrescrever existentes. A exportação da árvore permite escolher a extensão independentemente do formato. Limites incluem 10.000 itens na árvore/inventário, 500 arquivos e 4 MiB de conteúdo ao juntar documentos e 1 MiB por entrada nas ferramentas de texto.

## Recursos planejados além do roadmap principal

O produto completo também prevê:

- evolução do editor de imagens, incluindo projetos de camadas persistentes e gerenciamento de cor;
- previews adicionais por tipo de arquivo, como Markdown renderizado (imagens e SVG já têm prévia);
- importação/exportação de projetos e pastas em formatos de arquivo compactado comuns;
- drag and drop para importação;
- histórico/versionamento local;
- painel geral de configurações por workspace (preferências dos plugins já existem);
- atalhos personalizáveis com importação/exportação;
- projetos recentes e favoritos;
- paleta dedicada de abertura rápida de arquivos (a busca global por nome já existe);
- integração Git via plugin da comunidade, em vez de depender de Git como funcionalidade nativa obrigatória.

## Menus de contexto

O menu de contexto padrão do WebView foi desativado. O Corant agora utiliza menus próprios nas áreas em que existem ações da aplicação, com comportamento visual próximo ao de um editor desktop.

Atualmente:

- Explorer: ações de criação, abertura, renomeação, exclusão e atualização conforme o alvo clicado, além de exportar a árvore de uma pasta pelo Commands;
- abas: fechar a aba, fechar outras, fechar à direita e fechar todas;
- cliques fora do menu, `Esc`, redimensionamento e perda de foco fecham o menu;
- o menu se reposiciona para permanecer dentro da janela;
- o Monaco mantém seu próprio menu de contexto de editor.

## Editor

O Corant utiliza Monaco Editor para edição textual.

A configuração atual inclui, entre outros recursos:

- temas claros e escuros pelo Good Vibes;
- minimapa;
- layout automático;
- smooth scrolling;
- bracket pair colorization;
- guias de indentação;
- sugestões de código;
- comportamento de cursor suave.

A linguagem do arquivo é inferida principalmente pela extensão. Extensões desconhecidas podem ser abertas como texto puro.

## Editor e visualização de imagens

Abrir um arquivo PNG, JPG/JPEG, GIF, WebP, AVIF, BMP, ICO, TIFF/TIF ou SVG pelo Explorer mostra sua prévia na própria aba, com fundo quadriculado para transparência, dimensões, ajuste à tela e tamanho original. O limite de leitura é 32 MiB por imagem (80 MiB para TIFF); arquivos inválidos ou não suportados pelo WebView exibem uma mensagem de erro.

SVG permite alternar entre **Editar SVG** e **Visualizar SVG**, preservando o fluxo de autosave e recuperação do editor. A prévia usa a imagem isolada em um elemento `img`, sem executar scripts do SVG. O botão **Editar imagem** abre o estúdio integrado:

- recorte por arraste, rotação, espelhamento e redimensionamento com proporção;
- pincel, borracha, retângulo, elipse, triângulo, pentágono, seta e texto;
- cores, gradientes, espessura e opacidade;
- camadas com seleção, movimento, visibilidade, duplicação, exclusão e ordenação;
- brilho, contraste, saturação, preto e branco e sépia;
- zoom, comparação com a base e histórico de até 30 estados, limitado também por memória;
- exportação de cópias PNG, JPEG, WebP e TIFF na raiz do projeto, sem sobrescrever arquivos.

Rascunhos de imagens permanecem ao trocar de aba. Fechar abas/projeto ou sair com edições não exportadas solicita confirmação; exportações em andamento bloqueiam operações que poderiam invalidá-las. As camadas existem apenas na sessão atual: as cópias exportadas são imagens rasterizadas, sem camadas editáveis. Transformações geométricas unem as camadas e podem ser desfeitas. Não há recuperação de imagens após crash nesta versão.

O editor trabalha em RGBA de 8 bits, com até 16 megapixels e quatro imagens em edição. O TIFF é decodificado no Rust: primeira página, RGB/tons de cinza de 8 ou 16 bits e CMYK de 8 bits. Imagens de 16 bits são convertidas para 8 bits; metadados e perfis de cor não são preservados. SVG e animações são rasterizados ao entrar no editor visual. O TIFF exportado contém uma única página RGBA de 8 bits.

## Arquitetura do workspace

A interface atual segue aproximadamente esta estrutura:

```text
Corant
└── Projeto
    ├── Barra de título
    ├── Menu
    ├── Barra lateral: Explorer / busca global
    ├── Abas e editor Monaco
    ├── Painel de plugin
    ├── Terminal integrado
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
│   ├── plugins/          # API, host, gerenciador e plugins internos
│   ├── services/         # serviços do frontend, incluindo filesystem e recovery
│   └── styles/           # estilos globais e do workspace
├── src-tauri/            # backend nativo Tauri/Rust
├── public/               # assets públicos, incluindo a identidade visual
├── tests/                # testes Playwright de interface e lógica
├── SPEC.md               # especificação de produto e técnica
├── package.json          # dependências e scripts
└── README.md             # visão geral do projeto
```

## Desenvolvimento local

Requisitos básicos:

- Node.js/npm
- Rust/Cargo
- ambiente de desenvolvimento compatível com Tauri 2; no Windows, ferramentas de compilação MSVC e WebView2

O ambiente principal é Windows 11 com Rust MSVC. Terminal integrado e integração Codex estão implementados apenas para Windows nesta versão. Execute os comandos abaixo na raiz deste repositório, onde está o `package.json`.

Instalar dependências:

```powershell
npm install
```

Executar apenas o frontend no navegador (as integrações nativas exigem o aplicativo Tauri):

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

Testes automatizados de interface, persistência, terminal, API e plugins:

```powershell
npm test
```

Os testes usam Playwright com Microsoft Edge instalado. Para usar outro navegador compatível, defina `PLAYWRIGHT_CHANNEL` (por exemplo, `chrome`). Os testes de interface executam o Monaco real com os assets instalados e simulam as chamadas nativas do Tauri; não substituem uma verificação manual no aplicativo desktop.

Verificar e testar o backend Rust:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

Gerar o build desktop:

```powershell
npm run tauri build
```

## Configuração Tauri

A configuração principal está em [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json).

A aplicação atualmente é configurada como uma janela desktop redimensionável e usa os assets gerados no diretório de ícones do Tauri.

O Explorer usa permissões explícitas do Tauri para as operações de filesystem que já fazem parte do núcleo atual: listar diretórios, ler e escrever arquivos de texto, ler imagens e seus metadados, criar pastas, renomear e excluir arquivos/pastas. Essas permissões são declaradas em [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json) e continuam limitadas pelo scope dinâmico da pasta de projeto autorizada pelo Corant, em vez de conceder acesso irrestrito ao filesystem do computador.

O scope do Explorer não restringe o shell local do terminal. No Copilot/Codex, o acesso depende do modo de sandbox/aprovação selecionado; **Acesso completo** permite operar fora da pasta do projeto. As permissões da API de plugins internos não constituem isolamento para código externo.

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

## Status

O Corant está em desenvolvimento ativo e ainda não representa uma versão final de distribuição.
