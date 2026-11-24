import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalQuery,
  meaningKey,
  projectEntry,
  selectEntries,
  validEntry,
} from "../../../backend/src/features/feedback/inspector-validation.ts";

const examples = ["easy", "easy", "medium", "yds", "yds"].map((difficulty, index) => ({
  sentence:
    difficulty === "yds"
      ? `The university researchers obtain valuable evidence through careful analysis of historical records, shared datasets, and robust scientific methods during the project ${index + 1}.`
      : `Students obtain useful knowledge in lesson ${index + 1}.`,
  translation: `Öğrenciler ${index + 1} derste faydalı bilgi elde eder.`,
  difficulty,
  translationFocus: ["elde eder"],
}));
const content = {
  word: "obtain",
  partOfSpeech: "Verb",
  meanings: ["elde etmek"],
  alternatives: [],
  usageNote: "",
  cefr: "B2",
  examples,
  pronunciationUk: "",
  pronunciationUs: "",
};
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  word_key: "obtain",
  part_of_speech: "Verb",
  sense_key: meaningKey("elde etmek"),
  revision: 1,
  status: "machine_validated",
  content,
};
test("real source parses explicit normalized query", () =>
  assert.equal(canonicalQuery({ word: "  ＯＢＴＡＩＮ  " }).word, "obtain"));
test("meaning without part of speech rejected", () =>
  assert.throws(() => canonicalQuery({ word: "obtain", meaning: "elde etmek" }), /INVALID_SENSE/));
test("malformed word rejected", () =>
  assert.throws(() => canonicalQuery({ word: "../admin" }), /INVALID_WORD/));
test("verified 2/1/2 examples accepted", () => assert.equal(validEntry(row), true));
test("wrong sense rejected", () =>
  assert.equal(validEntry({ ...row, sense_key: "a".repeat(64) }), false));
test("duplicate sentence rejected", () =>
  assert.equal(
    validEntry({
      ...row,
      content: { ...content, examples: [examples[0], examples[0], ...examples.slice(2)] },
    }),
    false,
  ));
test("wrong tier order rejected", () =>
  assert.equal(
    validEntry({ ...row, content: { ...content, examples: [...examples].reverse() } }),
    false,
  ));
test("quarantine rejected", () =>
  assert.equal(validEntry({ ...row, status: "quarantined" }), false));
test("translation focus must be present in translation", () =>
  assert.equal(
    validEntry({
      ...row,
      content: {
        ...content,
        examples: [{ ...examples[0], translationFocus: ["not there"] }, ...examples.slice(1)],
      },
    }),
    false,
  ));
test("cache miss never manufactures entry", () =>
  assert.deepEqual(selectEntries([], { word: "obtain" }), { status: "missing", word: "obtain" }));
test("ambiguous senses require explicit choice", () => {
  const other = {
    ...row,
    id: "22222222-2222-4222-8222-222222222222",
    sense_key: meaningKey("kazanmak"),
    content: { ...content, meanings: ["kazanmak"] },
  };
  assert.equal(selectEntries([row, other], { word: "obtain" }).status, "choices");
  assert.equal(
    selectEntries([row, other], { word: "obtain", partOfSpeech: "Verb", meaning: "kazanmak" })
      .status,
    "ready",
  );
});
test("public projection never exposes raw provenance, digest or owner", () => {
  const p = projectEntry({
    ...row,
    provenance: { private: true },
    digest: "secret",
    owner: "sensitive",
  });
  assert.equal("provenance" in p, false);
  assert.equal("digest" in p, false);
  assert.equal("owner" in p, false);
});
test("public projection copies nested examples", () => {
  const p = projectEntry(row);
  p.examples[0].translationFocus[0] = "changed";
  assert.equal(row.content.examples[0].translationFocus[0], "elde eder");
});
