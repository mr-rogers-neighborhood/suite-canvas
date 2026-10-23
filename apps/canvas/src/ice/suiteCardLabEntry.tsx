import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { SuiteCardLab } from "./SuiteCardLab";
import "./suiteCardLab.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(<SuiteCardLab />);
