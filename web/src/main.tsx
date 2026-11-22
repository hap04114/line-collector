import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./landing.css";
import "./map-overlays.css";
import { App } from "./App";
import { OwnerPage } from "./views/OwnerPage";
import { I18nProvider } from "./i18n";

const isOwner = location.pathname.startsWith("/owner");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>{isOwner ? <OwnerPage /> : <App />}</I18nProvider>
  </StrictMode>,
);
