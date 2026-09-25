import { useEffect, useRef } from "react";
import { version } from "../../../package.json";

export function WorkspaceHelpDialog({ page, onClose }: {
  page: "about" | "help";
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  return (
    <dialog ref={dialogRef} className="dialog-card workspace-help-dialog" aria-labelledby="workspace-help-title"
      onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog-header">
        <h2 id="workspace-help-title">{page === "about" ? "Sobre o Corant" : "Ajuda do Corant"}</h2>
        <button type="button" className="icon-button" aria-label="Fechar ajuda" onClick={onClose}>×</button>
      </div>
      {page === "about" ? <>
        <p>Corant · versão {version}</p>
        <p>Um workspace local para seus projetos. Seus arquivos permanecem no computador, sem conta ou servidor obrigatório.</p>
      </> : <>
        <p>Use Arquivo para criar arquivos e pastas no local selecionado no Explorer ou abrir outro projeto.</p>
        <p>As edições são salvas automaticamente após uma breve pausa. Salvar tudo também grava alterações de abas inativas.</p>
        <p>Editar e Seleção atuam no arquivo aberto. Exibir alterna o Explorer, a busca global, o minimapa e a quebra de linha.</p>
        <p>Atalhos: Ctrl+N cria um arquivo; Ctrl+O abre um projeto; Ctrl+S salva; Ctrl+Shift+S salva tudo;
          Ctrl+W fecha a aba; Ctrl+Tab troca de aba; Ctrl+Shift+F abre a busca; Ctrl+B alterna a barra lateral; F1 abre esta ajuda.</p>
        <p>Ctrl+` abre o terminal integrado na pasta do projeto. O painel pode ser ocultado sem interromper o shell; use Encerrar para pará-lo ou Reiniciar para abrir uma nova sessão. A execução automatizada de tarefas ainda não está disponível.</p>
      </>}
      <div className="dialog-actions"><button type="button" className="primary-button" onClick={onClose}>Entendi</button></div>
    </dialog>
  );
}
