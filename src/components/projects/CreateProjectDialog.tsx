import { FormEvent, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

type CreateProjectDialogProps = {
  onClose: () => void;
  onCreate: (projectName: string, parentPath: string) => Promise<void>;
};

export function CreateProjectDialog({ onClose, onCreate }: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName || isCreating) return;

    setError(null);
    setIsCreating(true);

    try {
      const selectedParent = await open({
        directory: true,
        multiple: false,
        title: "Escolha onde criar o projeto",
      });

      if (!selectedParent || Array.isArray(selectedParent)) {
        return;
      }

      await onCreate(trimmedName, selectedParent);
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : String(creationError));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">NOVO PROJETO</span>
            <h2 id="create-project-title">Criar projeto</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="project-name">
            Nome do projeto
          </label>
          <input
            id="project-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Meu projeto"
            autoFocus
            disabled={isCreating}
          />

          {error && <p className="dialog-error">{error}</p>}

          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={isCreating}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={!name.trim() || isCreating}>
              {isCreating ? "Criando..." : "Escolher local e criar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
