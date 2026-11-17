import { describe, expect, test } from "bun:test";
import {
  inspectorPath, inspectorResponseSchema, inspectorToWordInput,
  type InspectorEntry,
} from "../../src/features/word-inspector/api/word-inspector-api";
import {
  countInspectorTiers, inspectorSaveBelongsTo, matchingInspectorChoice,
} from "../../src/features/word-inspector/model/word-inspector-model";

const id = "c1111111-1111-4111-8111-111111111111";
const example = (sentence: string, difficulty: "easy" | "medium" | "yds") => ({
  sentence,
  difficulty,
  translation: "Bu sözcük elde etmek anlamına gelir.",
  translationFocus: ["elde etmek"],
});
const ready: InspectorEntry = {
  id,
  word: "obtain",
  meaning: "elde etmek",
  partOfSpeech: "Verb",
  revision: 4,
  status: "human_reviewed",
  senseKey: "a".repeat(64),
  meanings: ["elde etmek"],
  alternatives: ["obtained"],
  usageNote: "Resmî dilde kullanılır.",
  cefr: "B2",
  examples: [
    example("We obtain results.", "easy"),
    example("They obtain a permit.", "easy"),
    example("Students obtain documents before submitting applications.", "medium"),
    example("Applicants should obtain the relevant approvals before the process begins.", "yds"),
    example("The researchers obtained a sufficiently large sample to support their conclusions.", "yds"),
  ],
  pronunciationUk: "/əbˈteɪn/",
  pronunciationUs: "/əbˈteɪn/",
};

describe("F4b Word Inspector cache-only UI contracts", () => {
  test("builds only encoded GET inspector path", () => {
    expect(inspectorPath({ word: "  TAKE   OFF  " })).toBe("/api/lexicon/inspect?word=take+off");
    expect(inspectorPath({ word: "obtain", partOfSpeech: "Verb", meaning: "elde etmek" }))
      .toContain("partOfSpeech=Verb&meaning=elde+etmek");
  });
  test("invalid input is rejected before any request", () => {
    for (const word of ["", "abc/../../admin", "a".repeat(121), "🚨", "../admin"])
      expect(() => inspectorPath({ word })).toThrow();
  });
  test("meaning requires explicit part of speech", () => {
    expect(() => inspectorPath({ word: "obtain", meaning: "elde etmek" })).toThrow();
    expect(() => inspectorPath({ word: "obtain", partOfSpeech: "Unspecified" })).toThrow();
    expect(() => inspectorPath({ word: "obtain", partOfSpeech: "Verb", meaning: " " })).toThrow();
  });
  test("full 2/1/2 ready response validates", () => {
    const result = inspectorResponseSchema.parse({ status: "ready", word: "obtain", entry: ready });
    expect(result.status).toBe("ready");
    expect(countInspectorTiers(ready)).toEqual({ easy: 2, medium: 1, yds: 2 });
  });
  test("missing and ambiguous responses are distinct", () => {
    expect(inspectorResponseSchema.parse({ status: "missing", word: "obtain" }).status).toBe("missing");
    const option = (({ id, word, meaning, partOfSpeech, revision, status }: InspectorEntry) =>
      ({ id, word, meaning, partOfSpeech, revision, status }))(ready);
    expect(inspectorResponseSchema.parse({ status: "choices", word: "obtain", choices: [option, { ...option, id: "d2222222-2222-4222-8222-222222222222" }] }).status).toBe("choices");
  });
  test("incomplete tier set is rejected, never partially displayed", () => {
    expect(() => inspectorResponseSchema.parse({ status: "ready", word: "obtain", entry: {
      ...ready, examples: ready.examples.slice(0, 4),
    } })).toThrow();
  });
  test("duplicate tiers and invalid translation focus are rejected", () => {
    expect(() => inspectorResponseSchema.parse({ status: "ready", word: "obtain", entry: {
      ...ready, examples: ready.examples.map((x) => ({ ...x, difficulty: "easy" })),
    } })).toThrow();
    expect(() => inspectorResponseSchema.parse({ status: "ready", word: "obtain", entry: {
      ...ready, examples: ready.examples.map((x, i) => i === 0 ? { ...x, translationFocus: ["başka"] } : x),
    } })).toThrow();
  });
  test("rejects raw provenance, admin and source URL fields", () => {
    expect(() => inspectorResponseSchema.parse({ status: "ready", word: "obtain", entry: {
      ...ready, provenance: { prompt: "secret" },
    } })).toThrow();
    expect(() => inspectorResponseSchema.parse({ status: "ready", word: "obtain", entry: {
      ...ready, sourceUrl: "https://example.com/private",
    } })).toThrow();
  });
  test("quarantined records are rejected", () => {
    expect(() => inspectorResponseSchema.parse({ status: "ready", word: "obtain", entry: {
      ...ready, status: "quarantined",
    } })).toThrow();
  });
  test("choice identity requires id, revision, POS and meaning", () => {
    const choice = { id, revision: 4, word: "obtain", partOfSpeech: "Verb" as const, meaning: "elde etmek", status: "human_reviewed" as const };
    expect(matchingInspectorChoice(choice, choice)).toBe(true);
    expect(matchingInspectorChoice(choice, { ...choice, revision: 5 })).toBe(false);
    expect(matchingInspectorChoice(choice, null)).toBe(false);
  });
  test("personal-library mapping retains word identity and score zero without provenance", () => {
    const mapped = inspectorToWordInput(ready);
    expect(mapped.score).toBe(0);
    expect(mapped.lexicon).toEqual({ entryId: id, revision: 4, contractVersion: 1 });
    expect(mapped.sourceUrl).toBe("");
    expect(mapped.examples?.length).toBe(5);
    expect("provenance" in mapped).toBe(false);
  });
  test("library mapping does not mutate canonical Inspector entry", () => {
    const mapped = inspectorToWordInput(ready);
    mapped.meanings?.push("başka anlam");
    mapped.examples?.[0]?.translationFocus?.push("başka");
    expect(ready.meanings).toEqual(["elde etmek"]);
    expect(ready.examples[0].translationFocus).toEqual(["elde etmek"]);
  });
  test("late save result is tied to the same entry revision", () => {
    expect(inspectorSaveBelongsTo(ready, { id, revision: 4 })).toBe(true);
    expect(inspectorSaveBelongsTo(ready, { id, revision: 5 })).toBe(false);
    expect(inspectorSaveBelongsTo(null, { id, revision: 4 })).toBe(false);
  });
});
