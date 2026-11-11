import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppPreferencesProvider } from "@/shared/hooks/app-preferences-provider";
import "@/shared/i18n/i18n";
import "./index.css";
import App from "./app/App";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Uygulama kökü bulunamadı.");

createRoot(rootElement).render(
  <StrictMode>
    <AppPreferencesProvider>
      <App />
    </AppPreferencesProvider>
  </StrictMode>,
);
