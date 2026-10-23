import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./admin.css";

const container = document.getElementById("admin-root");
if (!container) {
  throw new Error("Root element #admin-root not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
