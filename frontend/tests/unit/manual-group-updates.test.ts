import { describe, expect, test } from "bun:test";
import { getVisibleWordGroup, type WordEntry } from "@yds-atlas/shared";
import { applyManualGroupUpdates } from "../../src/features/word-library/model/manual-group-updates";

const now = "2026-11-14T19:00:00.000Z";
function entry(id: string, score: number): WordEntry {
  return {
    id, word: id, alternatives: [], meanings: ["meaning"], usageNote: "", partOfSpeech: "",
    cefr: "Belirtilmedi", score, examples: [], pronunciationUk: "", pronunciationUs: "",
    sourceUrl: "", createdAt: now, updatedAt: now,
  };
}

describe("v5C-F local manual-group integrity", () => {
  test("moving a low-score word into learned never forges a game score", () => {
    const words = applyManualGroupUpdates([entry("a", 15)], [{ id: "a", group: "learned" }]);
    expect(words[0]?.score).toBe(15);
    expect(words[0]?.manualGroup).toBe("learned");
    expect(getVisibleWordGroup(words[0]!)).toBe("learned");
  });
  test("existing score-based group remains when no manual label is set", () => {
    expect(getVisibleWordGroup(entry("a", 90))).toBe("learned");
    expect(getVisibleWordGroup(entry("b", 45))).toBe("review");
  });
  test("a multiword update preserves untouched scores and data", () => {
    const before = [entry("a", 20), entry("b", 45), entry("c", 90)];
    const after = applyManualGroupUpdates(before, [
      { id: "a", group: "review" }, { id: "c", group: "hard" },
    ], "2026-11-14T20:00:00.000Z");
    expect(after.map((word) => word.score)).toEqual([20, 45, 90]);
    expect(after[1]).toBe(before[1]);
    expect(before[0]?.manualGroup).toBeUndefined();
  });
  test("missing ID rejects all updates, no partial mutation", () => {
    const before = [entry("a", 20)];
    expect(() => applyManualGroupUpdates(before, [
      { id: "a", group: "learned" }, { id: "other", group: "hard" },
    ])).toThrow();
    expect(before[0]?.manualGroup).toBeUndefined();
  });
  test("duplicate, invalid and empty updates are rejected", () => {
    const words = [entry("a", 30)];
    expect(() => applyManualGroupUpdates(words, [])).toThrow();
    expect(() => applyManualGroupUpdates(words, [
      { id: "a", group: "hard" }, { id: "a", group: "review" },
    ])).toThrow();
    expect(() => applyManualGroupUpdates(words, [
      { id: "a", group: "unknown" as WordEntry["manualGroup"] as never },
    ])).toThrow();
  });
});
