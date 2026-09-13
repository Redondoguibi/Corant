import { useState } from "react";
import { WelcomeScreen } from "../components/layout/WelcomeScreen";
import { CreateProjectDialog } from "../components/projects/CreateProjectDialog";
import { Workspace } from "../components/editor/Workspace";
import "../styles/app.css";

export function App() {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);

  function handleCreateProject(name: string) {
    setProjectName(name);
    setShowCreateProject(false);
  }

  if (projectName) {
    return (
      <div className="corant-app">
        <Workspace
          projectName={projectName}
          onBackToHome={() => setProjectName(null)}
        />
      </div>
    );
  }

  return (
    <div className="corant-app">
      <WelcomeScreen onCreateProject={() => setShowCreateProject(true)} />
      {showCreateProject && (
        <CreateProjectDialog
          onClose={() => setShowCreateProject(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}
