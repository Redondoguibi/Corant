import { useState } from "react";
import { WelcomeScreen } from "../components/layout/WelcomeScreen";
import { CreateProjectDialog } from "../components/projects/CreateProjectDialog";
import "../styles/app.css";

export function App() {
  const [showCreateProject, setShowCreateProject] = useState(false);

  return (
    <div className="corant-app">
      <WelcomeScreen onCreateProject={() => setShowCreateProject(true)} />
      {showCreateProject && (
        <CreateProjectDialog onClose={() => setShowCreateProject(false)} />
      )}
    </div>
  );
}
