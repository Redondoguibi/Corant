# Corant — Product & Technical Specification

> Living specification for the Corant desktop application.
>
> This document consolidates the product vision, UX decisions, architecture, implementation status, roadmap, constraints, and known design decisions established for the project so far.
>
> **Important:** sections marked **Current** describe the implementation that exists or has been verified in the repository. Sections marked **Planned** describe agreed product requirements that are not necessarily implemented yet.

---

## 1. Product identity

**Name:** Corant  
**Type:** Desktop application  
**Business model:** Paid application using a **one-time purchase** model  
**Core philosophy:** local-first, project-centric, no required online account, no required backend/database for the core product.

The broad product idea is a workspace for developers and creative/technical users. Instead of being only a code editor, Corant combines project/file management with an editor and, later, image editing, terminal, plugins, search, commands, and other integrated tools.

A useful positioning concept established during planning is:

- **VS Code:** editor first -> extensions -> build your environment.
- **Corant:** workspace first -> integrated tools -> start working.

Corant should not attempt to beat VS Code at every feature. Its differentiation is the focused, integrated workspace experience and its local-first philosophy.

---

## 2. Product principles

### 2.1 Local-first

The core application should work from the local filesystem. A user should not need an online account or Corant-controlled backend/database to create and work on projects.

### 2.2 Project-centric

The project is the primary unit of work. Opening Corant leads to project creation/opening, then into a workspace containing the project's files and tools.

### 2.3 Integrated tools

Code editing, filesystem browsing, image editing, terminal, search, commands, and plugins should feel like parts of one workspace rather than unrelated applications bolted together.

### 2.4 Extensible, but only after the core is stable

The plugin system is intentionally late in the roadmap. Core filesystem/editor behavior, tabs, persistence, search, menus, and terminal should become reliable before plugin APIs and permissions are finalized.

### 2.5 Avoid unnecessary complexity

Corant should prefer straightforward local architecture over services or infrastructure that are not necessary for the desktop product.

---

## 3. Opening experience

When Corant opens, the user should see a **welcome/project screen** rather than being dropped directly into an editor.

The opening screen is intended to provide:

- Create project
- Open existing project
- Recent projects (planned)
- Favorite projects (planned)

Creating a project asks for a project name and a parent location, then creates a real directory on the local filesystem.

Opening a project uses the native directory picker and loads the selected folder as the Corant project.

### Current implementation

`src/app/App.tsx` currently handles the high-level application state:

- no project selected -> `WelcomeScreen`
- create project -> `CreateProjectDialog`
- open project -> native directory picker
- project selected -> `Workspace`

The current application state stores the project name and filesystem path in React state.

---

## 4. Workspace concept

The workspace is the main working environment after a project is opened.

Current visual structure:

1. Corant/project title bar
2. Menubar
3. Explorer/sidebar
4. Editor area
5. Status bar/related workspace UI

The current workspace title area identifies Corant and the active project and includes a way to return to the home screen.

The project name should remain visible enough that users always know which project they are working on.

---

## 4.1 Context-menu behavior

The browser/WebView default context menu is suppressed across the Corant application so web-browser actions are not exposed as part of the desktop UX.

Current behavior:

- Explorer items use a Corant-owned context menu with actions appropriate to the project root, folders, and files
- editor tabs use a Corant-owned context menu for tab-closing operations
- the reusable menu supports viewport-aware positioning, outside-click dismissal, `Esc`, and keyboard up/down navigation
- Monaco keeps its own editor context menu enabled because it is part of the code-editor experience and already aligns with the desktop-editor interaction model
- areas without a Corant context menu do not fall back to the WebView/browser menu

This is a core UI behavior and does not mean Part 5 functional top menus are complete.

---

## 5. Explorer

## 5.1 Goal

The Explorer is a real filesystem explorer for the opened project, not a fake in-memory tree.

## 5.2 Current status — Part 1

The first major implementation pass has been completed in the codebase.

Current functionality includes:

