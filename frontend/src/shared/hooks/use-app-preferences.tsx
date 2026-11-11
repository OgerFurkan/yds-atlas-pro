import { useContext } from "react";
import {
  type AppLanguage,
  AppPreferencesContext,
  type ColorTheme,
} from "./app-preferences-context";

export type { AppLanguage, ColorTheme };

export function useAppPreferences() {
  const value = useContext(AppPreferencesContext);
  if (!value) throw new Error("AppPreferencesProvider is missing.");
  return value;
}
