import { useCallback, useEffect, useState } from "react";
import type { AppScreen } from "@/app/components/app-header";

export function readHashScreen(): AppScreen {
  const hash = window.location.hash.slice(1);
  return hash === "game" || hash === "library" || hash === "login" ? hash : "home";
}

/** Keeps the screen in sync with the URL hash so refreshes and back/forward work. */
export function useHashScreen() {
  const [screen, setScreen] = useState<AppScreen>(readHashScreen);

  useEffect(() => {
    const update = () => setScreen(readHashScreen());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const navigate = useCallback((next: AppScreen) => {
    window.location.hash = next;
    setScreen(next);
    window.scrollTo({ top: 0 });
  }, []);

  return { screen, navigate };
}