- create file
- create folder
- rename files
- rename folders
- delete files
- delete folders
- expand folders
- collapse folders
- select files/folders
- refresh/reload the project tree
- custom Explorer context menu for project root, folders, and files
- open real text files
- display the project tree recursively
- basic file-language detection based on extension
- autosave text-file edits
- error handling around filesystem operations

The current `Workspace.tsx` uses a filesystem service and the Tauri filesystem/dialog plugins for these operations.

### Relevant implementation

Current workspace component:

`src/components/editor/Workspace.tsx`

Current filesystem service is under:

`src/services/projectFilesystem.ts`

The exact service implementation should be treated as the source of truth when extending filesystem behavior.

### Explorer behavior decisions

- Selecting a file should make it the active editor file.
- Selecting a folder should allow folder-level creation operations.
- Creating a file creates a real file inside the selected parent directory.
- Creating a folder creates a real directory.
- Rename changes the real filesystem entry.
- Delete removes the real filesystem entry and asks for confirmation.
- Deleting a directory is recursive and warns that its contents will also be removed.
- The Explorer should remain synchronized with the actual filesystem after mutations.

### File naming philosophy

Corant should allow files with arbitrary normal names/extensions rather than restricting the product to only source-code files.

Examples:

- `hello_word.js`
- `teste.md`
- `config.json`
- arbitrary text-oriented extensions

Unknown text extensions should fall back to plain text rather than being rejected.

---

## 6. Editor

## 6.1 Monaco Editor

Corant uses Monaco Editor for text editing.

Current implementation:

`src/components/editor/monaco/MonacoEditor.tsx`

Current Monaco behavior includes:

- Monaco as the text editor
- dark theme
- automatic layout
- minimap
- configurable font size/line height
- smooth scrolling
- bracket-pair colorization
- indentation guides
- syntax suggestions
- smooth cursor behavior
- scroll behavior suitable for the workspace

Current language selection is inferred from file extension in `Workspace.tsx`.

Supported mappings currently include at least:

- TypeScript / TSX
- JavaScript / JSX
- JSON
- CSS
- SCSS
- Less
- HTML / HTM
- XML
- Markdown / MD
- Python
- Java
- Rust
- C
- C++ variants
- YAML
- TOML (mapped to INI language mode)
- SQL
- shell scripts
- batch/cmd
- PowerShell
- TXT/plaintext
- unknown extensions -> plaintext

## 6.2 Image editor

A native/basic image editor is part of the intended Corant product, not merely a plugin.

Planned capabilities:

- basic shapes such as square, triangle, circle, pentagon and arrows
- text
- colors
- gradients
- layers
- image editing inside the workspace

The image editor is intended to make Corant useful not only for source code but also for technical/creative project assets.

The image editor is not yet part of the current implementation represented by this specification's initial repository state.

---

## 7. Tabs — Part 2

**Status: implemented in the current repository.**

The current editor provides the initial intended multi-tab system. Some convenience features remain planned for later.

The tabs system should provide:

- multiple files open at the same time
- one tab per opened file
- clicking a tab switches the active editor
- closing a tab
- active-tab visual state
- file name + file-type/icon indication
- opening a file already open should reuse its existing tab rather than create duplicates
- tabs should survive navigation through the Explorer
- edited tabs should expose a modified/dirty state
- closing modified tabs must not silently lose changes
- renaming a file must update the corresponding tab
- deleting an open file must update/remove its tab safely
- closing the active tab should select a sensible neighboring tab
- tab state must integrate with autosave/recovery
- tabs have a custom context menu with close, close others, close to the right, and close all actions

Planned future tab features may include:

- `Ctrl + Tab`
- `Ctrl + W`
- visual unsaved marker such as `●`
- split editor / editor groups

These future features are not required for the initial tab implementation.

### Important architecture requirement

The tab system should extend the current `Workspace` state rather than introduce a disconnected editor system.

Existing state that should be considered when implementing tabs includes:

- active file path
- loaded file contents
- Explorer entries
- refresh state
- autosave state

---

## 8. Autosave + recovery — Part 3

**Status: implemented in the current repository as the initial local recovery layer.**

The first autosave implementation has been extended with local recovery snapshots.

Current initial behavior:

