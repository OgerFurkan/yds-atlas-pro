import type { ServerConfig } from "../../config/env";
import { HttpError } from "../../shared/errors";

type CooldownReason = "rate_limit" | "invalid" | "denied";
type Cooldown = { until: number; reason: CooldownReason };

// Quota is tracked per project and model, so a key that is limited on the word model
// may still serve chat. Cooldowns live in process memory: a restart forgets them.
const cooldowns = new Map<string, Cooldown>();
const cursors = new Map<string, number>();
type Attempt = {
  at: number;
  model: string;
  successes: number;
  failures: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  retries: number;
  fallbacks: number;
};
const observations = new Map<string, Attempt>();
let lastKey: string | undefined;
type QuotaPause = { until: number; kind: string[]; model: string };
const quotaPauses = new Map<string, QuotaPause>();

export function recordProviderAttempt(
  key: string,
  model: string,
  retry: boolean,
  fallback: boolean,
) {
  const value = observations.get(key) ?? {
    at: 0,
    model,
    successes: 0,
    failures: 0,
    lastSuccess: null,
    lastFailure: null,
    retries: 0,
    fallbacks: 0,
  };
  lastKey = key;
  value.model = model;
  value.at = Date.now();
  value.retries += Number(retry);
  value.fallbacks += Number(fallback);
  observations.set(key, value);
  return (ok: boolean) => {
    if (ok) {
      value.successes++;
      value.lastSuccess = Date.now();
    } else {
      value.failures++;
      value.lastFailure = Date.now();
    }
  };
}
// A 429 stops the whole deployment pool, including other models and project aliases.
// The provider may enforce multiple dimensions at once.
export function pauseProviderQuota(keys: string[], model: string, seconds: number, kind: string[]) {
  const pool = JSON.stringify(keys);
  const until = Date.now() + seconds * 1000;
  if (until >= (quotaPauses.get(pool)?.until ?? 0)) quotaPauses.set(pool, { model, kind, until });
}
export function checkProviderQuota(keys: string[]) {
  const seconds = Math.ceil(
    ((quotaPauses.get(JSON.stringify(keys))?.until ?? 0) - Date.now()) / 1000,
  );
  if (seconds > 0)
    throw new HttpError(
      429,
      `Gemini sağlayıcı limitine ulaşıldı. ${seconds} saniye sonra tekrar dene.`,
      "AI_QUOTA_EXCEEDED",
      seconds,
    );
}

function slot(model: string, apiKey: string) {
  return `${model}\u0000${apiKey}`;
}

// Tests and local reloads must be able to start from a clean pool.
export function resetGeminiKeyPool() {
  cooldowns.clear();
  cursors.clear();
  observations.clear();
  quotaPauses.clear();
  lastKey = undefined;
}

function cooldown(model: string, key: string) {
  const global = cooldowns.get(slot("*", key));
  return global && global.until > Date.now() ? global : cooldowns.get(slot(model, key));
}

// Rotate across ready keys so one key does not absorb every request until it fails.
export function nextGeminiKey(keys: string[], model: string): string | undefined {
  const now = Date.now();
  const ready = keys.filter((key) => (cooldown(model, key)?.until ?? 0) <= now);
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
  cooldowns.set(slot(reason === "rate_limit" ? model : "*", apiKey), {
    until: Date.now() + Math.max(1, Math.ceil(seconds)) * 1000,
    reason,
  });
}

export type GeminiPoolStatus = { readyKeys: number; waitSeconds: number | null };

// Health reporting only: shows how many projects can answer right now without exposing keys.
export function geminiPoolStatus(keys: string[], model: string): GeminiPoolStatus {
  if (!keys.length) return { readyKeys: 0, waitSeconds: null };
  const now = Date.now();
  const readyKeys = keys.filter((key) => (cooldown(model, key)?.until ?? 0) <= now).length;
  if (readyKeys) return { readyKeys, waitSeconds: null };
  return { readyKeys: 0, waitSeconds: geminiKeyWait(keys, model).seconds };
}

export function geminiKeyWait(keys: string[], model: string) {
  const now = Date.now();
  const active = keys
    .map((key) => cooldown(model, key))
    .filter((entry): entry is Cooldown => entry !== undefined && entry.until > now);
  if (!active.length) return { seconds: 1, reason: undefined };
  return {
    seconds: Math.max(1, Math.ceil((Math.min(...active.map((entry) => entry.until)) - now) / 1000)),
    reason: active.some((entry) => entry.reason === "rate_limit")
      ? ("rate_limit" as const)
      : active.some((entry) => entry.reason === "denied")
        ? ("denied" as const)
        : ("invalid" as const),
  };
}

// All keys are cooling: report the soonest usable key instead of retrying blindly.
export function geminiPoolError(keys: string[], model: string): HttpError {
  const { seconds, reason } = geminiKeyWait(keys, model);
  if (reason === "invalid" || reason === "denied")
    return new HttpError(
      503,
      reason === "invalid"
        ? "Gemini erişim anahtarı geçersiz. Yöneticiye bildir."
        : "Gemini erişim izni yetersiz. Yöneticiye bildir.",
      reason === "invalid" ? "AI_AUTH_ERROR" : "AI_PERMISSION_DENIED",
    );
  return new HttpError(
    429,
    `Gemini sağlayıcı limitine ulaşıldı. ${seconds} saniye sonra tekrar dene.`,
    "AI_QUOTA_EXCEEDED",
    seconds,
  );
}

export function geminiDiagnostics(config: ServerConfig) {
  const label = (index: number) => "Key " + String(index + 1).padStart(2, "0");
  const pause = quotaPauses.get(JSON.stringify(config.GEMINI_KEYS));
  const keys = config.GEMINI_KEYS.map((key, index) => {
    const observed = observations.get(key);
    const item = cooldown(observed?.model ?? config.GEMINI_MODEL_WORD, key);
    const cooling = item && item.until > Date.now();
    return {
      id: label(index),
      state: cooling
        ? item.reason
        : observed?.lastSuccess &&
            (!observed.lastFailure || observed.lastSuccess > observed.lastFailure)
          ? "ready"
          : "unknown",
      retryAt: cooling ? item.until : null,
      lastModel: observed?.model ?? null,
      lastRequest: observed?.at ?? null,
      lastSuccess: observed?.lastSuccess ?? null,
      lastFailure: observed?.lastFailure ?? null,
      successes: observed?.successes ?? 0,
      failures: observed?.failures ?? 0,
      retries: observed?.retries ?? 0,
      fallbacks: observed?.fallbacks ?? 0,
    };
  });
  const latest = lastKey ? config.GEMINI_KEYS.indexOf(lastKey) : -1;
  return {
    keys,
    lastKey: latest < 0 ? null : label(latest),
    pause: pause && pause.until > Date.now() ? pause : null,
    projectGroupsConfigured: !!config.GEMINI_KEY_GROUP_IDS?.length,
  };
}
