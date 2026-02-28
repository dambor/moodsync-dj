import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

document.body.style.cssText = "margin:0;padding:0;background:#0a0a1a;";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