- when the active file content changes, Corant waits roughly 500 ms
- then writes the file through the filesystem service
- UI exposes a saving/saved/error state

The current implementation is the first recovery layer; further hardening can be added later.

### Current implementation

The final persistence system should provide:

- reliable autosave
- prevention of accidental data loss
- recovery after unexpected application termination
- recovery after crashes
- recovery after forced shutdown
- clear distinction between the current on-disk file and recoverable unsaved state
- recovery cleanup once the user accepts/rejects a recovery state
- integration with tabs and dirty markers

The recovery store is implemented in `src/services/recoveryStore.ts` and integrated into `src/components/editor/Workspace.tsx`. It remains local-first and does not require a Corant backend.

---

## 9. Application close behavior

When the application is closed, Corant should ask for confirmation rather than silently exiting.

As the persistence system matures, close behavior should also account for:

- active saves
- dirty tabs
- recoverable unsaved changes
- failed saves

The final UX should never make it easy to accidentally lose user work.

---

## 10. Global search — Part 4

**Status: implemented in the current repository.**

The initial global-search system is implemented in two integrated layers inside the workspace sidebar.

### Phase A — filename/folder search

Current behavior:

- searches file and folder names across the loaded project tree
- also matches relative paths
- does not require the user to manually expand folders first
- file results open through the existing tab system
- folder results return to the Explorer and expand the relevant path

### Phase B — content search

Current behavior:

- searches relevant text files across the project
- uses the in-memory content for files already loaded in the editor, so recent edits can participate in search
- groups results by file
- shows the matching line and contextual line text
- clicking a result opens/reuses the corresponding tab
- Monaco moves to the matching line and column
- searches are debounced and older runs use cooperative cancellation so stale searches do not replace newer results
- the search loop periodically yields back to the browser event loop to reduce UI blocking

### Initial search guardrails

To keep the first implementation practical on larger projects:

- common dependency/generated directories are excluded from content search: `.git`, `node_modules`, `target`, `dist`, `build`, `.next`, and `coverage`
- common binary extensions are excluded from text search
- filename/path results are limited to 120
- content results are limited to 500 total matching lines
- each file contributes at most 100 matching lines to one search

These are implementation guardrails, not a requirement that the exclusions remain permanently hard-coded. A later settings/search-options pass can make them configurable if needed.

### Relevant implementation

- `src/components/editor/GlobalSearchPanel.tsx` — search UI, result grouping, debounce and cancellation
- `src/services/projectSearch.ts` — filename/path filtering and project-wide content search
- `src/components/editor/Workspace.tsx` — sidebar integration and tab navigation
- `src/components/editor/monaco/MonacoEditor.tsx` — reveal/focus behavior for a selected search result
- `src/styles/search.css` — search-panel visual styling

---

## 11. Menus — Part 5

**Status: next implementation stage.**

The current top menubar is visual and contains items such as:

- Arquivo
- Editar
- Seleção
- Exibir
- Executar
- Terminal
- Ajuda

These currently need to become functional menus.

### Intended approach

Menus should use dropdown menus rather than a command-palette-only interaction model.

The planned menus should expose real application actions such as:

**Arquivo**
- new file
- new folder
- open project
- save
- save all
- close tab
- close project
- exit

**Editar**
- undo
- redo
- cut
- copy
- paste
- delete
- select all

**Seleção**
- selection-related editor actions

**Exibir**
- workspace visibility/navigation actions
- future panel toggles

**Executar**
- run-related actions where supported

**Terminal**
- open/focus terminal
- future terminal commands/actions

**Ajuda**
- about
- documentation/help
- support-related links/actions as appropriate

The exact menu contents should evolve with implemented capabilities instead of exposing dead actions.

---

## 12. Integrated terminal — Part 6

Corant should include an integrated terminal.

### Product decision

There should be **one terminal instance at a time**.

The terminal should:

- run from the current project directory
- execute the user's local shell commands
- remain integrated into the workspace UI
- work with the active project path
- coexist with the Explorer/editor rather than launching an external terminal for normal use

The exact terminal implementation/PTY strategy is still to be designed.

