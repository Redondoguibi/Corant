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

test("a directory mutation drains accepted writes, blocks new ones and releases its lock on failure", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  const queue = createFileSaveQueue(async (path) => { await gate; order.push(path); });
  const write = queue.save("/folder/a.txt", "content");
  const mutation = queue.withPathsLocked((path) => path.startsWith("/folder/"), async () => {
    order.push("mutation");
    throw new Error("rename failed");
  });
  const rejection = expect(mutation).rejects.toThrow("rename failed");
  await expect(queue.save("/folder/b.txt", "content")).rejects.toThrow("filesystem");
  expect(order).toEqual([]);
  release();
  await write;
  await rejection;
  expect(order).toEqual(["/folder/a.txt", "mutation"]);
  await queue.save("/folder/b.txt", "retry");
  expect(queue.isBlocked("/folder/b.txt")).toBe(false);
});
