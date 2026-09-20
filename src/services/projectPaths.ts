function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase() : normalized;
}

export function affectsProjectPath(path: string, target: string, directory = false) {
  const candidate = normalizePath(path);
  const root = normalizePath(target);
  return candidate === root || (directory && candidate.startsWith(`${root}/`));
}

export function remapProjectPath(path: string, oldPath: string, newPath: string, directory = false) {
  return affectsProjectPath(path, oldPath, directory) ? newPath + path.slice(oldPath.length) : path;
}
