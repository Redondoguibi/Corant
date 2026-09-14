import {
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

type NativeEntry = {
  name?: string;
  isDirectory?: boolean;
  isFile?: boolean;
  isSymlink?: boolean;
};

export type ProjectFile = {
  path: string;
  relativePath: string;
  name: string;
  kind: "file" | "directory";
};

function joinPath(parent: string, child: string) {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]$/, "")}${separator}${child}`;
}

function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, "/");
}

function validateEntryName(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName || trimmedName === "." || trimmedName === "..") {
    throw new Error("O nome não pode estar vazio ou ser . ou ...");
  }

  if (trimmedName.includes("/") || trimmedName.includes("\\")) {
    throw new Error("O nome deve representar apenas um arquivo ou pasta.");
  }

  if (["<", ">", ":", '"', "|", "?", "*"].some((character) => trimmedName.includes(character))) {
    throw new Error("O nome contém caracteres inválidos para o Windows.");
  }

  return trimmedName;
}

async function collectEntries(
  directoryPath: string,
  relativePath = "",
): Promise<ProjectFile[]> {
  const entries = await readDir(directoryPath);
  const files: ProjectFile[] = [];

  const sortedEntries = [...entries].sort((a, b) => {
    const aDirectory = Boolean(a.isDirectory);
    const bDirectory = Boolean(b.isDirectory);

    if (aDirectory !== bDirectory) {
      return aDirectory ? -1 : 1;
    }

    return (a.name ?? "").localeCompare(b.name ?? "", undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  for (const entry of sortedEntries as NativeEntry[]) {
    if (!entry.name || entry.isSymlink) {
      continue;
    }

    const entryPath = joinPath(directoryPath, entry.name);
    const entryRelativePath = relativePath
      ? `${normalizeRelativePath(relativePath)}/${entry.name}`
      : entry.name;

    if (entry.isDirectory) {
      files.push({
        path: entryPath,
        relativePath: entryRelativePath,
        name: entry.name,
        kind: "directory",
      });

      files.push(...(await collectEntries(entryPath, entryRelativePath)));
      continue;
    }

    if (entry.isFile) {
      files.push({
        path: entryPath,
        relativePath: entryRelativePath,
        name: entry.name,
        kind: "file",
      });
    }
  }

  return files;
}

export async function listProjectEntries(projectPath: string) {
  return collectEntries(projectPath);
}

export async function readProjectFile(filePath: string) {
  return readTextFile(filePath);
}

export async function saveProjectFile(filePath: string, content: string) {
  await writeTextFile(filePath, content);
}

export async function createProjectFile(directoryPath: string, name: string) {
  const validName = validateEntryName(name);
  const filePath = joinPath(directoryPath, validName);
  await writeTextFile(filePath, "", { createNew: true });
  return filePath;
}

export async function createProjectDirectory(directoryPath: string, name: string) {
  const validName = validateEntryName(name);
  const newDirectoryPath = joinPath(directoryPath, validName);
  await mkdir(newDirectoryPath, { recursive: false });
  return newDirectoryPath;
}

export async function renameProjectEntry(entryPath: string, newName: string) {
  const validName = validateEntryName(newName);
  const separator = entryPath.includes("\\") ? "\\" : "/";
  const parentPath = entryPath.slice(0, entryPath.lastIndexOf(separator));
  const newPath = joinPath(parentPath, validName);

  if (newPath !== entryPath) {
    await rename(entryPath, newPath);
  }

  return newPath;
}

export async function deleteProjectEntry(entry: ProjectFile) {
  await remove(entry.path, { recursive: entry.kind === "directory" });
}
