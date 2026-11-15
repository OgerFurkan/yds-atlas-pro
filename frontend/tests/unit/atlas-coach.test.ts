import { expect, test } from "bun:test";
import type { WordEntry, LearningObservation } from "@yds-atlas/shared";
import { buildCoachAgenda, localDay, validCalendarDay } from "@/features/progress/model/coach-planner";
import { newReviewSchedule, rateReview } from "@/features/review/model/spaced-repetition";

const NOW = new Date("2026-11-15T12:00:00.000Z");
function observed(wordId: string, sessionId: string, score: number, completedAt = NOW.toISOString(),
  meaningCorrect: boolean | null = null, contextCorrect: boolean | null = null): LearningObservation {
  return {wordId,sessionId,score,completedAt,meaningCorrect,contextCorrect,matchingErrors:null,
    meaningConfidence:null,contextConfidence:null};
}
function word(id: string, score = 0, ready = true): WordEntry {
  return {
    id, word: id, score, alternatives: [], meanings: ready ? ["anlam"] : [],
    usageNote: "", partOfSpeech: "noun", senses: [], cefr: "B2",
    pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    examples: ready ? Array.from({ length: 5 }, (_, i) => ({ sentence: `Valid ${id} example ${i}.`, translation: "" })) : [],
  };
}
function plan(overrides: Partial<Parameters<typeof buildCoachAgenda>[0]> = {}) {
  return buildCoachAgenda({ words: [], schedules: [], now: NOW, minutesAvailable: 30, ...overrides });
}
test("coach scans the whole library without a day number", () => {
  const result = plan({ words: [word("GlobalNew")], minutesAvailable: 20 });
  expect(result.tasks[0].wordIds).toEqual(["GlobalNew"]);
  expect(result.tasks[0].kind).toBe("new");
});
test("due beats risky and new words across all groups", () => {
  const result = plan({
    words: [word("New"), word("Risk", 20), word("Due", 90)],
    schedules: [newReviewSchedule("Due", new Date("2026-11-14T11:00:00Z"))], minutesAvailable: 9,
  });
  expect(result.tasks.map((task) => task.kind)).toEqual(["due", "recover", "new"]);
  expect(result.minutesPlanned).toBe(9);
});
test("not-due schedules are protected and never pulled forward", () => {
  const future = rateReview(newReviewSchedule("Future", NOW), "good", NOW);
  const result = plan({ words: [word("Future", 10)], schedules: [future] });
  expect(result.tasks).toEqual([]);
});
test("unassessed zero receives a first-look task, not a fabricated failure", () => {
  const result = plan({ words: [word("Zero", 0), word("Weak", 30)] });
  expect(result.tasks.map((task) => task.kind)).toEqual(["recover", "new"]);
});
test("learned word still appears when its review is due", () => {
  const result = plan({ words: [word("Mastered", 95)], schedules: [newReviewSchedule("Mastered", NOW)] });
  expect(result.tasks[0].wordIds).toEqual(["Mastered"]);
});
test("duplicate due entries do not duplicate tasks", () => {
  const a = newReviewSchedule("A", NOW);
  const result = plan({ words: [word("A")], schedules: [a, a] });
  expect(result.tasks.flatMap((task) => task.wordIds)).toEqual(["A"]);
});
test("missing content prevents a fake playable due task", () => {
  const result = plan({ words: [word("Broken", 20, false)], schedules: [newReviewSchedule("Broken", NOW)] });
  expect(result.tasks).toEqual([]);
  expect(result.blockedDueCount).toBe(1);
});
test("time budgets are respected and tasks are batched in fives", () => {
  const result = plan({ words: Array.from({ length: 19 }, (_, i) => word(`W${i}`)), minutesAvailable: 60 });
  expect(result.tasks.every((task) => task.wordIds.length <= 5)).toBe(true);
  expect(result.minutesPlanned + result.minutesRemaining).toBe(60);
  expect(result.tasks.flatMap((task) => task.wordIds).length).toBe(15);
});
test("no schedule does not invent a due review", () => {
  const result = plan({ words: [word("NoSchedule", 20)] });
  expect(result.dueCount).toBe(0);
  expect(result.tasks[0].kind).toBe("recover");
});
test("empty library is safe and non-destructive", () => {
  const result = plan();
  expect(result.tasks).toEqual([]);
  expect(result.minutesRemaining).toBe(30);
});
test("calendar validates leap dates and excludes invalid date formats", () => {
  expect(validCalendarDay("2028-02-29")).toBe(true);
  expect(validCalendarDay("2027-02-29")).toBe(false);
  expect(validCalendarDay("2026-2-01")).toBe(false);
  expect(localDay(new Date(2026, 10, 15))).toBe("2026-11-15");
});
test("invalid budget fails closed", () => {
  expect(() => plan({ minutesAvailable: 0 })).toThrow();
  expect(() => plan({ minutesAvailable: Number.NaN })).toThrow();
  expect(() => plan({ now: new Date("invalid") })).toThrow();
});

