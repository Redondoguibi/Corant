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
- integração com o autosave e recuperação.

> Recursos como `Ctrl + Tab`, `Ctrl + W`, menu de contexto e grupos/divisão de editores continuam planejados para etapas posteriores.

### 🚧 Parte 3 — Autosave + recuperação

A primeira implementação de autosave foi evoluída para uma camada inicial de recuperação local.

O Corant agora mantém snapshots de recuperação locais enquanto o usuário edita um arquivo. Se o conteúdo recuperável for diferente da versão existente no disco quando o arquivo for aberto novamente, o usuário pode escolher restaurá-lo ou continuar com a versão salva.

Inclui atualmente:

- autosave após aproximadamente 500 ms de inatividade;
- snapshot de recuperação local durante a edição;
- recuperação de conteúdo após encerramento inesperado/crash;
- comparação entre snapshot recuperável e arquivo salvo no disco;
- confirmação antes de restaurar uma versão recuperável;
- limpeza do snapshot após salvamento bem-sucedido ou descarte;
- integração com indicadores de alterações das abas;
- recuperação mantida localmente, sem backend.

A implementação inicial de recuperação está em [`recoveryStore.ts`](src/services/recoveryStore.ts), integrada ao [`Workspace.tsx`](src/components/editor/Workspace.tsx).

> Esta é a primeira versão robusta da recuperação. Melhorias futuras podem substituir o armazenamento do WebView por um journal nativo/Tauri se isso se mostrar necessário.

### ⏳ Parte 4 — Busca global

Planejada em duas fases:

1. busca por nome de arquivos e pastas;
2. busca por conteúdo em todo o projeto, com resultados contextualizados e abertura direta do arquivo.

### ⏳ Parte 5 — Menus funcionais

Os menus do workspace deverão deixar de ser apenas visuais e começarão a executar ações reais.

Menus previstos:

- `Arquivo`
- `Editar`
- `Seleção`
- `Exibir`
- `Executar`
- `Terminal`
- `Ajuda`

### ⏳ Parte 6 — Terminal integrado

A visão do produto utiliza **uma única instância de terminal por vez**, iniciada no diretório do projeto atual.

A implementação deverá integrar React e Tauri/Rust para fornecer um terminal nativo dentro do workspace.

### ⏳ Parte 7 — Sistema de plugins

O sistema de plugins será projetado somente depois de a base estar estável.

A arquitetura deverá definir:

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

## Configuração Tauri

A configuração principal está em [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json).

A aplicação atualmente é configurada como uma janela desktop redimensionável e usa os assets gerados no diretório de ícones do Tauri.

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
