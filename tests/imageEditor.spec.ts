import { test, expect, type Page } from "@playwright/test";
import { setupWorkspace } from "./workspaceTestSetup";
async function openImage(page: Page, name = "photo.png") {
  await page.locator(".tree-file").filter({ hasText: name }).click();
  await page
    .getByRole("button", { name: "Editar imagem", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: `Editor de ${name}` }),
  ).toBeVisible();
}
async function draw(page: Page, tool = "Retângulo") {
  await page.getByRole("button", { name: tool, exact: true }).click();
  const bounds = (await page
    .getByLabel("Área de desenho", { exact: true })
    .boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.15,
    bounds.y + bounds.height * 0.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height * 0.7,
    { steps: 5 },
  );
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  await setupWorkspace(page);
  await page.evaluate(async () => {
    const state = (window as any).testState;
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 200, 100);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!)),
    );
    state.imageBytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    state.files["/project/photo.png"] = "image";
    state.files["/project/multi.tiff"] = "tiff";
    state.imageExports = [];
    state.tiffReads = [];
    const internals = (window as any).__TAURI_INTERNALS__,
      invoke = internals.invoke;
    internals.invoke = async (command: string, args: any, options: any) => {
      if (command === "plugin:fs|stat")
        return { isFile: true, size: state.imageBytes.length };
      if (command === "plugin:fs|read_file") return state.imageBytes;
      if (command === "image_read_tiff") {
        state.tiffReads.push(args);
        return state.imageBytes;
      }
      if (command === "image_export") {
        if (state.holdImageExport) await new Promise<void>(resolve => { state.finishImageExport = resolve; });
        if (state.failImageExport) throw new Error("Disk unavailable");
        const path = args.projectPath + "/" + args.name;
        if (path in state.files) throw new Error("O nome já existe");
        state.imageExports.push(args);
        state.files[path] = "image";
        return;
      }
      return invoke(command, args, options);
    };
  });
  await page
    .getByRole("button", { name: "Atualizar projeto", exact: true })
    .click();
});
test("layers, undo and redo preserve edits across tabs and closing requires consent", async ({
  page,
}, info) => {
  await openImage(page);
  await draw(page);
  await expect(page.getByLabel("Nome da camada")).toHaveValue("Retângulo");
  await expect(
    page.getByText("Edições não exportadas", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "↶ Desfazer", exact: true }).click();
  await expect(page.getByLabel("Nome da camada")).toHaveCount(0);
  await page.getByRole("button", { name: "↷ Refazer", exact: true }).click();
  await expect(page.getByLabel("Nome da camada")).toHaveValue("Retângulo");
  await page.getByRole("tab", { name: "a.txt" }).click();
  await page.getByRole("tab", { name: "photo.png" }).click();
  await expect(page.locator(".image-layers")).toContainText("Retângulo");
  await page.screenshot({ path: info.outputPath("image-studio.png") });
  await page.evaluate(() => {
    (window as any).testState.confirmed = false;
  });
  await page
    .getByRole("button", { name: "Fechar photo.png", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "photo.png" })).toBeVisible();
  await page.evaluate(() => {
    (window as any).testState.confirmed = true;
  });
  await page
    .getByRole("button", { name: "Fechar photo.png", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "photo.png" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as any).testState.files["/project/photo.png"],
    ),
  ).toBe("image");
});
test("exports rendered pixels without overwriting originals and retains edits after errors", async ({
  page,
}) => {
  await openImage(page);
  await draw(page);
  await page.evaluate(() => {
    (window as any).testState.failImageExport = true;
  });
  await page
    .getByRole("button", { name: "Exportar imagem", exact: true })
    .click();
  await expect(page.locator(".image-editor-message")).toContainText(
    "Disk unavailable",
  );
  await page.evaluate(() => {
    (window as any).testState.failImageExport = false;
  });
  await page
    .getByRole("button", { name: "Exportar imagem", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).testState.imageExports.length),
    )
    .toBe(1);
  const pixel = await page.evaluate(async () => {
    const state = (window as any).testState;
    const image = await createImageBitmap(
      new Blob([new Uint8Array(state.imageExports[0].data)], {
        type: "image/png",
      }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    image.close();
    return Array.from(ctx.getImageData(50, 40, 1, 1).data);
  });
  expect(pixel).toEqual([244, 63, 94, 255]);
  await expect(page.locator(".image-editor-header")).toContainText("Pronto");
  await page
    .getByRole("button", { name: "Exportar imagem", exact: true })
    .click();
  await expect(page.locator(".image-editor-message")).toContainText(
    "já existe",
  );
  expect(await page.evaluate(() => (window as any).testState.writes)).toEqual(
    [],
  );
});
test("crop, rotate and resize alter dimensions and are undoable", async ({
  page,
}) => {
  await openImage(page);
  await draw(page, "Recortar");
  await page
    .getByRole("button", { name: "Aplicar recorte", exact: true })
    .click();
  await expect(page.locator(".image-editor-header")).toContainText(
    "110 × 50 px",
  );
  await page.locator("summary").filter({ hasText: "Transformar" }).click();
  await page.getByRole("button", { name: "↷ 90°", exact: true }).click();
  await expect(page.locator(".image-editor-header")).toContainText(
    "50 × 110 px",
  );
  await page.getByLabel("Largura", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Redimensionar", exact: true })
    .click();
  await expect(page.locator(".image-editor-header")).toContainText(
    "100 × 220 px",
  );
  await page.getByRole("button", { name: "↶ Desfazer", exact: true }).click();
  await expect(page.locator(".image-editor-header")).toContainText(
    "50 × 110 px",
  );
});
test("TIFF preview and editor use native conversion and TIFF export", async ({
  page,
}) => {
  await openImage(page, "multi.tiff");
  await expect
    .poll(() => page.evaluate(() => (window as any).testState.tiffReads.length))
    .toBeGreaterThan(0);
  await page.getByLabel("Formato", { exact: true }).selectOption("tiff");
  await page
    .getByRole("button", { name: "Exportar imagem", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).testState.imageExports.length),
    )
    .toBe(1);
  expect(
    await page.evaluate(() => (window as any).testState.imageExports[0].name),
  ).toBe("multi-editada.tiff");
});
test("image engine validates dimensions and transforms exact pixels", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const {
      makeCanvas,
      context,
      flatten,
      transform,
      crop,
      renderDocument,
      ImageSessions,
    } = await import("/src/services/imageEditor.ts");
    const base = makeCanvas(2, 1),
      ctx = context(base);
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = "blue";
    ctx.fillRect(1, 0, 1, 1);
    const original = flatten(base),
      rotated = transform(original, "right"),
      clipped = crop(rotated, { x: 0, y: 1, w: 1, h: 1 });
    const color = Array.from(
      context(renderDocument(clipped)).getImageData(0, 0, 1, 1).data,
    );
    let rejected = false;
    try {
      makeCanvas(20000, 20000);
    } catch {
      rejected = true;
    }
    const sessions = new ImageSessions();
    sessions.set("/a", original);
    sessions.commit("/a", rotated);
    sessions.rename((p: string) => p + ".png");
    sessions.undo("/a.png", -1);
    return {
      color,
      rejected,
      dirty: sessions.dirty("/a.png"),
      width: rotated.base.width,
      height: rotated.base.height,
    };
  });
  expect(result).toEqual({
    color: [0, 0, 255, 255],
    rejected: true,
    dirty: false,
    width: 1,
    height: 2,
  });
});

test("eraser exports transparency and an in-flight export prevents closing", async ({page}) => {
  await openImage(page);
  await page.getByLabel("Espessura", {exact:true}).fill("20");
  await draw(page,"Borracha");
  const alpha = await page.getByLabel("Imagem editada", {exact:true}).evaluate((canvas: HTMLCanvasElement) => canvas.getContext("2d")!.getImageData(85,45,1,1).data[3]);
  expect(alpha).toBe(0);
  await page.evaluate(()=>{(window as any).testState.holdImageExport=true;});
  await page.getByRole("button",{name:"Exportar imagem",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testState.finishImageExport))).toBe(true);
  await page.getByRole("button",{name:"Fechar photo.png",exact:true}).click();
  await expect(page.getByRole("tab",{name:"photo.png"})).toBeVisible();
  await expect(page.locator(".workspace-error-banner")).toContainText("Aguarde a exportação");
  await page.evaluate(()=>{(window as any).testState.finishImageExport();});
  await expect.poll(()=>page.evaluate(()=>(window as any).testState.imageExports.length)).toBe(1);
  await page.getByRole("button",{name:"Fechar photo.png",exact:true}).click();
  await expect(page.getByRole("tab",{name:"photo.png"})).toHaveCount(0);
});
