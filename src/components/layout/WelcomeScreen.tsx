type WelcomeScreenProps = {
  onCreateProject: () => void;
  onOpenProject: () => void;
};

export function WelcomeScreen({ onCreateProject, onOpenProject }: WelcomeScreenProps) {
  return (
    <main className="welcome-screen">
      <section className="welcome-content">
        <span className="welcome-eyebrow">LOCAL-FIRST WORKSPACE</span>
        <h1>Corant</h1>
        <p className="welcome-description">
          Um espaço desktop para organizar, editar e executar seus projetos.
        </p>
        <div className="welcome-actions">
          <button className="primary-button" type="button" onClick={onCreateProject}>
            Criar projeto
          </button>
          <button className="secondary-button" type="button" onClick={onOpenProject}>
            Abrir projeto
          </button>
        </div>
      </section>
    </main>
  );
}
