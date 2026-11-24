import { expect, test } from "bun:test";
import {
  CURATED_LEGACY_WORDS,
  curatedLegacyExamples,
} from "../../../frontend/src/features/word-library/data/legacy-curated-examples";
import { hasAtlasTiers } from "../../../frontend/src/features/word-library/model/tiered-examples";

test("six QA screenshot words have 30 original graded and translated examples", () => {
  expect(CURATED_LEGACY_WORDS).toHaveLength(6);
  for (const word of CURATED_LEGACY_WORDS) {
    const curated = curatedLegacyExamples(word);
    expect(curated?.examples).toHaveLength(5);
    expect(hasAtlasTiers(curated?.examples)).toBe(true);
    for (const [index, example] of (curated?.examples ?? []).entries()) {
      expect(example.sentence.toLowerCase()).toContain(word);
      expect(example.translationFocus?.every((focus) => example.translation.includes(focus))).toBe(
        true,
      );
      if (index >= 3) expect(example.sentence.length).toBeGreaterThan(80);
    }
  }
});
test("unreviewed words cannot be falsely presented as editor-reviewed", () => {
  expect(curatedLegacyExamples("fictionalmadeupword")).toBeNull();
});
