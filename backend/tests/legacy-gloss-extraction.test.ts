import { expect, test } from "bun:test";
import { extractGlossKeys } from "../src/features/lexicon/persistent-tooltip-queue";

test("the 425-sentence history scan reaches the final batch and retains lowercase initial", () => {
  // Synthetic sentences only. No personal text, DB, API or background worker.
  const sentences = Array.from(
    { length: 425 },
    () => "The learners compare evidence in carefully written sentences.",
  );
  sentences[424] = "Learners discuss initial evidence in context.";
  const keys = extractGlossKeys(sentences);
  expect(keys).toContain("initial");
  expect(keys).toContain("evidence");
  expect(keys).not.toContain("The");
  expect(keys).not.toContain(sentences[424]);
  expect(new Set(keys).size).toBe(keys.length);
});

test("historic token extraction excludes possible personal names, URLs and emails", () => {
  const keys = extractGlossKeys([
    "Alice discusses initial evidence with Bob.",
    "Review initial reports at https://example.org/private and alice@example.org.",
    "Data for @someone must remain private; initial information is discussed.",
  ]);
  expect(keys).toContain("initial");
  for (const sensitive of ["alice", "bob", "https", "example", "someone"])
    expect(keys).not.toContain(sensitive);
  expect(keys.every((key) => /^[a-z]+(?:[-'][a-z]+)?$/.test(key))).toBe(true);
});
