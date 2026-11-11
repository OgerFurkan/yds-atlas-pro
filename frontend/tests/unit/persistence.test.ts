import { beforeEach, expect, test } from "bun:test";
import { completedToday, recordDailyProgress } from "@/features/dashboard/model/daily-progress";
import { getStreak } from "@/features/dashboard/model/streak";
import {
  advance,
  createSession,
  makeQuestion,
  recordAnswer,
} from "@/features/learning-game/model/game-engine";
import { gameStorageKey } from "@/features/learning-game/model/game-session";
import { persistSession, readSession } from "@/features/learning-game/model/game-storage";
import {
  continueMatching,
  selectMatching,
  startMatchingBoard,
} from "@/features/learning-game/model/matching-engine";
import { localWordRepository } from "@/features/word-library/api/local-word-repository";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
beforeEach(() => storage.clear());

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
  storage.set("yds-atlas-daily-goal", "100");
  recordDailyProgress(Array.from({ length: 20 }, (_, index) => `word-${index}`));
  expect(getStreak().current).toBe(0);
  recordDailyProgress(Array.from({ length: 100 }, (_, index) => `word-${index}`));
  expect(getStreak().current).toBe(1);
  storage.set("yds-atlas-daily-goal", "10");
  expect(getStreak().current).toBe(1);
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
  storage.set(gameStorageKey, JSON.stringify({ phase: "unknown" }));
  expect(readSession()).toBeNull();
  const word = localWordRepository.save({ word: "abandon" });
  storage.set(gameStorageKey, JSON.stringify({ ...createSession([word], 5), queue: ["missing"] }));
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
