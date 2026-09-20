import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles/index.css";
import "./styles/tabs.css";
import "./styles/search.css";
import "./styles/context-menu.css";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Elemento #app não encontrado.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
