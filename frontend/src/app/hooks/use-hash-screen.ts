import { useCallback, useSyncExternalStore } from "react";
import type { AppScreen } from "@/app/components/app-header";

export function readHashScreen(): AppScreen {
  const hash = window.location.hash.slice(1);
  return hash === "control-center" ||
    hash === "game" ||
    hash === "library" ||
    hash === "login" ||
    hash === "inspector"
    ? hash
    : "home";
}

/** Keeps the screen in sync with the URL hash so refreshes and back/forward work. */
function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function useHashScreen() {
  const screen = useSyncExternalStore(subscribe, readHashScreen);

  const navigate = useCallback((next: AppScreen) => {
    window.location.hash = next;
    window.scrollTo({ top: 0 });
  }, []);

  return { screen, navigate };
}
