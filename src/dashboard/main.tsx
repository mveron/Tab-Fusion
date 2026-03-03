import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/dashboard/App";

const container = document.getElementById("root");

if (!container) {
  throw new Error("No se encontró el contenedor principal del dashboard.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
