import { FormEvent, useEffect, useState } from "react";

type ExplorerNameDialogProps = {
  mode: "file" | "folder" | "rename";
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
};

const copy = {
  file: {
    kicker: "NOVO ARQUIVO",
    title: "Criar arquivo",
    placeholder: "exemplo.js",
    action: "Criar arquivo",
  },
  folder: {
    kicker: "NOVA PASTA",
    title: "Criar pasta",
    placeholder: "minha-pasta",
    action: "Criar pasta",
  },
  rename: {
    kicker: "RENOMEAR",
    title: "Renomear item",
    placeholder: "novo-nome",
    action: "Renomear",
  },
};

export function ExplorerNameDialog({ mode, initialName = "", onClose, onSubmit }: ExplorerNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = copy[mode];

  useEffect(() => {
    setName(initialName);
    setError(null);
  }, [initialName, mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(trimmedName);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-name-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">{labels.kicker}</span>
            <h2 id="explorer-name-dialog-title">{labels.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar" disabled={isSubmitting}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="explorer-entry-name">
            Nome
          </label>
          <input
            id="explorer-entry-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={labels.placeholder}
            autoFocus
            disabled={isSubmitting}
            spellCheck={false}
          />

          {error && <p className="dialog-error">{error}</p>}

          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? "Processando..." : labels.action}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
