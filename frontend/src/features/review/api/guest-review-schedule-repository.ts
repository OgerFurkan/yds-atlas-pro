import type { GameSession } from "@yds-atlas/shared";
import { getStorageScope, scopedStorageKey } from "@/shared/lib/storage-scope";
import { storageKeys } from "@/shared/lib/storage-keys";
import { rateCompletedGame } from "../model/assessment-to-rating";
import { newReviewSchedule, rateReview, type ReviewSchedule } from "../model/spaced-repetition";

/** Intentionally guest-only. Authenticated accounts must use a verified server API. */
type GuestReviewStorage = Pick<Storage, "getItem" | "setItem">;

interface GuestReviewLedger {
  version: 1;
  schedules: ReviewSchedule[];
  appliedSessionIds: string[];
}

const MAX_SCHEDULES = 5_000;
const MAX_SESSIONS = 50_000;
const MAX_RAW_LENGTH = 4_000_000;
const INITIAL: GuestReviewLedger = { version: 1, schedules: [], appliedSessionIds: [] };

function requireGuest() {
  if (getStorageScope() !== null)
    throw new Error("Hesapli kullanicilarin tekrar takvimi yerel misafir kaydina yazilamaz.");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function validSchedule(value: unknown): value is ReviewSchedule {
  if (!record(value)) return false;
  return typeof value.wordId === "string" && value.wordId.trim().length > 0 &&
    Number.isSafeInteger(value.repetitions) && (value.repetitions as number) >= 0 &&
    Number.isSafeInteger(value.lapses) && (value.lapses as number) >= 0 &&
    Number.isSafeInteger(value.intervalDays) && (value.intervalDays as number) >= 0 &&
    (value.intervalDays as number) <= 36500 &&
    typeof value.easeFactor === "number" && Number.isFinite(value.easeFactor) &&
    value.easeFactor >= 1.3 && value.easeFactor <= 2.8 &&
    validInstant(value.dueAt) &&
    (value.lastReviewedAt === null || validInstant(value.lastReviewedAt));
}

function parseLedger(raw: string | null): GuestReviewLedger {
  if (raw === null) return { ...INITIAL, schedules: [], appliedSessionIds: [] };
  if (raw.length > MAX_RAW_LENGTH) throw new Error("Tekrar kaydi beklenenden buyuk.");
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; }
  catch { throw new Error("Tekrar kaydi okunamadi: bozuk JSON. Kayit degistirilmedi."); }

  if (!record(value) || value.version !== 1 ||
      !Array.isArray(value.schedules) || !Array.isArray(value.appliedSessionIds) ||
      value.schedules.length > MAX_SCHEDULES || value.appliedSessionIds.length > MAX_SESSIONS) {
    throw new Error("Tekrar kaydi surumu veya yapisi gecersiz. Kayit degistirilmedi.");
  }
  const schedules: ReviewSchedule[] = [];
  const seenWords = new Set<string>();
  for (const item of value.schedules as unknown[]) {
    if (!validSchedule(item) || seenWords.has(item.wordId))
      throw new Error("Tekrar kaydinda gecersiz veya tekrarlanan kelime var.");
    seenWords.add(item.wordId);
    schedules.push({ ...item });
  }
  const appliedSessionIds: string[] = [];
  const seenSessions = new Set<string>();
  for (const id of value.appliedSessionIds as unknown[]) {
    if (typeof id !== "string" || !id.trim() || id.length > 128 || seenSessions.has(id))
      throw new Error("Tekrar kaydinda gecersiz veya tekrarlanan oturum var.");
    seenSessions.add(id);
    appliedSessionIds.push(id);
  }
  return { version: 1, schedules, appliedSessionIds };
}

function loadGuest(storage: GuestReviewStorage): GuestReviewLedger {
  requireGuest();
  // Do not treat storage permission failures as an empty set: overwriting it
  // would destroy the only copy of someone's learning history.
  let raw: string | null;
  try { raw = storage.getItem(scopedStorageKey(storageKeys.guestReviewSchedules, null)); }
  catch { throw new Error("Misafir tekrar kaydi okunamadi; veri degistirilmedi."); }
  return parseLedger(raw);
}

/** Read-only: deleted words are hidden, never silently erased from the ledger. */
export function listGuestReviewSchedules(
  storage: GuestReviewStorage,
  validWordIds: ReadonlySet<string>,
): ReviewSchedule[] {
  return loadGuest(storage).schedules
    .filter((item) => validWordIds.has(item.wordId))
    .map((item) => ({ ...item }));
}

/**
 * Save a completed guest session once using one localStorage write. No cross-tab
 * compare-and-swap guarantee; do not wire this up without integration testing.
 * Authenticated sessions must go to a server-only writer, never to this key.
 */
export function applyCompletedGuestReview(
  storage: GuestReviewStorage,
  session: GameSession,
  validWordIds: ReadonlySet<string>,
  now = new Date(),
): { applied: boolean; reviewed: number } {
  requireGuest();
  if (!Number.isFinite(now.getTime())) throw new Error("Tekrar tarihi gecersiz.");
  if (!session.id.trim() || session.id.length > 128) throw new Error("Oturum kimligi gecersiz.");
  const graded = rateCompletedGame(session); // validate ALL assessments before writing
  const ledger = loadGuest(storage);
  if (ledger.appliedSessionIds.includes(session.id)) return { applied: false, reviewed: 0 };
  if (ledger.appliedSessionIds.length >= MAX_SESSIONS)
    throw new Error("Oturum kayit limiti doldu; eski kayitlar otomatik silinmez.");

  const byId = new Map(ledger.schedules.map((item) => [item.wordId, item]));
  let reviewed = 0;
  for (const { wordId, rating } of graded) {
    // A word deleted from the guest library must never be revived by a session.
    if (!validWordIds.has(wordId)) continue;
    const existing = byId.get(wordId) ?? newReviewSchedule(wordId, now);
    // A stale older session cannot move an already reviewed word backwards.
    if (existing.lastReviewedAt && Date.parse(existing.lastReviewedAt) >= now.getTime()) continue;
    byId.set(wordId, rateReview(existing, rating, now));
    reviewed += 1;
  }
  if (byId.size > MAX_SCHEDULES)
    throw new Error("Tekrar kelime kayit limiti doldu.");
  const updated: GuestReviewLedger = {
    version: 1,
    schedules: [...byId.values()],
    appliedSessionIds: [...ledger.appliedSessionIds, session.id],
  };
  requireGuest(); // refuse a late write if the account scope changed meanwhile
  try {
    storage.setItem(scopedStorageKey(storageKeys.guestReviewSchedules, null), JSON.stringify(updated));
  } catch {
    throw new Error("Tekrar takvimi kaydedilemedi; eski kayit korunuyor.");
  }
  return { applied: true, reviewed };
}
