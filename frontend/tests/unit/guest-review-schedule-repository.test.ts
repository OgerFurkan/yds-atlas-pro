import { expect, test } from "bun:test";
import { setStorageScope } from "@/shared/lib/storage-scope";
import {
  applyCompletedGuestReview,
  listGuestReviewSchedules,
} from "@/features/review/api/guest-review-schedule-repository";
import { completeSession } from "../fixtures/review-session";

function fakeStorage() {
  const values = new Map<string, string>();
  let writes = 0;
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; values.set(key, value); },
    values,
    get writes() { return writes; },
  };
}

const now = new Date("2026-11-14T13:00:00.000Z");
const ids = new Set(["word-1"]);

test("new guest session creates one due schedule with an interval", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  expect(applyCompletedGuestReview(storage, completeSession(), ids, now))
    .toEqual({ applied: true, reviewed: 1 });
  const entries = listGuestReviewSchedules(storage, ids);
  expect(entries).toHaveLength(1);
  expect(entries[0].lastReviewedAt).toBe(now.toISOString());
  expect(entries[0].dueAt).toBe("2026-11-15T13:00:00.000Z");
  expect(storage.writes).toBe(1);
});

test("replaying an identical session does not apply a second interval or write", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  const session = completeSession();
  applyCompletedGuestReview(storage, session, ids, now);
  const before = listGuestReviewSchedules(storage, ids);
  expect(applyCompletedGuestReview(storage, session, ids, new Date("2026-11-15T14:00:00.000Z")))
    .toEqual({ applied: false, reviewed: 0 });
  expect(listGuestReviewSchedules(storage, ids)).toEqual(before);
  expect(storage.writes).toBe(1);
});

test("an older completed session cannot overwrite a newer review", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  const newer = completeSession();
  newer.id = "session-newer";
  applyCompletedGuestReview(storage, newer, ids, now);
  const older = completeSession();
  older.id = "session-older";
  expect(applyCompletedGuestReview(storage, older, ids, new Date("2026-11-13T13:00:00.000Z")))
    .toEqual({ applied: true, reviewed: 0 });
  expect(listGuestReviewSchedules(storage, ids)[0].lastReviewedAt).toBe(now.toISOString());
});

test("deleted words are not recreated from a finished session", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  expect(applyCompletedGuestReview(storage, completeSession(), new Set(), now))
    .toEqual({ applied: true, reviewed: 0 });
  expect(listGuestReviewSchedules(storage, ids)).toHaveLength(0);
});

test("a corrupt ledger is never overwritten", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  storage.values.set("yds-atlas-review-schedules-v1", "{broken");
  expect(() => applyCompletedGuestReview(storage, completeSession(), ids, now)).toThrow();
  expect(storage.values.get("yds-atlas-review-schedules-v1")).toBe("{broken");
  expect(storage.writes).toBe(0);
});

test("storage read failures and write failures never masquerade as a successful save", () => {
  setStorageScope(null);
  expect(() => listGuestReviewSchedules({ getItem: () => { throw Error("blocked"); }, setItem: () => {} }, ids)).toThrow();
  expect(() => applyCompletedGuestReview({ getItem: () => null, setItem: () => { throw Error("quota"); } }, completeSession(), ids, now)).toThrow();
});

test("signed-in scope cannot read or write the guest review ledger", () => {
  const storage = fakeStorage();
  setStorageScope("account-id");
  try {
    expect(() => listGuestReviewSchedules(storage, ids)).toThrow();
    expect(() => applyCompletedGuestReview(storage, completeSession(), ids, now)).toThrow();
    expect(storage.writes).toBe(0);
  } finally {
    setStorageScope(null);
  }
});

test("returned schedules are detached from the persisted object", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  applyCompletedGuestReview(storage, completeSession(), ids, now);
  listGuestReviewSchedules(storage, ids)[0].easeFactor = 1.3;
  expect(listGuestReviewSchedules(storage, ids)[0].easeFactor).toBe(2.5);
});


test("guest ledger is read-only when filtered by existing library words", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  applyCompletedGuestReview(storage, completeSession(), ids, now);
  const before = storage.values.get("yds-atlas-review-schedules-v1");
  expect(listGuestReviewSchedules(storage, new Set())).toHaveLength(0);
  expect(storage.values.get("yds-atlas-review-schedules-v1")).toBe(before);
  expect(storage.writes).toBe(1);
});

test("an invalid assessment cannot mutate an existing guest schedule", () => {
  setStorageScope(null);
  const storage = fakeStorage();
  applyCompletedGuestReview(storage, completeSession(), ids, now);
  const before = storage.values.get("yds-atlas-review-schedules-v1");
  const incomplete = completeSession();
  incomplete.id = "incomplete";
  incomplete.assessment["word-1"].context = null;
  expect(() => applyCompletedGuestReview(storage, incomplete, ids, now)).toThrow();
  expect(storage.values.get("yds-atlas-review-schedules-v1")).toBe(before);
});
