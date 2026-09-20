import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { WelcomeScreen } from "../components/layout/WelcomeScreen";
import { CreateProjectDialog } from "../components/projects/CreateProjectDialog";
import { Workspace } from "../components/editor/Workspace";
import "../styles/app.css";

export function App() {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [project, setProject] = useState<{ name: string; path: string } | null>(null);

  useEffect(() => {
    function suppressWebViewContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    document.addEventListener("contextmenu", suppressWebViewContextMenu);

    return () => {
      document.removeEventListener("contextmenu", suppressWebViewContextMenu);
    };
  }, []);

  async function handleCreateProject(name: string, parentPath: string) {
    const projectPath = await invoke<string>("create_project_directory", {
      parentPath,
      projectName: name,
    });

    setProject({ name, path: projectPath });
    setShowCreateProject(false);
  }

  async function handleOpenProject() {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Abrir projeto",
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return;
    }

    const projectPath = await invoke<string>("allow_project_directory", {
      path: selectedPath,
    });

    const pathParts = projectPath.split(/[\\/]/).filter(Boolean);
    const name = pathParts.at(-1) ?? "Projeto";

    setProject({ name, path: projectPath });
  }

  if (project) {
    return (
      <div className="corant-app">
        <Workspace
          projectName={project.name}
          projectPath={project.path}
          onBackToHome={() => setProject(null)}
        />
      </div>
    );
  }

  return (
    <div className="corant-app">
      <WelcomeScreen
        onCreateProject={() => setShowCreateProject(true)}
        onOpenProject={handleOpenProject}
      />
      {showCreateProject && (
        <CreateProjectDialog
          onClose={() => setShowCreateProject(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}
