import { FormEvent, useState } from "react";

type CreateProjectDialogProps = {
  onClose: () => void;
  onCreate: (projectName: string) => void;
};

export function CreateProjectDialog({ onClose, onCreate }: CreateProjectDialogProps) {
  const [name, setName] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    onCreate(trimmedName);
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
          />

          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={!name.trim()}>
              Criar projeto
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
