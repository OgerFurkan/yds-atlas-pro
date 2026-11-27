import { expect, test } from "bun:test";
import {
  buildDailyPlan,
  isDayStudyReady,
  reviewableWords,
} from "../../../frontend/src/features/word-library/model/daily-groups";
import { dayStudyState } from "../../../frontend/src/features/word-library/model/day-study-state";
import {
  fixtureSource,
  incompleteDayWords,
  partiallyLearnedDayWords,
  readyDayWords,
} from "../fixtures/day-study-words";

test("all 20 synthetic words meet game readiness and have five sourced, translated tier examples", () => {
  expect(readyDayWords).toHaveLength(20);
  expect(new Set([...readyDayWords, ...incompleteDayWords].map((word) => word.id)).size).toBe(24);
  for (const word of readyDayWords) {
    expect(isDayStudyReady(word)).toBe(true);
    expect(word.examples.map((example) => example.difficulty)).toEqual([
      "easy",
      "easy",
      "medium",
      "yds",
      "yds",
    ]);
    expect(
      word.examples.every((example) => example.translation && example.source === fixtureSource),
    ).toBe(true);
    expect(word.score).toBe(0);
  }
});

test("the LOCAL 5 learned / 15 remaining variant studies 15 words and reviews all 20", () => {
  expect(partiallyLearnedDayWords).toHaveLength(20);
  const group = buildDailyPlan(partiallyLearnedDayWords, 20, [
    { day: 1, words: partiallyLearnedDayWords.map((word) => word.id) },
  ]).groups[0];
  expect(group.total).toBe(20);
  expect(group.learned).toBe(5);
  expect(group.playable).toBe(15);
  expect(group.playableWords.map((word) => word.id)).toEqual(
    partiallyLearnedDayWords.slice(5).map((word) => word.id),
  );
  expect(group.playableWords.every((word) => isDayStudyReady(word))).toBe(true);
  expect(dayStudyState(group, "available", false, false)).toBe("ready");
  expect(reviewableWords(group)).toHaveLength(20);
});

test("readiness gives playable words priority and gates empty preparation on live word AI", () => {
  const incomplete = buildDailyPlan(incompleteDayWords).groups[0];
  const mixed = buildDailyPlan([...incompleteDayWords, readyDayWords[4]]).groups[0];
  expect(incomplete.playable).toBe(0);
  expect(dayStudyState(mixed, "offline", false, false)).toBe("partial");
  expect(dayStudyState(incomplete, "checking", true, false)).toBe("checking");
  expect(dayStudyState(incomplete, "offline", true, false)).toBe("offline");
  expect(dayStudyState(incomplete, "cooldown", true, false)).toBe("cooldown");
  expect(dayStudyState(incomplete, "not-configured", true, false)).toBe("not-configured");
  expect(dayStudyState(incomplete, "available", false, false)).toBe("guest");
  expect(dayStudyState(incomplete, "available", true, true)).toBe("task-active");
  expect(dayStudyState(incomplete, "available", true, false)).toBe("prepare");
});
