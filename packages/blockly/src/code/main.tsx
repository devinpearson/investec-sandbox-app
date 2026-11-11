import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../style.css";
import CodeApp from "./CodeApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CodeApp />
  </StrictMode>,
);
