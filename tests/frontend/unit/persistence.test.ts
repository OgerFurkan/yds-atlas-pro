import { afterEach, beforeEach, expect, test } from "bun:test";
import { getStreak } from "../../../frontend/src/features/dashboard/model/streak";
import {
  advance,
  createSession,
  makeQuestion,
  recordAnswer,
} from "../../../frontend/src/features/learning-game/model/game-engine";
import { gameStorageKey } from "../../../frontend/src/features/learning-game/model/game-session";
import {
  persistSession,
  readSession,
} from "../../../frontend/src/features/learning-game/model/game-storage";
import { completeGuestResult } from "../../../frontend/src/features/learning-game/model/guest-result";
import {
  continueMatching,
  selectMatching,
  startMatchingBoard,
} from "../../../frontend/src/features/learning-game/model/matching-engine";
import { localWordRepository } from "../../../frontend/src/features/word-library/api/local-word-repository";
import {
  completedToday,
  goalHistory,
  recordDailyProgress,
} from "../../../frontend/src/shared/lib/daily-progress";
import { localDateKey } from "../../../frontend/src/shared/lib/istanbul-date";
import {
  commitLocalChanges,
  hasPendingLocalChanges,
} from "../../../frontend/src/shared/lib/storage";
import { storageKeys as keys } from "../../../frontend/src/shared/lib/storage-keys";

import { installMemoryStorage } from "../helpers/memory-storage";

let fixture: ReturnType<typeof installMemoryStorage>;
beforeEach(() => {
  fixture = installMemoryStorage();
});
afterEach(() => fixture.restore());

test.each(["{", "null", "[]", '{"2026-01-01":42}'])(
  "unreadable history is preserved before any result write: %s",
  (raw) => {
    const key = "yds-atlas-daily-progress-v1";
    fixture.storage.setItem(key, raw);
    expect(() => recordDailyProgress(["one"])).toThrow();
    expect(fixture.storage.getItem(key)).toBe(raw);
    expect(fixture.storage.getItem("yds-atlas-goal-per-day-v1")).toBeNull();
  },
);

test("bulk import is atomic and case-insensitive duplicates do not overwrite records", () => {
  const original = localWordRepository.save({ word: "abandon", score: 35 });
  expect(localWordRepository.addMany([{ word: "ABANDON" }, { word: " Benefit " }])).toEqual({
    added: 1,
    duplicates: 1,
  });
  expect(localWordRepository.list().find((word) => word.id === original.id)?.score).toBe(35);
  expect(() => localWordRepository.addMany([{ word: "Obtain" }, { word: "" }])).toThrow();
  expect(localWordRepository.list()).toHaveLength(2);
});

test("absolute score writes and daily unique word counts can safely be retried", () => {
  const word = localWordRepository.save({ word: "abandon" });
  const updates = [{ id: word.id, score: 80 }];
  localWordRepository.applyScores(updates);
  localWordRepository.applyScores(updates);
  recordDailyProgress([word.id]);
  recordDailyProgress([word.id]);
  expect(localWordRepository.list()[0].score).toBe(80);
  expect(completedToday()).toBe(1);
});

test("a short task does not complete a larger daily goal or start a streak", () => {
  fixture.storage.setItem("yds-atlas-daily-goal", "100");
  recordDailyProgress(Array.from({ length: 20 }, (_, index) => `word-${index}`));
  expect(getStreak().current).toBe(0);
  recordDailyProgress(Array.from({ length: 100 }, (_, index) => `word-${index}`));
  expect(getStreak().current).toBe(1);
  fixture.storage.setItem("yds-atlas-daily-goal", "10");
  recordDailyProgress(["another"]);
  expect(Object.values(goalHistory())).toEqual([100]);
  expect(getStreak().current).toBe(1);
});

test("unreadable progress cannot appear as an empty dashboard", () => {
  fixture.storage.setItem("yds-atlas-daily-progress-v1", "broken");
  expect(() => completedToday()).toThrow();
  expect(() => getStreak()).toThrow();
});

test("saved snapshots retain the selected answer across a reload", () => {
  const word = localWordRepository.save({ word: "abandon" });
  let session = advance(createSession([word], 5));
  session = selectMatching(selectMatching(session, "left", word.id), "right", word.id);
  session = continueMatching(session);
  session = recordAnswer(session, makeQuestion(session)!.correct);
  persistSession(session);
  expect(readSession()).toEqual(session);
  localWordRepository.removeMany([word.id]);
  expect(readSession()?.words[0].word).toBe("Abandon");
  localWordRepository.applyScores([{ id: word.id, score: 100 }]);
  expect(localWordRepository.list()).toHaveLength(0);
});

test("invalid saved sessions are rejected instead of breaking the page", () => {
  const word = localWordRepository.save({ word: "abandon" });
  fixture.storage.setItem(gameStorageKey, JSON.stringify({ phase: "unknown" }));
  expect(readSession()).toBeNull();
  fixture.storage.setItem(
    gameStorageKey,
    JSON.stringify({ ...createSession([word], 5), queue: ["missing"] }),
  );
  expect(readSession()).toBeNull();
});