Because this is a native desktop capability, it belongs primarily on the Tauri/Rust side, with the React UI providing the terminal interface.

---

## 13. Plugin system — Part 7

Plugins are intentionally the final major stage of the initial roadmap.

Plugin work should begin only after the core workspace is stable.

### Goals

The plugin system should define:

- plugin discovery
- plugin installation/removal
- plugin lifecycle
- plugin API
- permissions/capabilities
- secure access to filesystem and native operations
- UI integration points
- command registration
- settings
- versioning/compatibility

### Security philosophy

Plugins should not automatically receive unlimited native/system access.

The design should use explicit permissions/capabilities so a plugin can declare what it needs.

This is especially important because Corant is a native desktop application with access to the user's filesystem and terminal.

### Community vs native features

Git integration is intentionally considered a community-plugin responsibility rather than something Corant must make a core native feature from the beginning.

### Native plugins planned

#### Copilot

A native AI assistant plugin.

User-facing concept:

- user supplies their own provider API key
- user chooses the model
- Corant does not need to provide a mandatory AI backend

The plugin architecture should make it possible to support different AI providers/models.

#### Good Vibes

A native appearance/theme plugin.

Current design direction includes approximately three themes, with light/dark support among the theme options.

#### Commands

A native configurable command/plugin system.

A command is intended to be defined through a form rather than requiring the user to write plugin code.

Example command concept:

- choose starting folder
- choose selected files/folders or a source location
- convert files/folders to text
- choose output format such as MD/TXT/JSON
- choose whether file contents should be included
- define other variables/options through a form

The purpose is to let users create reusable workflow commands without programming each one as a plugin.

---

## 14. Import/export

Corant should support importing/exporting projects and folders through archive formats.

Desired archive support includes formats such as:

- ZIP
- RAR
- TAR
- 7z
- other common archive formats where practical

The goal is to allow a user to package or restore a project without requiring an external application for ordinary workflows.

The exact implementation and dependency strategy has not yet been finalized.

---

## 15. Drag and drop

Planned product behavior includes drag-and-drop import into the project/workspace.

The exact interaction model still needs implementation details, but files should be able to move from the user's normal desktop/file manager into Corant's project workflow.

---

## 16. Preview system

Corant should support previewing files according to their type.

Examples may include:

- text/code -> editor
- images -> image preview/editor
- Markdown -> rendered preview
- other supported formats -> appropriate preview where practical

The preview architecture should be extensible and should not assume every file must be edited as plaintext.

---

## 17. Workspace settings

Settings should exist at the workspace/project level.

The product has a planned distinction between:

- application/global preferences
- workspace/project settings

Workspace settings should be stored locally and should belong to the project/workspace rather than requiring a central account.

---

## 18. Shortcuts

The application should provide customizable keyboard shortcuts.

Requirements:

- configure shortcuts
- persist shortcut configuration locally
- export shortcut configuration
- import shortcut configuration

The exact shortcut UI and conflict-resolution behavior remain to be implemented.

---

## 19. History / versioning

Corant should provide project/file history and versioning functionality.

The exact scope is not yet fully specified, but the product concept includes:

- historical states
- ability to recover previous versions
- integration with the local-first philosophy

This is separate from Git integration. Git is planned as a community plugin responsibility, while Corant's own recovery/history should work without requiring Git.

---

## 20. Recent and favorite projects

The welcome screen is intended to support:

- recent projects
- favorite projects
- quick project reopening

This should remain local-first and should not require a Corant account.

---

## 21. Quick file-name search

The global-search infrastructure implemented in Part 4 now provides quick file/folder-name discovery without requiring manual tree expansion.

This initial implementation shares the same workspace sidebar search UI and project-entry data as content search. A separate quick-open interaction or dedicated shortcut can still be added later without duplicating the underlying search logic.

---

## 22. Visual identity

Corant has a custom visual identity centered around a smooth red dye/liquid-like symbol.

### Design requirement

The icon is inspired by Minecraft dye as a thematic reference, but it should **not be pixelated or made from obvious square blocks**.

The approved design direction is:

- smooth organic silhouette
- red/crimson palette
- gradients
- glossy/highlight regions
- internal depth/shading
- subtle shadow
- transparent background
- no separate external droplets

