import { test, expect } from "@playwright/test";
import { createFileSaveQueue } from "../src/services/fileSaveQueue";

test("serializes autosave and manual writes to the same file", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const writes: string[] = [];
  const queue = createFileSaveQueue(async (_path, content) => {
    if (content === "old") await blocked;
    writes.push(content);
  });
  const old = queue.save("a.txt", "old");
  const latest = queue.save("a.txt", "latest");
  await queue.save("b.txt", "independent");
  expect(writes).toEqual(["independent"]);
  release();
  await Promise.all([old, latest]);
  expect(writes).toEqual(["independent", "old", "latest"]);
});

test("a failed write does not block retrying the file", async () => {
  const writes: string[] = [];
  const queue = createFileSaveQueue(async (_path, content) => {
    if (content === "fail") throw new Error("Disk unavailable");
    writes.push(content);
  });
  await expect(queue.save("a.txt", "fail")).rejects.toThrow("Disk unavailable");
  await queue.save("a.txt", "recovered");
  expect(writes).toEqual(["recovered"]);
});
