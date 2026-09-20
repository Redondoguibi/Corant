import { readProjectFile, type ProjectFile } from "./projectFilesystem";

export type ProjectSearchContentMatch = {
  file: ProjectFile;
  lineNumber: number;
  column: number;
  lineText: string;
};

export type ProjectContentSearchResult = {
  matches: ProjectSearchContentMatch[];
  searchedFiles: number;
  skippedFiles: number;
  truncated: boolean;
};

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  "coverage",
]);

const BINARY_EXTENSIONS = new Set([
  "7z",
  "avi",
  "bin",
  "bmp",
  "class",
  "db",
  "dll",
  "dylib",
  "eot",
  "exe",
  "gif",
  "gz",
  "ico",
  "icns",
  "jar",
  "jpeg",
  "jpg",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "otf",
  "pdf",
  "png",
  "rar",
  "so",
  "sqlite",
  "tar",
  "tif",
  "tiff",
  "ttf",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xz",
  "zip",
]);

const MAX_NAME_RESULTS = 120;
const MAX_CONTENT_RESULTS = 500;
const MAX_RESULTS_PER_FILE = 100;
const YIELD_EVERY_FILES = 12;
const YIELD_EVERY_LINES = 2000;

function normalizeQuery(query: string) {
  return query.trim().toLocaleLowerCase();
}

function isInsideIgnoredDirectory(relativePath: string) {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  const directories = parts.slice(0, -1);
  return directories.some((part) => IGNORED_DIRECTORY_NAMES.has(part));
}

function isSearchableTextFile(file: ProjectFile) {
  if (file.kind !== "file" || isInsideIgnoredDirectory(file.relativePath)) {
    return false;
  }

  const extension = file.name.includes(".")
    ? file.name.split(".").pop()?.toLocaleLowerCase() ?? ""
    : "";

  return !BINARY_EXTENSIONS.has(extension);
}

function createLinePreview(line: string, matchIndex: number, queryLength: number) {
  const maxLength = 220;

  if (line.length <= maxLength) {
    return line;
  }

  const preferredStart = Math.max(0, matchIndex - 72);
  let start = preferredStart;
  let end = Math.min(line.length, start + maxLength);

  if (end === line.length) {
    start = Math.max(0, end - maxLength);
  }

  end = Math.min(line.length, Math.max(end, matchIndex + queryLength + 40));

  const text = line.slice(start, end);
  return `${start > 0 ? "…" : ""}${text}${end < line.length ? "…" : ""}`;
}

export function searchProjectEntriesByName(entries: ProjectFile[], query: string) {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  return entries
    .filter((entry) => !isInsideIgnoredDirectory(entry.relativePath))
    .filter((entry) =>
      entry.name.toLocaleLowerCase().includes(normalizedQuery)
      || entry.relativePath.toLocaleLowerCase().includes(normalizedQuery),
    )
    .slice(0, MAX_NAME_RESULTS);
}

export async function searchProjectContents(
  files: ProjectFile[],
  query: string,
  contentOverrides: Record<string, { content: string }>,
  isCancelled: () => boolean,
): Promise<ProjectContentSearchResult> {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return {
      matches: [],
      searchedFiles: 0,
      skippedFiles: 0,
      truncated: false,
    };
  }

  const searchableFiles = files.filter(isSearchableTextFile);
  const matches: ProjectSearchContentMatch[] = [];
  let searchedFiles = 0;
  let skippedFiles = files.length - searchableFiles.length;
  let truncated = false;

  for (let fileIndex = 0; fileIndex < searchableFiles.length; fileIndex += 1) {
    if (isCancelled()) {
      break;
    }

    const file = searchableFiles[fileIndex];
    let content: string;

    try {
      content = contentOverrides[file.path]?.content ?? await readProjectFile(file.path);
      searchedFiles += 1;
    } catch {
      skippedFiles += 1;
      continue;
    }

    const lines = content.split(/\r?\n/);
    let matchesInFile = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const matchIndex = line.toLocaleLowerCase().indexOf(normalizedQuery);

      if ((lineIndex + 1) % YIELD_EVERY_LINES === 0) {
        if (isCancelled()) {
          return {
            matches,
            searchedFiles,
            skippedFiles,
            truncated,
          };
        }

        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }

      if (matchIndex < 0) {
        continue;
      }

      matches.push({
        file,
        lineNumber: lineIndex + 1,
        column: matchIndex + 1,
        lineText: createLinePreview(line, matchIndex, normalizedQuery.length),
      });

      matchesInFile += 1;

      if (matches.length >= MAX_CONTENT_RESULTS) {
        return {
          matches,
          searchedFiles,
          skippedFiles,
          truncated: true,
        };
      }

      if (matchesInFile >= MAX_RESULTS_PER_FILE) {
        truncated = true;
        break;
      }
    }

    if ((fileIndex + 1) % YIELD_EVERY_FILES === 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  return {
    matches,
    searchedFiles,
    skippedFiles,
    truncated,
  };
}
