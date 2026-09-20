import { test, expect } from "@playwright/test";

test("file and folder recovery migrations persist across reload without orphan paths", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const store = await import("/src/services/recoveryStore.ts");
    store.saveRecoverySnapshot("project", "C:\\project\\folder\\a.txt", "unsaved");
    store.saveRecoverySnapshot("project", "C:\\project\\folder\\nested\\b.txt", "nested");
    store.saveRecoverySnapshot("project", "C:\\project\\folder-other\\keep.txt", "keep");
    store.saveRecoverySnapshot("other-project", "C:\\project\\folder\\a.txt", "other");
    store.moveRecoverySnapshotsForPath("project", "C:\\project\\folder\\a.txt", "C:\\project\\folder\\renamed.txt");
    store.moveRecoverySnapshotsForPath("project", "C:\\project\\folder", "C:\\project\\new-folder", true);
  });
  await page.reload();
  const snapshots = await page.evaluate(() => JSON.parse(localStorage.getItem("corant.recovery.v1")!));
  expect(snapshots.filter((item: any) => item.projectPath === "project").map((item: any) => item.filePath).sort()).toEqual([
    "C:\\project\\folder-other\\keep.txt", "C:\\project\\new-folder\\nested\\b.txt", "C:\\project\\new-folder\\renamed.txt",
  ]);
  expect(snapshots.find((item: any) => item.filePath.endsWith("renamed.txt")).content).toBe("unsaved");
  await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const store = await import("/src/services/recoveryStore.ts");
    store.clearRecoverySnapshotsForPath("project", "C:\\project\\new-folder", true);
  });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("corant.recovery.v1")!).length)).toBe(2);
});