Current asset:

`public/corant-dye.svg`

The same symbol is used in the UI for the welcome screen and workspace branding.

### Application icon

The SVG is treated as the design/source asset. Native desktop icon assets are generated from it for platform bundles.

Current Tauri configuration references generated native assets under:

`src-tauri/icons/`

including PNG, ICO and ICNS forms.

---

## 23. Visual language / UI style

The current UI direction is a polished dark desktop application with a restrained crimson accent.

Characteristics:

- dark charcoal/black base
- crimson/red accents
- subtle gradients
- soft shadows
- thin borders
- rounded corners where appropriate
- compact but readable editor/workspace chrome
- refined hover/focus states
- Corant dye symbol used as branding

The UI should feel like a serious desktop productivity/development tool rather than a generic web dashboard.

---

## 24. Current technical architecture

### Frontend

- React
- TypeScript
- Vite
- Monaco Editor

### Desktop/native layer

- Tauri 2
- Rust

### Native capabilities currently used

- filesystem access through Tauri filesystem plugin
- native dialogs through Tauri dialog plugin
- Tauri commands for project creation and filesystem scope management

### Current package baseline

The repository currently includes dependencies for:

- React 19.x
- React DOM 19.x
- Vite 8.x
- TypeScript 7.x
- Tauri CLI 2.x
- Tauri API 2.x
- Tauri filesystem plugin 2.x
- Tauri dialog plugin 2.x
- Monaco Editor
- `@monaco-editor/react`

Exact package versions should be read from `package.json` rather than assumed from this prose when compatibility decisions are made.

---

## 25. Tauri project structure

Current key native files include:

- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`

The current Tauri window is configured as:

- title: `Corant`
- width: 800
- height: 600
- resizable: true
- fullscreen: false

The build uses:

- frontend distribution: `../dist`
- dev URL: `http://localhost:5173`
- dev command: `npm run dev`
- build command: `npm run build`

The current Tauri bundle targets all configured target types and references generated platform icon assets.

---

## 26. Filesystem security model

The native layer currently uses Tauri's filesystem scope mechanisms.

The native code includes commands to:

- validate a selected project directory
- canonicalize its path
- add the project directory to the allowed filesystem scope
- create a new project directory
- add the newly created project to the filesystem scope

Current relevant native functions include:

- `allow_project_directory`
- `create_project_directory`

The native implementation uses `tauri_plugin_fs::FsExt` to access the filesystem scope API.

This scoped design should remain important as future features add terminal, recovery, archive, preview, and plugin capabilities.

---

## 27. Build/development setup

The normal development stack is:

1. Windows
2. PowerShell / Windows shell
3. Node/npm
4. Vite
5. Tauri 2
6. Rust/Cargo
7. IntelliJ IDEA as the preferred IDE
8. GitHub repository for source control

Primary repository:

`Redondoguibi/Corant`

Primary branch currently used during development:

`main`

### Useful commands

Start frontend development server:

```powershell
npm run dev
```

Start Tauri development application:

```powershell
npm run tauri dev
```

Build frontend:

```powershell
npm run build
```

Tauri CLI is exposed through the npm script:

```powershell
npm run tauri
```

---

## 28. Vite watcher decision

The project previously encountered an `EBUSY` problem because Vite was watching the Tauri/Cargo output under `src-tauri` while Cargo was modifying files there.

The chosen solution is to ignore the Tauri directory in the Vite watcher.

This should be preserved when modifying `vite.config.ts`.

Current intended configuration concept:

```ts
server: {
  watch: {
    ignored: ["**/src-tauri/**"],
  },
},
```

Do not remove this without a deliberate replacement strategy.

---

## 29. Current key frontend files

Known key files in the repository include:

```text
src/
├── app/
│   └── App.tsx
├── components/
│   ├── editor/
│   │   ├── Workspace.tsx
│   │   ├── ExplorerNameDialog.tsx
│   │   └── monaco/
│   │       └── MonacoEditor.tsx
│   ├── layout/
│   │   └── WelcomeScreen.tsx
│   └── projects/
│       └── CreateProjectDialog.tsx
├── services/
│   └── projectFilesystem.ts
├── styles/
│   ├── app.css
│   └── index.css
└── main.tsx
```

