/** Serialize writes per file so a slow autosave cannot overwrite a manual save. */
export function createFileSaveQueue(write: (path: string, content: string) => Promise<void>) {
  const pending = new Map<string, Promise<void>>();
  return {
    isPending(path: string) { return pending.has(path); },
    save(path: string, content: string) {
      const operation = (pending.get(path) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => write(path, content));
      pending.set(path, operation);
      const cleanup = () => { if (pending.get(path) === operation) pending.delete(path); };
      void operation.then(cleanup, cleanup);
      return operation;
    },
  };
}
