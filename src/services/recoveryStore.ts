import { affectsProjectPath, remapProjectPath } from "./projectPaths";

const STORAGE_KEY = "corant.recovery.v1";

type RecoverySnapshot = {
  projectPath: string;
  filePath: string;
  content: string;
  updatedAt: number;
};

function readSnapshots(): RecoverySnapshot[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is RecoverySnapshot => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return typeof value.projectPath === "string"
        && typeof value.filePath === "string"
        && typeof value.content === "string"
        && typeof value.updatedAt === "number";
    });
  } catch {
    return [];
  }
}

function writeSnapshots(snapshots: RecoverySnapshot[]) {
  try {
    if (snapshots.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // Recovery must never prevent the editor from continuing to work.
  }
}

export function saveRecoverySnapshot(projectPath: string, filePath: string, content: string) {
  const snapshots = readSnapshots().filter(
    (snapshot) => !(snapshot.projectPath === projectPath && snapshot.filePath === filePath),
  );

  snapshots.push({
    projectPath,
    filePath,
    content,
    updatedAt: Date.now(),
  });

  writeSnapshots(snapshots);
}

export function getRecoverySnapshot(projectPath: string, filePath: string) {
  return readSnapshots().find(
    (snapshot) => snapshot.projectPath === projectPath && snapshot.filePath === filePath,
  ) ?? null;
}

export function clearRecoverySnapshot(projectPath: string, filePath: string) {
  writeSnapshots(
    readSnapshots().filter(
      (snapshot) => !(snapshot.projectPath === projectPath && snapshot.filePath === filePath),
    ),
  );
}

export function clearProjectRecoverySnapshots(projectPath: string) {
  writeSnapshots(readSnapshots().filter((snapshot) => snapshot.projectPath !== projectPath));
}

export function moveRecoverySnapshotsForPath(projectPath: string, oldPath: string, newPath: string, directory = false) {
  if (oldPath === newPath) return;
  const snapshots = readSnapshots();
  const moved = snapshots.filter((snapshot) => snapshot.projectPath === projectPath && affectsProjectPath(snapshot.filePath, oldPath, directory))
    .map((snapshot) => ({ ...snapshot, filePath: remapProjectPath(snapshot.filePath, oldPath, newPath, directory) }));
  // One storage write preserves timestamps and replaces any stale destination snapshot.
  writeSnapshots([
    ...snapshots.filter((snapshot) => snapshot.projectPath !== projectPath || (
      !affectsProjectPath(snapshot.filePath, oldPath, directory) && !moved.some((item) => item.filePath === snapshot.filePath)
    )),
    ...moved,
  ]);
}

export function clearRecoverySnapshotsForPath(projectPath: string, path: string, directory = false) {
  writeSnapshots(readSnapshots().filter((snapshot) =>
    snapshot.projectPath !== projectPath || !affectsProjectPath(snapshot.filePath, path, directory),
  ));
}
