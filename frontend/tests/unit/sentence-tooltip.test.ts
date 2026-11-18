import { describe, expect, test } from "bun:test";
import {
  buildVocabularyIndex, isLikelyEnglishSentence, matchVocabulary,
  splitChatSentenceSegments, splitSentenceWords, tooltipMeanings,
} from "@/features/word-library/model/sentence-tooltip";

const library = buildVocabularyIndex([
  { word: "Abandon", alternatives: [], meanings: ["terk etmek"], partOfSpeech: "Verb", cefr: "B2" },
  { word: "Approach", alternatives: [], meanings: ["yaklaşım"], partOfSpeech: "Noun",
    senses: [{partOfSpeech: "Verb",meanings:["yaklaşmak"],cefr:"B2",usageNote:"",examples:[{sentence:"They approach the problem.",translation:"Soruna yaklaşırlar."}]}] },
  { word: "Mitigate", alternatives: [], meanings: ["hafifletmek"], partOfSpeech: "Verb" },
]);

describe("safe sentence tooltip lexical matching", () => {
  test("punctuation, apostrophes, spaces and original byte positions remain intact", () => {
    const sentence = "They don't abandon their approach—ever!";
    const parts = splitSentenceWords(sentence);
    expect(parts.map(p => p.text).join("")).toBe(sentence);
    expect(parts.filter(p => p.kind === "word").map(p => p.text))
      .toEqual(["They", "don't", "abandon", "their", "approach", "ever"]);
  });
  test("legacy browser fixtures with numeral-suffixed headwords remain one interactive word", () => {
    const parts = splitSentenceWords("The atlasword0 appears in test context 1.");
    expect(parts.filter(p => p.kind === "word").map(p => p.text)).toContain("atlasword0");
    const index = buildVocabularyIndex([{word:"atlasword0",meanings:["test meaning"],partOfSpeech:"Noun"}]);
    expect(matchVocabulary("atlasword0", index)[0].meanings).toEqual(["test meaning"]);
  });
  test("known words have real meanings, senses and POS, unknown words are never fabricated", () => {
    expect(tooltipMeanings(matchVocabulary("Approach", library)[0]))
      .toEqual(["yaklaşım", "yaklaşmak"]);
    expect(matchVocabulary("abandon", library)[0].meanings).toEqual(["terk etmek"]);
    expect(matchVocabulary("quasar", library)).toEqual([]);
  });
  test("only conservative library-supported forms are resolved", () => {
    expect(matchVocabulary("approaches", library)[0].word).toBe("Approach");
    expect(matchVocabulary("abandoned", library)[0].word).toBe("Abandon");
    expect(matchVocabulary("mitigating", library)[0].word).toBe("Mitigate");
    expect(matchVocabulary("assistant", library)).toEqual([]);
  });
  test("Turkish explanatory text is not erroneously treated as English", () => {
    expect(isLikelyEnglishSentence("Bu cümledeki kelimeleri açıklayabilir misin?")).toBe(false);
    expect(isLikelyEnglishSentence("The students abandoned the project.")).toBe(true);
    expect(isLikelyEnglishSentence("const x = 1")).toBe(false);
  });
  test("mixed AI paragraphs preserve exact text and only label English sentences", () => {
    const input = "Önce açıklama. The students abandoned the project. Başka bir örnek.";
    const parts = splitChatSentenceSegments(input);
    expect(parts.map(p => p.text).join("")).toBe(input);
    expect(parts.filter(p => p.english)).toHaveLength(1);
  });
});