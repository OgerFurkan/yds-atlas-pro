import { expect, test } from "bun:test";
import { ATLAS_TIER_ORDER, hasAtlasTiers } from "@/features/word-library/model/tiered-examples";

const examples = ATLAS_TIER_ORDER.map((difficulty, index) => ({
  sentence: `Researchers obtain evidence in study ${index + 1}.`,
  translation: `Araştırmacılar ${index + 1}. çalışmada kanıt elde eder.`,
  translationFocus: ["elde eder"],
  difficulty,
}));
test("new words require 2 easy, 1 medium and 2 YDS examples in that order", () => {
  expect([...ATLAS_TIER_ORDER]).toEqual(["easy", "easy", "medium", "yds", "yds"]);
  expect(hasAtlasTiers(examples)).toBe(true);
  expect(hasAtlasTiers(examples.slice(0, 4))).toBe(false);
  expect(hasAtlasTiers(examples.map((e, i) => i === 2 ? { ...e, difficulty: "easy" } : e))).toBe(false);
});
test("translations must contain the focus, and hand-authored examples are retained after the canonical set", () => {
  expect(hasAtlasTiers(examples.map((e, i) => i === 1 ? { ...e, translationFocus: ["uydurma"] } : e))).toBe(false);
  expect(hasAtlasTiers([...examples, {sentence:"We obtain new facts.",translation:"Yeni bilgiler elde ederiz.",translationFocus:["elde ederiz"],difficulty:"easy"}])).toBe(true);
});
