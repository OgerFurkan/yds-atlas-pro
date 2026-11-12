import { expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import {
  buildDailyPlan,
  clampDailyGroupSize,
  DAILY_PLAN_DAYS,
  MAX_DAILY_GROUP_SIZE,
  MIN_DAILY_GROUP_SIZE,
} from "@/features/word-library/model/daily-groups";

function word(value: string, score: number, index: number): WordEntry {
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return {
    id: value.toLowerCase(),
    word: value,
    alternatives: [],
    meanings: [`${value} anlamı`],
    usageNote: "",
    partOfSpeech: "",
    cefr: "B1",
    score,
    examples: Array.from({ length: 5 }, (_, exampleIndex) => ({
      sentence: `We use ${value} in example ${exampleIndex}.`,
      translation: "",
    })),
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt,
    updatedAt: createdAt,
  };
}

test("daily plan keeps 60 days and clamps the group size to 10–40 words", () => {
  const words = Array.from({ length: 45 }, (_, index) => word(`Word${index}`, 0, index));
  const plan = buildDailyPlan(words, 50);
  expect(plan.groups).toHaveLength(DAILY_PLAN_DAYS);
  expect(plan.groupSize).toBe(MAX_DAILY_GROUP_SIZE);
  expect(plan.groups[0].total).toBe(MAX_DAILY_GROUP_SIZE);
  expect(plan.groups[0].words[0].word).toBe("Word0");
  expect(plan.groups[1].total).toBe(5);
  expect(plan.activeDays).toBe(2);
  expect(plan.totalWords).toBe(45);
  expect(clampDailyGroupSize(1)).toBe(MIN_DAILY_GROUP_SIZE);
  expect(clampDailyGroupSize(Number.NaN)).toBe(20);
});

test("group statistics expose learned, hard, review and playable words", () => {
  const words = [
    ...Array.from({ length: 15 }, (_, index) => word(`Learned${index}`, 90, index)),
    ...Array.from({ length: 3 }, (_, index) => word(`Hard${index}`, 10, 15 + index)),
    ...Array.from({ length: 2 }, (_, index) => word(`Review${index}`, 50, 18 + index)),
  ];
  const plan = buildDailyPlan(words, 20);
  const group = plan.groups[0];
  expect(group.total).toBe(20);
  expect(group.learned).toBe(15);
  expect(group.hard).toBe(3);
  expect(group.review).toBe(2);
  expect(group.playable).toBe(5);
  expect(group.progress).toBe(0.75);
  expect(plan.completedDays).toBe(0);
  expect(
    buildDailyPlan(
      words.map((item) => ({ ...item, score: 90 })),
      20,
    ).completedDays,
  ).toBe(1);
});

test("empty days stay empty and completed groups have no playable words", () => {
  const empty = buildDailyPlan([], 20);
  expect(empty.groups.every((group) => group.total === 0)).toBe(true);
  expect(empty.activeDays).toBe(0);
  expect(empty.completedDays).toBe(0);
  expect(empty.overflow).toBe(0);

  const words = Array.from({ length: 20 }, (_, index) => word(`Done${index}`, 90, index));
  const plan = buildDailyPlan(words, 20);
  expect(plan.completedDays).toBe(1);
  expect(plan.groups[0].playable).toBe(0);
  expect(plan.groups[0].playableWords).toEqual([]);
});

test("words beyond the 60-day capacity are reported as overflow", () => {
  const words = Array.from({ length: 601 }, (_, index) => word(`Extra${index}`, 0, index));
  const plan = buildDailyPlan(words, MIN_DAILY_GROUP_SIZE);
  expect(plan.totalWords).toBe(600);
  expect(plan.activeDays).toBe(60);
  expect(plan.overflow).toBe(1);
});
