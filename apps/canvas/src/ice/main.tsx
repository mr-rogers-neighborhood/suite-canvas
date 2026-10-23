import { createRoot } from "react-dom/client";
import { initTheme } from "../theme/useThemeStore";
import "../styles/global.css";
import { IceSurface } from "./IceSurface";
import "./iceStandalone.css";

initTheme();

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

const root = document.createElement("div");
root.className = "ice-standalone";
container.append(root);

createRoot(root).render(<IceSurface sceneHref="/" />);
