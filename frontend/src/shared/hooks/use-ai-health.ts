import { useEffect, useSyncExternalStore } from "react";
import { type AiHealth, fetchAiHealth } from "@/shared/api/ai-health";

type Snapshot = {
  phase: "checking" | "ready" | "offline";
  health: AiHealth | null;
  errorMessage: string;
  checkedAt: number | null;
  wordIssue?: { availability: "offline" | "cooldown"; message: string };
};

const cacheMs = 30_000;
let snapshot: Snapshot = { phase: "checking", health: null, errorMessage: "", checkedAt: null };
let pending: Promise<Snapshot> | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
  return next;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function checkAiHealth() {
  if (pending) return pending;
  pending = fetchAiHealth()
    .then(
      (health) => publish({ phase: "ready", health, errorMessage: "", checkedAt: Date.now() }),
      (error: unknown) =>
        publish({
          phase: "offline",
          health: null,
          errorMessage: error instanceof Error ? error.message : "",
          checkedAt: Date.now(),
        }),
    )
    .finally(() => {
      pending = null;
    });
  publish({ ...snapshot, phase: "checking" });
  return pending;
}

export function reportWordAiUnavailable(message: string, availability: "offline" | "cooldown") {
  publish({ ...snapshot, wordIssue: { availability, message } });
}

export function wordAiAvailability({ phase, health, wordIssue }: Snapshot) {
  if (phase === "checking") return "checking";
  if (phase === "offline" || !health) return "offline";
  if (wordIssue) return wordIssue.availability;
  if (
    !health.databaseConfigured ||
    !health.aiConfigured ||
    health.ai?.configured === false ||
    health.ai?.quotaConfigured === false
  )
    return "not-configured";
  if (health.ai?.word.readyKeys === 0) return "cooldown";
  return "available";
}

export function useAiHealth(enabled = true) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    function refreshIfStale() {
      if (!document.hidden && Date.now() - (getSnapshot().checkedAt ?? 0) >= cacheMs)
        void checkAiHealth();
    }
    refreshIfStale();
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [enabled]);
  return state;
}
