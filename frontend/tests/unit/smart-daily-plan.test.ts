import { expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import { buildSmartDailyPlan } from "@/features/word-library/model/smart-daily-plan";
import { newReviewSchedule, rateReview } from "@/features/review/model/spaced-repetition";

const NOW = new Date("2026-11-14T09:00:00.000Z");

function word(id: string, score = 0, ready = true): WordEntry {
  return {
    id, word: id, score, alternatives: [], meanings: ready ? ["meaning"] : [],
    usageNote: "", partOfSpeech: "noun", cefr: "B1", pronunciationUk: "",
    pronunciationUs: "", sourceUrl: "", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    examples: ready ? Array.from({ length: 5 }, (_, i) => ({
      sentence: `We use ${id} in example ${i}.`, translation: "",
    })) : [],
  };
}

function plan(overrides: Partial<Parameters<typeof buildSmartDailyPlan>[0]> = {}) {
  return buildSmartDailyPlan({
    words: [], schedules: [], assignments: [], activeDay: 1,
    minutesAvailable: 20, now: NOW, ...overrides,
  });
}

test("empty inputs yield no task and preserve the full time budget", () => {
  const value = plan();
  expect(value.tasks).toEqual([]);
  expect(value.minutesRemaining).toBe(20);
  expect(value.selected).toEqual({ due: 0, difficult: 0, new: 0 });
});

test("due reviews have priority over difficult and new words", () => {
  const a = word("Due", 30);
  const b = word("Hard", 25);
  const c = word("New", 0);
  const value = plan({
    words: [c, b, a],
    schedules: [newReviewSchedule("Due", new Date("2026-11-13T09:00:00.000Z"))],
    assignments: [{ day: 1, words: ["New", "Hard"] }],
    minutesAvailable: 9,
  });
  expect(value.tasks.map((task) => [task.kind, task.wordIds])).toEqual([
    ["due", ["Due"]], ["difficult", ["Hard"]], ["new", ["New"]],
  ]);
  expect(value.minutesPlanned).toBe(9);
});

test("learned words with due schedules are not forgotten", () => {
  const value = plan({
    words: [word("Mastered", 95)],
    schedules: [newReviewSchedule("Mastered", new Date("2026-11-13T09:00:00.000Z"))],
  });
  expect(value.selected.due).toBe(1);
  expect(value.tasks[0].wordIds).toEqual(["Mastered"]);
});

test("future-due words are never scheduled early as hard or new", () => {
  const future = rateReview(newReviewSchedule("Future", NOW), "good", NOW);
  const value = plan({
    words: [word("Future", 10)], schedules: [future],
    assignments: [{ day: 1, words: ["Future"] }],
  });
  expect(value.tasks).toEqual([]);
});

test("a missing schedule is not misidentified as a due review", () => {
  const value = plan({
    words: [word("New")], assignments: [{ day: 1, words: ["New"] }],
  });
  expect(value.selected).toEqual({ due: 0, difficult: 0, new: 1 });
});

test("manual day assignments and exclusions limit new-word recommendations", () => {
  const value = plan({
    words: [word("A"), word("B"), word("C"), word("D")],
    assignments: [{ day: 1, words: ["B", "A", "D"] }, { day: 2, words: ["C"] }],
    excludedWordIds: ["D"],
  });
  expect(value.tasks[0].wordIds).toEqual(["B", "A"]);
  expect(value.available.new).toBe(2);
});

test("unreviewed older zero-score words become catch-up difficult work", () => {
  const value = plan({
    words: [word("Old"), word("Today")], activeDay: 2,
    assignments: [{ day: 1, words: ["Old"] }, { day: 2, words: ["Today"] }],
  });
  expect(value.tasks.map((task) => task.kind)).toEqual(["difficult", "new"]);
});

test("unassigned unscheduled words do not enter the daily recommendation", () => {
  const value = plan({
    words: [word("Outside", 10), word("Inside", 10)],
    assignments: [{ day: 1, words: ["Inside"] }],
  });
  expect(value.tasks.flatMap((task) => task.wordIds)).toEqual(["Inside"]);
});

test("not-ready new words are reported instead of launched as playable", () => {
  const value = plan({
    words: [word("Incomplete", 0, false)],
    assignments: [{ day: 1, words: ["Incomplete"] }],
  });
  expect(value.selected.new).toBe(0);
  expect(value.needsEnrichment).toEqual(["Incomplete"]);
});

test("due items missing meanings are reported without being treated as completed", () => {
  const value = plan({
    words: [word("Incomplete", 90, false)],
    schedules: [newReviewSchedule("Incomplete", NOW)],
  });
  expect(value.needsReviewContent).toEqual(["Incomplete"]);
  expect(value.selected.due).toBe(0);
});

test("an entire selection is split into stable groups of at most five", () => {
  const words = Array.from({ length: 12 }, (_, i) => word(`W${i}`));
  const value = plan({
    words, assignments: [{ day: 1, words: words.map((w) => w.id) }],
    minutesAvailable: 60,
  });
  expect(value.tasks.map((task) => task.wordIds.length)).toEqual([5, 5, 2]);
  expect(value.selected.new).toBe(12);
  expect(value.minutesPlanned).toBe(48);
});

test("a short budget never schedules partial minutes or overflows", () => {
  const words = Array.from({ length: 10 }, (_, i) => word(`W${i}`));
  const value = plan({
    words, assignments: [{ day: 1, words: words.map((w) => w.id) }],
    minutesAvailable: 5,
  });
  expect(value.selected.new).toBe(1);
  expect(value.minutesPlanned).toBe(4);
  expect(value.minutesRemaining).toBe(1);
});

test("duplicate schedules and assignments cannot duplicate a task", () => {
  const value = plan({
    words: [word("Same"), word("Same")],
    schedules: [newReviewSchedule("Same", NOW), newReviewSchedule("Same", NOW)],
    assignments: [{ day: 1, words: ["Same", "Same"] }],
  });
  expect(value.tasks.flatMap((task) => task.wordIds)).toEqual(["Same"]);
});

test("source data remains untouched after generating recommendations", () => {
  const words = [word("Today")];
  const assignments = [{ day: 1, words: ["Today"] }];
  const snapshot = JSON.stringify({ words, assignments });
  plan({ words, assignments });
  expect(JSON.stringify({ words, assignments })).toBe(snapshot);
});

test("invalid time, day and date fail closed", () => {
  expect(() => plan({ minutesAvailable: 0 })).toThrow();
  expect(() => plan({ minutesAvailable: Number.NaN })).toThrow();
  expect(() => plan({ activeDay: 61 })).toThrow();
  expect(() => plan({ now: new Date("bad") })).toThrow();
});


test("scheduled words missing playable examples are flagged, never launched", () => {
  const incomplete = { ...word("PartiallyReady", 90), examples: [] };
  const value = plan({
    words: [incomplete],
    schedules: [newReviewSchedule("PartiallyReady", NOW)],
    assignments: [{ day: 1, words: ["PartiallyReady"] }],
  });
  expect(value.tasks).toHaveLength(0);
  expect(value.needsReviewContent).toEqual(["PartiallyReady"]);
});

test("scheduled due reviews override the new-word bucket without duplicating a word", () => {
  const fresh = word("Today", 0);
  const value = plan({
    words: [fresh],
    schedules: [newReviewSchedule("Today", NOW)],
    assignments: [{ day: 1, words: ["Today"] }],
  });
  expect(value.selected).toEqual({ due: 1, difficult: 0, new: 0 });
  expect(value.tasks.map((task) => task.kind)).toEqual(["due"]);
});