test("repeated low scores in real game outcomes promote strengthening to recovery", () => {
  const one = word("Habit", 50);
  const result = plan({
    words: [one],
    assessments: [
      observed("Habit", "s1", 25, "2026-11-13T12:00:00.000Z"),
      observed("Habit", "s2", 35, "2026-11-14T12:00:00.000Z"),
    ],
  });
  expect(result.tasks[0].kind).toBe("recover");
});

test("a verified failed zero becomes recovery, never an unassessed new word", () => {
  const result = plan({ words: [word("Failed", 0)],
    assessments: [observed("Failed","s1",0, NOW.toISOString(),false,false)] });
  expect(result.tasks[0].kind).toBe("recover");
  expect(result.newCount).toBe(0);
});
test("manually labeled learned does not upgrade evidence or remove due reviews", () => {
  const entry = {...word("Labeled", 0),manualGroup:"learned" as const};
  const result = plan({ words:[entry],schedules:[newReviewSchedule("Labeled",NOW)] });
  expect(result.tasks[0].kind).toBe("due");
});
test("context weakness changes exercise explanation, not score or mastery", () => {
  const value = plan({ words:[word("ContextWeak",20)],
    assessments:[observed("ContextWeak","s1",30,NOW.toISOString(),true,false)] });
  expect(value.tasks[0].reason).toContain("bağlam");
  expect(value.contextualDifficultyCount).toBe(1);
});
test("no word is assigned to more than one coach task", () => {
  const entries = Array.from({length:11},(_,i)=>word(`W${i}`,i<3?30:0));
  const value=plan({words:entries,schedules:[newReviewSchedule("W0",NOW)],minutesAvailable:60});
  const ids=value.tasks.flatMap(task=>task.wordIds);
  expect(new Set(ids).size).toBe(ids.length);
});
test("duplicate library IDs fail instead of inflating recommendations", () => {
  expect(()=>plan({words:[word("A"),word("A")]})).toThrow();
});

test("seeded 300-case property check: no duplicates, no budget overflow, future due never early", () => {
  let seed = 20261115;
  function rand() { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }
  for (let iteration=0; iteration<300; iteration++) {
    const count = 5 + Math.floor(rand()*36);
    const words = Array.from({length:count},(_,i)=>word(`F${iteration}_${i}`,Math.floor(rand()*101)));
    const future=rateReview(newReviewSchedule(words[0].id,NOW),"good",NOW);
    const due=newReviewSchedule(words[1].id,new Date("2026-11-14T10:00:00Z"));
    const budget=[15,20,30,45,60,90][Math.floor(rand()*6)];
    const result=plan({words,schedules:[future,due],minutesAvailable:budget});
    const ids=result.tasks.flatMap(x=>x.wordIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.includes(words[0].id)).toBe(false);
    expect(result.minutesPlanned + result.minutesRemaining).toBe(budget);
    expect(result.tasks.every(x=>x.wordIds.length<=5&&x.wordIds.length>0)).toBe(true);
    expect(result.minutesRemaining>=0).toBe(true);
  }
});

test("invalid confidence record fails closed before the coach can suggest", () => {
  const invalid = { ...observed("Bad","s1",15),meaningConfidence:999 as never };
  expect(()=>plan({words:[word("Bad")],assessments:[invalid]})).toThrow();
});
