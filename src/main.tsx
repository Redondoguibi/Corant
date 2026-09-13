import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";

function App() {
  return (
    <React.StrictMode>
      <div>
        <h1>MeuApp</h1>
        <p>Tauri + React + TypeScript</p>
      </div>
    </React.StrictMode>
  );
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Elemento #app não encontrado.");
}

ReactDOM.createRoot(rootElement).render(<App />);