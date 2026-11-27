import { z } from "zod";
import { storageKeys } from "./storage-keys";
import { scopedStorageKey } from "./storage-scope";

// Only synchronous mutations inside the profile Web Lock participate.
const journalKey = "yds-atlas-pending-write-v1";
const recoverable = [
  storageKeys.dailyGoal,
  storageKeys.words,
  storageKeys.dailyWordGroups,
  storageKeys.dailyWordExclusions,
  storageKeys.dailyPlanInitialized,
  storageKeys.dailyPlanGroupSize,
  storageKeys.dailyProgress,
  storageKeys.completedDays,
  storageKeys.goalPerDay,
  storageKeys.sessionRevision,
  storageKeys.pendingSession,
  "atlas-plan-command-v1",
  "atlas-preserved-drafts-v1",
  storageKeys.gameSession,
] as const;
const entrySchema = z.object({
  key: z.enum(recoverable),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
const journalSchema = z.object({
  version: z.literal(1),
  entries: z.array(entrySchema).min(2).max(recoverable.length),
});
type Entry = z.infer<typeof entrySchema>;
let pending: Map<string, Entry> | undefined;
function applyEntries(entries: Entry[]) {
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new Error("Yarım kalan işlemin kayıtları doğrulanamadı.");
  for (const entry of entries) {
    const current = localStorage.getItem(scopedStorageKey(entry.key));
    if (current !== entry.before && current !== entry.after)
      throw new Error("Yarım kalan işlem başka bir kayıtla çakışıyor. Veriler korundu.");
  }
  for (const entry of entries) {
    const key = scopedStorageKey(entry.key);
    if (localStorage.getItem(key) === entry.after) continue;
    if (entry.after === null) localStorage.removeItem(key);
    else localStorage.setItem(key, entry.after);
  }
}
export function hasPendingLocalChanges(owner?: string | null) {
  return readStoredText(journalKey, owner) !== null;
}
export function commitLocalChanges<T>(mutation: () => T): T {
  const key = scopedStorageKey(journalKey);
  const previous = localStorage.getItem(key);
  if (previous !== null) {
    const { entries } = journalSchema.parse(JSON.parse(previous));
    try {
      applyEntries(entries);
      localStorage.removeItem(key);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "Error") throw cause;
      throw new Error("Tarayıcı kaydı yapılamadı. Depolama iznini ve boş alanı kontrol et.", {
        cause,
      });
    }
  }
  const changes = new Map<string, Entry>();
  pending = changes;
  try {
    const result = mutation();
    const entries = [...changes.values()].filter((entry) => entry.before !== entry.after);
    if (!entries.length) return result;
    try {
      if (entries.length > 1) localStorage.setItem(key, JSON.stringify({ version: 1, entries }));
      applyEntries(entries);
      if (entries.length > 1) localStorage.removeItem(key);
    } catch (cause) {
      throw new Error("Tarayıcı kaydı yapılamadı. Depolama iznini ve boş alanı kontrol et.", {
        cause,
      });
    }
    return result;
  } finally {
    pending = undefined;
  }
}

export function readStoredText(key: string, owner?: string | null): string | null {
  try {
    const physicalKey = scopedStorageKey(key, owner);
    const entry = physicalKey === scopedStorageKey(key) ? pending?.get(key) : undefined;
    return entry ? entry.after : localStorage.getItem(physicalKey);
  } catch {
    throw new Error("Tarayıcı kaydına erişilemedi. Depolama iznini kontrol edip yeniden dene.");
  }
}

/** Only an absent key returns undefined. JSON null is a stored value. */
export function readStoredJson(key: string): unknown {
  const raw = readStoredText(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Tarayıcı kaydındaki JSON okunamadı. Özgün kayıt korundu.");
  }
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = readStoredJson(key);
    return value === undefined ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown, owner?: string | null) {
  try {
    storeText(key, JSON.stringify(value), owner);
  } catch {
    throw new Error("Tarayıcı kaydı yapılamadı. Depolama iznini ve boş alanı kontrol et.");
  }
}

export function readRawStorage(key: string) {
  try {
    return readStoredText(key);
  } catch {
    return null;
  }
}

function storeText(key: string, after: string | null, owner?: string | null) {
  const physicalKey = scopedStorageKey(key, owner);
  if (pending && physicalKey === scopedStorageKey(key)) {
    const logicalKey = entrySchema.shape.key.parse(key);
    const existing = pending.get(key);
    const before = existing ? existing.before : localStorage.getItem(physicalKey);
    pending.set(key, { key: logicalKey, before, after });
  } else if (after === null) localStorage.removeItem(physicalKey);
  else localStorage.setItem(physicalKey, after);
}

export function writeRawStorage(key: string, value: string, owner?: string | null) {
  try {
    storeText(key, value, owner);
  } catch {
    throw new Error("Tarayıcı kaydı yapılamadı. Depolama iznini ve boş alanı kontrol et.");
  }
}

export function removeStorage(key: string, owner?: string | null) {
  try {
    storeText(key, null, owner);
  } catch {
    throw new Error("Tarayıcı kaydı silinemedi. Depolama iznini kontrol et.");
  }
}
