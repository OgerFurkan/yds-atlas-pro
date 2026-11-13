import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { tr } from "./locales/tr";
import { en } from "./locales/en";

const resources = {
  tr: { translation: tr },
  en: { translation: en },
} as const;

function savedLanguage(): "tr" | "en" {
  try {
    return localStorage.getItem("yds-atlas-language") === "en" ? "en" : "tr";
  } catch {
    return "tr";
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: savedLanguage(),
  fallbackLng: "tr",
  interpolation: { escapeValue: false },
});

export default i18n;
