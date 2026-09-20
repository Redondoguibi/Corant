import { useEffect, useMemo, useRef, useState } from "react";
import {
  searchProjectContents,
  searchProjectEntriesByName,
  type ProjectContentSearchResult,
  type ProjectSearchContentMatch,
} from "../../services/projectSearch";
import type { ProjectFile } from "../../services/projectFilesystem";

type GlobalSearchPanelProps = {
  entries: ProjectFile[];
  contentOverrides: Record<string, { content: string }>;
  onOpenEntry: (entry: ProjectFile) => void;
  onOpenMatch: (file: ProjectFile, lineNumber: number, column: number) => void;
};

type ContentGroup = {
  file: ProjectFile;
  matches: ProjectSearchContentMatch[];
};

const EMPTY_CONTENT_RESULT: ProjectContentSearchResult = {
  matches: [],
  searchedFiles: 0,
  skippedFiles: 0,
  truncated: false,
};

export function GlobalSearchPanel({
  entries,
  contentOverrides,
  onOpenEntry,
  onOpenMatch,
}: GlobalSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [contentResult, setContentResult] = useState<ProjectContentSearchResult>(EMPTY_CONTENT_RESULT);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRunRef = useRef(0);

  const files = useMemo(
    () => entries.filter((entry) => entry.kind === "file"),
    [entries],
  );

  const nameResults = useMemo(
    () => searchProjectEntriesByName(entries, query),
    [entries, query],
  );

  const contentGroups = useMemo(() => {
    const groups = new Map<string, ContentGroup>();

    for (const match of contentResult.matches) {
      const current = groups.get(match.file.path);

      if (current) {
        current.matches.push(match);
      } else {
        groups.set(match.file.path, {
          file: match.file,
          matches: [match],
        });
      }
    }

    return [...groups.values()];
  }, [contentResult.matches]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;

    if (!trimmedQuery) {
      setContentResult(EMPTY_CONTENT_RESULT);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);

      void searchProjectContents(
        files,
        trimmedQuery,
        contentOverrides,
        () => searchRunRef.current !== runId,
      )
        .then((result) => {
          if (searchRunRef.current !== runId) return;
          setContentResult(result);
        })
        .catch((error) => {
          if (searchRunRef.current !== runId) return;
          setSearchError(error instanceof Error ? error.message : String(error));
          setContentResult(EMPTY_CONTENT_RESULT);
        })
        .finally(() => {
          if (searchRunRef.current === runId) {
            setIsSearching(false);
          }
        });
    }, 240);

    return () => {
      window.clearTimeout(timer);
      if (searchRunRef.current === runId) {
        searchRunRef.current += 1;
      }
    };
  }, [contentOverrides, files, query]);

  const hasQuery = query.trim().length > 0;
  const hasResults = nameResults.length > 0 || contentResult.matches.length > 0;

  return (
    <div className="global-search-panel">
      <div className="global-search-controls">
        <div className="global-search-input-row">
          <span className="global-search-input-icon" aria-hidden="true">⌕</span>
          <input
            className="global-search-input"
            type="search"
            value={query}
            autoFocus
            spellCheck={false}
            placeholder="Buscar no projeto"
            aria-label="Buscar nomes e conteúdo no projeto"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="global-search-clear"
              type="button"
              aria-label="Limpar busca"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </div>

        <div className="global-search-summary" aria-live="polite">
          {!hasQuery && "Busque arquivos, pastas ou conteúdo"}
          {hasQuery && isSearching && "Buscando conteúdo…"}
          {hasQuery && !isSearching && !searchError && (
            <>
              {nameResults.length} por nome · {contentResult.matches.length} no conteúdo
            </>
          )}
          {searchError && "Não foi possível concluir a busca"}
        </div>
      </div>

      <div className="global-search-results">
        {!hasQuery && (
          <div className="global-search-empty">
            <strong>Busca global</strong>
            <span>Os resultados aparecem por nome e por conteúdo sem precisar expandir o Explorer.</span>
          </div>
        )}

        {hasQuery && nameResults.length > 0 && (
          <section className="search-section" aria-label="Resultados por nome">
            <div className="search-section-title">
              <span>NOMES</span>
              <span>{nameResults.length}</span>
            </div>

            <div className="search-name-results">
              {nameResults.map((entry) => (
                <button
                  className="search-name-result"
                  type="button"
                  key={entry.path}
                  title={entry.relativePath}
                  onClick={() => onOpenEntry(entry)}
                >
                  <span className="search-result-kind" aria-hidden="true">
                    {entry.kind === "directory" ? "▱" : "•"}
                  </span>
                  <span className="search-result-copy">
                    <strong>{entry.name}</strong>
                    <small>{entry.relativePath}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {hasQuery && contentGroups.length > 0 && (
          <section className="search-section" aria-label="Resultados no conteúdo">
            <div className="search-section-title">
              <span>CONTEÚDO</span>
              <span>{contentResult.matches.length}</span>
            </div>

            <div className="search-content-results">
              {contentGroups.map((group) => (
                <div className="search-file-group" key={group.file.path}>
                  <button
                    className="search-file-header"
                    type="button"
                    title={group.file.relativePath}
                    onClick={() => onOpenEntry(group.file)}
                  >
                    <strong>{group.file.name}</strong>
                    <span>{group.file.relativePath}</span>
                  </button>

                  <div className="search-line-results">
                    {group.matches.map((match) => (
                      <button
                        className="search-line-result"
                        type="button"
                        key={`${match.file.path}:${match.lineNumber}`}
                        title={`${match.file.relativePath}:${match.lineNumber}`}
                        onClick={() => onOpenMatch(match.file, match.lineNumber, match.column)}
                      >
                        <span className="search-line-number">{match.lineNumber}</span>
                        <code>{match.lineText || " "}</code>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {hasQuery && !isSearching && !searchError && !hasResults && (
          <div className="global-search-empty">
            <strong>Nenhum resultado</strong>
            <span>Tente outro termo de busca.</span>
          </div>
        )}

        {searchError && (
          <div className="global-search-error">{searchError}</div>
        )}
      </div>

      {hasQuery && !searchError && (
        <div className="global-search-footer">
          <span>{contentResult.searchedFiles} arquivos pesquisados</span>
          {contentResult.skippedFiles > 0 && (
            <span>{contentResult.skippedFiles} ignorados</span>
          )}
          {contentResult.truncated && (
            <span>Resultados limitados</span>
          )}
        </div>
      )}
    </div>
  );
}