test("matching selections, wrong feedback and completed boards survive reload", () => {
  const first = localWordRepository.save({ word: "abandon", meanings: ["Terk etmek"] });
  const second = localWordRepository.save({ word: "benefit", meanings: ["Fayda"] });
  let session = startMatchingBoard({
    ...createSession([first, second], 5),
    phase: "final-matching",
  });
  session = selectMatching(session, "left", first.id);
  persistSession(session);
  expect(readSession()).toEqual(session);
  session = selectMatching(session, "right", second.id);
  persistSession(session);
  expect(readSession()?.matching?.feedback?.correct).toBe(false);
  session = {
    ...session,
    matching: { ...session.matching!, feedback: null, selectedLeft: null, selectedRight: null },
  };
  for (const word of [first, second])
    session = selectMatching(selectMatching(session, "left", word.id), "right", word.id);
  expect(session.queue).toHaveLength(0);
  persistSession(session);
  expect(readSession()).toEqual(session);
  expect(continueMatching(readSession()!).phase).toBe("final-meaning");
});

test("invalid matching references and duplicate cards cannot be restored", () => {
  const word = localWordRepository.save({ word: "abandon", meanings: ["Terk etmek"] });
  const session = startMatchingBoard({ ...createSession([word], 5), phase: "final-matching" });
  persistSession({ ...session, matching: { ...session.matching!, right: ["missing"] } });
  expect(readSession()).toBeNull();
  persistSession({ ...session, matching: { ...session.matching!, left: [word.id, word.id] } });
  expect(readSession()).toBeNull();
});

for (const boundary of [
  "journal",
  keys.goalPerDay,
  keys.dailyProgress,
  keys.completedDays,
  keys.gameSession,
  "cleanup",
]) {
  test("guest result resumes exactly once after interruption at " + boundary, () => {
    const original = localWordRepository.save({ word: "Resume", score: 77 });
    const result = { ...createSession([original], 5), phase: "complete" as const, queue: [] };
    persistSession(result);
    fixture.storage.setItem(keys.dailyGoal, "10");
    recordDailyProgress(Array.from({ length: 9 }, (_, i) => "previous-" + i));
    fixture.storage.removeItem(keys.goalPerDay);
    const { setItem, removeItem } = fixture.storage;
    fixture.storage.setItem = (key, value) => {
      if (key === boundary || (boundary === "journal" && key.endsWith("pending-write-v1")))
        throw new Error("quota");
      setItem(key, value);
    };
    fixture.storage.removeItem = (key) => {
      if (boundary === "cleanup") throw new Error("quota");
      removeItem(key);
    };
    expect(() =>
      commitLocalChanges(() => completeGuestResult(result, () => localWordRepository.list())),
    ).toThrow();
    fixture.storage.setItem = setItem;
    fixture.storage.removeItem = removeItem;
    commitLocalChanges(() => completeGuestResult(result, () => localWordRepository.list()));
    const after = fixture.storage.getItem(keys.words);
    expect(localWordRepository.list()[0].score).toBe(77);
    commitLocalChanges(() => completeGuestResult(result, () => localWordRepository.list()));
    expect(fixture.storage.getItem(keys.words)).toBe(after);
    expect(completedToday()).toBe(10);
    expect(JSON.parse(fixture.storage.getItem(keys.completedDays)!)[localDateKey()]).toBe(true);
    expect(readSession()?.saved).toBe(true);
    expect(hasPendingLocalChanges()).toBe(false);
  });
}

test("a matching score from another operation cannot authorize an outdated result", () => {
  const first = localWordRepository.save({ word: "Collision" });
  const result = { ...createSession([first], 5), phase: "complete" as const, queue: [] };
  persistSession(result);
  localWordRepository.edit({ usageNote: "New revision" }, first.id, first.updatedAt);
  expect(() =>
    commitLocalChanges(() => completeGuestResult(result, () => localWordRepository.list())),
  ).toThrow("Puanlar kaydedilmedi");
  expect(completedToday()).toBe(0);
  expect(readSession()?.saved).toBe(false);
});

test("a read failure on a later history key prevents every result write", () => {
  const original = localWordRepository.save({ word: "Recover", score: 42 });
  const result = { ...createSession([original], 5), phase: "complete" as const, queue: [] };
  persistSession(result);
  const { getItem, setItem } = fixture.storage;
  const writes: string[] = [];
  fixture.storage.setItem = (key, value) => {
    writes.push(key);
    setItem(key, value);
  };
  fixture.storage.getItem = (key) => {
    if (key === keys.completedDays) throw new Error("denied");
    return getItem(key);
  };
  expect(() =>
    commitLocalChanges(() => completeGuestResult(result, () => localWordRepository.list())),
  ).toThrow();
  expect(writes).toEqual([]);
  expect(readSession()?.saved).toBe(false);
});
test("a conflicting record after interruption is preserved and recovery remains pending", () => {
  const { setItem } = fixture.storage;
  fixture.storage.setItem = (key, value) => {
    if (key === keys.dailyProgress) throw new Error("quota");
    setItem(key, value);
  };
  expect(() => commitLocalChanges(() => recordDailyProgress(["one"]))).toThrow();
  fixture.storage.setItem = setItem;
  setItem(keys.goalPerDay, '{"2026-01-01":30}');
  expect(() => commitLocalChanges(() => {})).toThrow("çakışıyor");
  expect(hasPendingLocalChanges()).toBe(true);
  expect(fixture.storage.getItem(keys.goalPerDay)).toBe('{"2026-01-01":30}');
  expect(fixture.storage.getItem(keys.dailyProgress)).toBeNull();
});