The exact repository structure should be checked before introducing new files because the implementation will evolve.

---

## 30. Current Explorer/workspace architecture

The current workspace maintains React state for concepts including:

- project entries
- active file path
- selected Explorer entry
- loaded file contents
- expanded directories
- loading state
- error state
- save state
- filesystem refresh key
- pending active path
- file/folder/rename name dialog state

The active editor file is derived from the active path and the filesystem entries.

File content is loaded lazily through the filesystem service when a file becomes active.

This architecture should be extended carefully as tabs and recovery are added.

---

## 31. Important implementation lessons / known issues

### 31.1 Do not make filesystem assumptions

The Explorer represents actual filesystem entries. Operations must be implemented against the real project path rather than only changing UI state.

### 31.2 Tauri filesystem APIs depend on capabilities/scopes

Code that writes to the filesystem must have appropriate Tauri permissions and scope. A feature that works in React code can still fail if the native capability configuration does not allow the operation.

### 31.3 Rust trait imports matter

The project previously hit a Rust compiler error because `fs_scope()` came from the `FsExt` trait and the trait had not been imported.

Current native code therefore imports:

```rust
use tauri_plugin_fs::FsExt;
```

Preserve this when editing the filesystem-scope code.

### 31.4 Avoid silent changes to user requirements

When implementing new Corant features:

- do not silently alter requested constants/behavior
- preserve established architecture when possible
- explain intentional deviations
- verify the existing repository state before replacing files

---

## 32. Product roadmap

This is the agreed initial implementation order.

### Part 1 — Explorer complete

**Status: implemented as the current base.**

- create file
- create folder
- rename
- delete
- expand/collapse
- real filesystem integration

### Part 2 — Tabs

**Status: implemented in the current repository.**

- multiple open files
- closing tabs
- dirty/modified indication
- safe closing
- no duplicate tabs
- Explorer/tab synchronization

### Part 3 — Autosave + recovery

**Status: implemented in the current repository as the initial recovery layer.**

- robust autosave
- crash recovery
- unexpected-close recovery
- recovery cleanup
- integration with dirty tabs

### Part 4 — Global search

**Status: implemented in the current repository.**

- filename/folder and relative-path search
- project-wide text-content search
- results grouped by file and line
- tab integration and Monaco line navigation
- initial performance exclusions/limits for generated and binary content

### Part 5 — Functional menus

**Status: next implementation stage.**

- File/Edit/Selection/View/Run/Terminal/Help menus become operational

### Part 6 — Integrated terminal

**Status: planned.**

- one terminal instance
- current project as working directory

### Part 7 — Plugin system

**Status: planned after core stability.**

- API
- lifecycle
- permissions/security
- UI integration
- native plugins: Copilot, Good Vibes, Commands

---

## 33. Features discussed for the broader product

The broader Corant concept also includes the following planned capabilities:

- image editor
- archive import/export
- drag-and-drop import
- preview by file type
- workspace/project settings
- history/versioning
- recent projects
- favorite projects
- quick file-name search
- customizable shortcuts
- shortcut export/import
- plugin permissions
- AI plugin integration through user-supplied provider credentials
- community plugin support for Git integration

Not all of these have an implementation specification yet.

---

## 34. Relationship to VS Code

Corant is not intended to be a drop-in replacement that matches every VS Code feature.

The strategic distinction is:

### VS Code strengths Corant does not need to duplicate immediately

- extremely broad extension ecosystem
- mature debugging ecosystem
- mature Git/SCM ecosystem
- remote development ecosystem
- container/SSH workflows
- huge marketplace

### Corant differentiation

- project/workspace-centric experience
- local-first architecture
- integrated image editing concept
- integrated filesystem/workspace workflow
- opinionated, cohesive UX
- one-time-purchase product direction
- native plugin system designed around permissions
- configurable Commands workflow
- user-controlled AI provider credentials/models

The product should compete through coherence and focus rather than through feature-count parity.

