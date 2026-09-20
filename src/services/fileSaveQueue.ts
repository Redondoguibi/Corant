/** Serialize writes per file so a slow autosave cannot overwrite a manual save. */
export function createFileSaveQueue(write: (path: string, content: string) => Promise<void>) {
  const pending = new Map<string, Promise<void>>();
  const locks = new Set<(path: string) => boolean>();
  const isBlocked = (path: string) => [...locks].some((matches) => matches(path));
  return {
    isBlocked,
    isPending(path: string) { return pending.has(path); },
    async withPathsLocked<T>(matches: (path: string) => boolean, operation: () => Promise<T>): Promise<T> {
      // Acquire synchronously, then drain every previously accepted write (including failures).
      locks.add(matches);
      try {
        await Promise.allSettled([...pending].filter(([path]) => matches(path)).map(([, write]) => write));
        return await operation();
      } finally { locks.delete(matches); }
    },
    save(path: string, content: string) {
      if (isBlocked(path)) return Promise.reject(new Error("Arquivo em alteração no filesystem."));
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
