import { HttpError } from "../../shared/errors";

type CooldownReason = "rate_limit" | "auth";
type Cooldown = { until: number; reason: CooldownReason };

// Quota is tracked per project and model, so a key that is limited on the word model
// may still serve chat. Cooldowns live in process memory: a restart forgets them.
const cooldowns = new Map<string, Cooldown>();
const cursors = new Map<string, number>();

function slot(model: string, apiKey: string) {
  return `${model}\u0000${apiKey}`;
}

// Tests and local reloads must be able to start from a clean pool.
export function resetGeminiKeyPool() {
  cooldowns.clear();
  cursors.clear();
}

// Rotate across ready keys so one key does not absorb every request until it fails.
export function nextGeminiKey(keys: string[], model: string): string | undefined {
  const now = Date.now();
  const ready = keys.filter((key) => (cooldowns.get(slot(model, key))?.until ?? 0) <= now);
  if (!ready.length) return undefined;
  const cursor = cursors.get(model) ?? 0;
  cursors.set(model, cursor + 1);
  return ready[cursor % ready.length];
}

export function coolGeminiKey(
  model: string,
  apiKey: string,
  reason: CooldownReason,
  seconds: number,
) {
  cooldowns.set(slot(model, apiKey), {
    until: Date.now() + Math.max(1, Math.ceil(seconds)) * 1000,
    reason,
  });
}

export type GeminiPoolStatus = { readyKeys: number; waitSeconds: number | null };

// Health reporting only: shows how many projects can answer right now without exposing keys.
export function geminiPoolStatus(keys: string[], model: string): GeminiPoolStatus {
  if (!keys.length) return { readyKeys: 0, waitSeconds: null };
  const now = Date.now();
  const readyKeys = keys.filter(
    (key) => (cooldowns.get(slot(model, key))?.until ?? 0) <= now,
  ).length;
  if (readyKeys) return { readyKeys, waitSeconds: null };
  return { readyKeys: 0, waitSeconds: geminiKeyWait(keys, model).seconds };
}

export function geminiKeyWait(keys: string[], model: string) {
  const now = Date.now();
  const active = keys
    .map((key) => cooldowns.get(slot(model, key)))
    .filter((entry): entry is Cooldown => entry !== undefined && entry.until > now);
  if (!active.length) return { seconds: 1, reason: undefined };
  return {
    seconds: Math.max(1, Math.ceil((Math.min(...active.map((entry) => entry.until)) - now) / 1000)),
    reason: active.some((entry) => entry.reason === "rate_limit")
      ? ("rate_limit" as const)
      : ("auth" as const),
  };
}

// All keys are cooling: report the soonest usable key instead of retrying blindly.
export function geminiPoolError(keys: string[], model: string): HttpError {
  const { seconds, reason } = geminiKeyWait(keys, model);
  if (reason === "auth")
    return new HttpError(
      503,
      "Gemini API anahtarları veya proje erişimi reddedildi. Sunucudaki anahtarları kontrol et.",
      "AI_AUTH_ERROR",
    );
  return new HttpError(
    429,
    `Gemini dakikalık istek sınırına ulaşıldı. ${seconds} saniye sonra tekrar dene.`,
    "AI_QUOTA_EXCEEDED",
  );
}
