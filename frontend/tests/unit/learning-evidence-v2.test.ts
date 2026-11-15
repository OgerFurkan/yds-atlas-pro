import { expect, test } from "bun:test";
import { summarizeLearningEvidence, type LearningObservation } from "@yds-atlas/shared";

const NOW = new Date("2026-11-15T12:00:00.000Z");
function evidence(id: string, sessionId: string, day: number, score: number,
    meaningCorrect: boolean | null = true, contextCorrect: boolean | null = true): LearningObservation {
  return { wordId: id, sessionId, completedAt: `2026-11-${String(day).padStart(2,"0")}T09:00:00.000Z`,
    score, meaningCorrect, contextCorrect, matchingErrors: 0,
    meaningConfidence: meaningCorrect ? 20 : null, contextConfidence: contextCorrect ? 0 : null };
}
test("no evidence is not fake mastery", () => {
  const s = summarizeLearningEvidence("A", [], NOW);
  expect(s.state).toBe("not-assessed");
  expect(s.lastScore).toBeNull();
  expect(s.dataQuality).toBe("none");
});
test("one perfect session never proves durable memory", () => {
  expect(summarizeLearningEvidence("A", [evidence("A","s1",15,100)], NOW).state).toBe("building");
});
test("three detailed successes on different days only yield repeated-success evidence", () => {
  const s = summarizeLearningEvidence("A", [evidence("A","s1",12,90), evidence("A","s2",14,85), evidence("A","s3",15,95)], NOW);
  expect(s.state).toBe("repeated-success");
  expect(s.observedDays).toBe(3);
});
test("same-day repetitions cannot count as multi-day retained evidence", () => {
  const rows = [evidence("A","s1",15,90), evidence("A","s2",15,91), evidence("A","s3",15,92)];
  expect(summarizeLearningEvidence("A", rows, NOW).state).toBe("building");
});
test("recent failure changes state without deleting history", () => {
  const s = summarizeLearningEvidence("A", [evidence("A","s1",12,90), evidence("A","s2",13,90), evidence("A","s3",15,0,false,false)], NOW);
  expect(s.state).toBe("recover");
  expect(s.observedSessions).toBe(3);
  expect(s.meaningErrors).toBe(1);
  expect(s.contextErrors).toBe(1);
});
test("context weakness reported only with actual per-question evidence", () => {
  const s = summarizeLearningEvidence("A", [evidence("A","s1",15,25,true,false)], NOW);
  expect(s.errorFocus).toBe("context");
  expect(s.dataQuality).toBe("detailed");
});
test("legacy score provides no fabricated context answers", () => {
  const s = summarizeLearningEvidence("A", [evidence("A","s1",15,20,null,null)], NOW);
  expect(s.errorFocus).toBe("unknown");
  expect(s.supportedContextObservations).toBe(0);
});
test("same session sent twice cannot improve mastery", () => {
  const s = summarizeLearningEvidence("A", [evidence("A","s1",15,90),evidence("A","s1",15,90)],NOW);
  expect(s.observedSessions).toBe(1);
});
test("contradictory same-session data fail closed", () => {
  expect(() => summarizeLearningEvidence("A", [evidence("A","s1",15,90),evidence("A","s1",15,10)],NOW)).toThrow();
});
test("future-dated work is not credited", () => {
  const s = summarizeLearningEvidence("A", [evidence("A","s1",20,100)],NOW);
  expect(s.observedSessions).toBe(0);
});
test("invalid score and date fail closed", () => {
  expect(() => summarizeLearningEvidence("A", [evidence("A","s1",15,120)],NOW)).toThrow();
  expect(() => summarizeLearningEvidence("A", [{...evidence("A","s1",15,90),completedAt:"invalid"}],NOW)).toThrow();
});


test("different-day failure never substitutes for an independent successful day", () => {
  const rows = [
    evidence("A", "older-failure", 14, 20, false, false),
    evidence("A", "success-1", 15, 90),
    evidence("A", "success-2", 15, 90),
    evidence("A", "success-3", 15, 90),
  ];
  expect(summarizeLearningEvidence("A", rows, NOW).state).toBe("building");
});

test("old detailed failures never turn recent legacy-only high scores into verified success", () => {
  const olderFailures = [8, 9, 10].map((day) =>
    evidence("A", `old-${day}`, day, 20, false, false));
  const recentLegacy = [11, 12, 13, 14, 15].map((day) =>
    evidence("A", `legacy-${day}`, day, 90, null, null));
  expect(summarizeLearningEvidence("A", [...olderFailures, ...recentLegacy], NOW).state).toBe("building");
});

// Regression: a UTC-midnight crossover must never create false spaced mastery.
test("three successful attempts within four hours across UTC midnight stay building in Istanbul", () => {
  const samples = [
    "2026-11-14T21:30:00.000Z", // 15 Nov 00:30 local
    "2026-11-14T23:40:00.000Z", // 15 Nov 02:40 local
    "2026-11-15T01:15:00.000Z", // 15 Nov 04:15 local
  ].map((completedAt, index) => ({
    ...evidence("A", `tz-${index}`, 15, 90), completedAt,
  }));
  const result = summarizeLearningEvidence("A", samples, NOW, "Europe/Istanbul");
  expect(result.observedDays).toBe(1);
  expect(result.state).toBe("building");
  // Even UTC calendar-day counting is insufficient without independent spacing.
  expect(summarizeLearningEvidence("A", samples, NOW, "UTC").state).toBe("building");
});

test("separate Istanbul study days with >=24h independent recall may build repeated success", () => {
  const result = summarizeLearningEvidence("A", [
    evidence("A", "s1", 12, 90), evidence("A", "s2", 14, 90), evidence("A", "s3", 15, 90),
  ], NOW, "Europe/Istanbul");
  expect(result.observedDays).toBe(3);
  expect(result.state).toBe("repeated-success");
});

test("crossing local midnight minutes apart does not count as independent recall", () => {
  const rows = [
    "2026-11-14T20:55:00.000Z", // 14 Nov 23:55 in Istanbul
    "2026-11-14T21:05:00.000Z", // 15 Nov 00:05 in Istanbul
    "2026-11-14T23:15:00.000Z", // 15 Nov 02:15 in Istanbul
  ].map((completedAt, i) => ({...evidence("A", `midnight-${i}`, 15, 92), completedAt}));
  const result = summarizeLearningEvidence("A", rows, NOW, "Europe/Istanbul");
  expect(result.observedDays).toBe(2);
  expect(result.state).toBe("building");
});

test("DST fall-back same local day and invalid timezone fail safely", () => {
  const samples = [
    "2026-11-01T04:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
    "2026-11-01T07:30:00.000Z",
  ].map((completedAt, i) => ({...evidence("A", `dst-${i}`, 15, 90), completedAt}));
  expect(summarizeLearningEvidence("A", samples, NOW, "America/New_York").observedDays).toBe(1);
  expect(summarizeLearningEvidence("A", samples, NOW, "America/New_York").state).toBe("building");
  expect(() => summarizeLearningEvidence("A", samples, NOW, "Not/A_Real_Zone")).toThrow();
});
