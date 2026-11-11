import { createContext } from "react";

export type AppLanguage = "tr" | "en";
export type ColorTheme = "light" | "dark" | "system";

export interface AppPreferences {
  language: AppLanguage;
  theme: ColorTheme;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: ColorTheme) => void;
}

export const AppPreferencesContext = createContext<AppPreferences | null>(null);
