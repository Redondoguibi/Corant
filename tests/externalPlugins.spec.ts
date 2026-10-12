import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";
async function manage(page: Page) {
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "Executar", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Gerenciar plugins…", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Plugins externos" }),
  ).toBeVisible();
}
async function closeProject(page: Page) {
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "Arquivo", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Fechar projeto", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Abrir projeto", exact: true }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await setupWorkspace(page);
  await page.evaluate(() => {
    const state = (window as any).testState;
    state.external = {
      manifest: {
        id: "demo.tools",
        name: "Ferramentas externas",
        version: "1.0.0",
        apiVersion: 1,
        permissions: [
          "commands.register",
          "editor.read",
          "editor.write",
          "ui.panel",
        ],
        commands: [
          { id: "demo.tools.upper", title: "Plugin externo: maiúsculas" },
        ],
        entrypoint: "index.js",
      },
      fingerprint: "a".repeat(64),
      error: null,
      folder: "demo.tools",
    };
    state.externalInstalled = true;
    state.externalLoads = 0;
    state.externalRemovals = 0;
    state.externalInstalls = [];
    state.externalSource = `window.externalTopLevel=(window.externalTopLevel||0)+1;
      export function activate(api,{React}){
        window.externalApi=api;
        api.subscriptions.add({dispose(){window.externalDisposed=(window.externalDisposed||0)+1;}});
        api.ui.registerPanel({title:'Painel externo',render:()=>React.createElement('p',null,'Plugin externo carregado')});
        api.commands.register('demo.tools.upper',()=>{const d=api.editor.getActiveDocument();api.editor.replaceActiveDocument({documentId:d.id,expectedVersion:d.version,text:d.text.toUpperCase()});api.ui.openPanel();});
      }
      export function deactivate(){window.externalDeactivated=(window.externalDeactivated||0)+1;}`;
    const internals = (window as any).__TAURI_INTERNALS__,
      invoke = internals.invoke;
    internals.invoke = async (command: string, args: any, options: any) => {
      if (command === "external_plugins_list")
        return {
          directory: "/app/plugins",
          plugins: state.externalInstalled
            ? [structuredClone(state.external)]
            : [],
        };
      if (command === "external_plugins_load") {
        state.externalLoads++;
        if (state.holdExternal)
          await new Promise<void>((resolve) => {
            state.releaseExternal = resolve;
          });
        if (args.fingerprint !== state.external.fingerprint)
          throw new Error("O plugin mudou");
        return {
          manifest: structuredClone(state.external.manifest),
          source: state.externalSource,
          fingerprint: state.external.fingerprint,
        };
      }
      if (command === "external_plugins_remove") {
        state.externalInstalled = false;
        state.externalRemovals++;
        return;
      }
      if (command === "external_plugins_install") {
        state.externalInstalled = true;
        state.externalInstalls.push(args.source);
        return "demo.tools";
      }
      return invoke(command, args, options);
    };
  });
  await manage(page);
  await page
    .getByRole("button", { name: "Atualizar plugins", exact: true })
    .click();
});
test("discovery does not execute code; approval activates through the host; disable removes resources", async ({
  page,
}) => {
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).testState.externalLoads),
  ).toBe(0);
  await page.evaluate(() => {
    (window as any).testState.confirmed = false;
  });
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).externalTopLevel),
  ).toBeUndefined();
  await page.evaluate(() => {
    (window as any).testState.confirmed = true;
  });
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText("Ativo", { exact: true })).toBeVisible();
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "Executar", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Plugin externo: maiúsculas", exact: true })
    .click();
  await expect(
    page.getByText("Plugin externo carregado", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).testState.files["/project/a.txt"]),
    )
    .toBe("ALPHA\nBETA");
  await manage(page);
  await page.getByRole("button", { name: "Desativar", exact: true }).click();
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).externalDisposed)).toBe(1);
  expect(await page.evaluate(() => (window as any).externalDeactivated)).toBe(
    1,
  );
  expect(
    await page.evaluate(() => {
      try {
        (window as any).externalApi.editor.getActiveDocument();
        return "active";
      } catch (e: any) {
        return e.code;
      }
    }),
  ).toBe("PLUGIN_INACTIVE");
});
test("approved unchanged plugins reactivate after reopening; changed source requires new approval", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText("Ativo", { exact: true })).toBeVisible();
  await closeProject(page);
  await page
    .getByRole("button", { name: "Abrir projeto", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).externalTopLevel))
    .toBe(2);
  await manage(page);
  await page.evaluate(() => {
    (window as any).testState.external.fingerprint = "b".repeat(64);
  });
  await page
    .getByRole("button", { name: "Atualizar plugins", exact: true })
    .click();
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).externalTopLevel)).toBe(2);
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText("Ativo", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).externalTopLevel)).toBe(3);
});
test("install and remove manage the package independently of the source folder", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(
    page.getByText("Nenhum plugin externo instalado."),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).testState.projectPicker = "/packages/demo";
  });
  await page
    .getByRole("button", { name: "Instalar plugin…", exact: true })
    .click();
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).testState.externalInstalls),
  ).toEqual(["/packages/demo"]);
  expect(
    await page.evaluate(() => (window as any).externalTopLevel),
  ).toBeUndefined();
});
test("invalid and incompatible manifests never import code", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).testState.external.manifest.apiVersion = 999;
  });
  await page
    .getByRole("button", { name: "Atualizar plugins", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Ativar", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".external-plugin-card").getByRole("alert"),
  ).toContainText("incompatível");
  expect(
    await page.evaluate(() => (window as any).testState.externalLoads),
  ).toBe(0);
});
test("activation failures clean registered commands and disposal ignores a late module load", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).testState.externalSource =
      "export function activate(api){api.commands.register('demo.tools.upper',()=>{});throw new Error('broken');}";
  });
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(
    page.locator(".external-plugins").getByRole("alert"),
  ).toBeVisible();
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "Executar", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", {
      name: "Plugin externo: maiúsculas",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as any).testState.holdExternal = true;
  });
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as any).testState.releaseExternal)),
    )
    .toBe(true);
  await closeProject(page);
  await page.evaluate(() => {
    (window as any).testState.releaseExternal();
  });
  await expect(
    page.getByRole("button", { name: "Abrir projeto", exact: true }),
  ).toBeVisible();
});

test("a broken external panel is contained without taking down the workspace", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).testState.externalSource =
      "export function activate(api){api.ui.registerPanel({title:'Broken panel',render(){throw new Error('render failed');}});api.commands.register('demo.tools.upper',()=>api.ui.openPanel());}";
  });
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText("Ativo", { exact: true })).toBeVisible();
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "Executar", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Plugin externo: maiúsculas", exact: true })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "Broken panel" })
      .getByRole("alert"),
  ).toContainText("O painel deste plugin falhou");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await manage(page);
  await page.getByRole("button", { name: "Desativar", exact: true }).click();
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
});
