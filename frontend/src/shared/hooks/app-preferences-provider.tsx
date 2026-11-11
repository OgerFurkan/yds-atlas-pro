import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import i18n from "@/shared/i18n/i18n";
import {
  type AppLanguage,
  AppPreferencesContext,
  type ColorTheme,
} from "./app-preferences-context";

function readTheme(): ColorTheme {
  try {
    const value = localStorage.getItem("yds-atlas-theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function readLanguage(): AppLanguage {
  try {
    return localStorage.getItem("yds-atlas-language") === "en" ? "en" : "tr";
  } catch {
    return "tr";
  }
}

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(readLanguage);
  const [theme, setThemeState] = useState<ColorTheme>(readTheme);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem("yds-atlas-language", language);
    } catch {
      // Preferences still apply for the current page if storage is unavailable.
    }
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      root.dataset.theme = dark ? "dark" : "light";
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };
    applyTheme();
    if (theme === "system") media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  const value = useMemo(
    () => ({
      language,
      theme,
      setLanguage: (next: AppLanguage) => {
        setLanguageState(next);
        try {
          localStorage.setItem("yds-atlas-language", next);
        } catch {
          // Keep the selected language in memory for the current session.
        }
      },
      setTheme: (next: ColorTheme) => {
        setThemeState(next);
        try {
          localStorage.setItem("yds-atlas-theme", next);
        } catch {
          // Keep the selected theme in memory for the current session.
        }
      },
    }),
    [language, theme],
  );

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}