---

## 35. Security and privacy philosophy

Because Corant is local-first, the application should minimize unnecessary transmission of project data.

The core app should not require a hosted database to manage a project.

Plugins are a special security concern because they may need elevated capabilities. The plugin system therefore needs explicit permissions rather than universal unrestricted access.

For AI functionality, the native Copilot plugin is intended to use credentials supplied by the user for the chosen provider rather than requiring a Corant-owned AI backend.

---

## 36. UX quality bar

Corant should feel intentional at every layer.

Quality expectations established during development:

- no fake controls that look functional but do nothing once their phase is reached
- avoid unnecessary modal dialogs when a direct workspace interaction is better
- use native dialogs where they improve OS integration
- keep destructive actions confirmable
- make saving/recovery state visible without being distracting
- maintain consistent spacing, typography, borders, hover states and focus states
- do not let technical architecture leak into the user experience

---

## 37. Working conventions for future implementation

When extending the project:

1. Inspect the current GitHub state before modifying a file.
2. Preserve existing working behavior.
3. Prefer incremental feature work.
4. Keep native filesystem behavior in the service/Rust layer rather than implementing fragile browser-only workarounds.
5. Keep React UI state coherent and centralized in the workspace where appropriate.
6. Avoid introducing dependencies unless they solve a real requirement.
7. Test TypeScript/build and Tauri compilation after substantial native changes.
8. Do not claim a feature is implemented until it has been added to the repository and, where possible, verified by running it.

---

## 38. Known current source-of-truth files

As of the current implementation snapshot, the following files are particularly important:

- `src/app/App.tsx`
- `src/components/editor/Workspace.tsx`
- `src/components/editor/ExplorerNameDialog.tsx`
- `src/components/editor/monaco/MonacoEditor.tsx`
- `src/components/layout/WelcomeScreen.tsx`
- `src/components/projects/CreateProjectDialog.tsx`
- `src/services/projectFilesystem.ts`
- `src/styles/app.css`
- `src/styles/index.css`
- `src/main.tsx`
- `vite.config.ts`
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`
- `public/corant-dye.svg`

This list is a working map rather than a guarantee that no other files matter.

---

## 39. Current implementation status summary

| Area | Status |
|---|---|
| Welcome screen | Current |
| Create project | Current |
| Open project | Current |
| Real filesystem project scope | Current |
| Explorer tree | Current |
| Create file | Current |
| Create folder | Current |
| Rename | Current |
| Delete | Current |
| Expand/collapse | Current |
| Monaco editor | Current |
| Basic language detection | Current |
| Initial autosave | Current |
| Robust recovery | Initial implementation current; further improvements planned |
| Multi-tab editor | Current |
| Dirty-tab protection | Current |
| Global filename search | Current |
| Project content search | Current |
| Functional menus | Next |
| Integrated terminal | Planned |
| Image editor | Planned |
| Import/export archives | Planned |
| Drag-and-drop import | Planned |
| File previews | Planned |
| Workspace settings | Planned |
| History/versioning | Planned |
| Custom shortcuts | Planned |
| Plugin framework | Planned |
| Copilot plugin | Planned |
| Good Vibes plugin | Planned |
| Commands plugin | Planned |
| Git integration | Community plugin direction |

---

## 40. Definition of success for the initial Corant foundation

Before treating the core workspace as mature, a user should be able to:

1. Open or create a local project.
2. Browse its real filesystem through the Explorer.
3. Create, rename and delete files/folders.
4. Open multiple files in tabs.
5. Edit files through Monaco.
6. See which files are modified.
7. Avoid accidental loss of changes.
8. Recover changes after an unexpected shutdown.
9. Search the project.
10. Use functional menus.
11. Open one integrated terminal in the project directory.
12. Then, and only then, extend the workspace through the plugin system.

---

## 41. Specification status

This file is a **living specification**, not a frozen contract.

When a future design decision changes an established product requirement, this document should be updated so that it remains the project's central high-level reference.

The repository implementation is always the final source of truth for what is actually implemented; this document is the source of truth for the accumulated product intent and agreed roadmap.
