import { describe, expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { WordExample } from "@/features/word-library/components/word-example";
import { AdditionalWordSense } from "@/features/word-library/components/word-details";
import { SentenceVocabularyProvider } from "@/features/word-library/components/sentence-word-tooltips";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";

const tiers = ["easy", "easy", "medium", "yds", "yds"] as const;
const nounSentences = [
  "This approach saves time.",
  "Our approach is simple.",
  "Scientists use a systematic approach to evaluating new evidence.",
  "Although this approach appears effective, the researchers acknowledge that additional controlled trials are necessary before the findings can guide national policy.",
  "A flexible approach to curriculum design may help institutions address widening educational inequalities while preserving the standards required for international accreditation.",
];
const verbSentences = [
  "We approach the gate.",
  "They approach the problem.",
  "Researchers approach the question from a historical perspective.",
  "As public funding becomes less predictable, universities must approach long-term infrastructure planning with greater caution to protect essential academic services.",
  "Educational authorities should approach curriculum reform as a sustained institutional process rather than an isolated response to short-term examination outcomes.",
];
const nounExamples = tiers.map((difficulty, i) => ({
  sentence: nounSentences[i], translation: "Bu yaklaşım yararlıdır.", translationFocus: ["yaklaşım"],
  difficulty,
}));
const verbExamples = tiers.map((difficulty, i) => ({
  sentence: verbSentences[i], translation: "Yaklaşmak önemlidir.", translationFocus: ["Yaklaşmak"],
  difficulty,
}));
const word: WordEntry = {
  ...starterVocabulary[0], word: "Approach", partOfSpeech: "Noun", meanings: ["yaklaşım"],
  id: "qa-approach", score: 0, createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z", examples: nounExamples,
  senses: [{
    partOfSpeech: "Verb", meanings: ["yaklaşmak"], usageNote: "", cefr: "B2", examples: verbExamples,
  }],
};
describe("2 easy / 1 medium / 2 YDS examples in library details", () => {
  test("all 5 tier badges are visible in canonical order with the correct Turkish names", () => {
    const html = renderToStaticMarkup(
      <SentenceVocabularyProvider words={[word]}>
        <div>{word.examples.map((example) => <WordExample key={example.sentence} word={word} example={example}/>)}</div>
      </SentenceVocabularyProvider>,
    );
    expect([...html.matchAll(/data-difficulty="([^"]+)"/g)].map(x => x[1])).toEqual(tiers);
    expect([...html.matchAll(/aria-label="Cümle seviyesi: ([^"]+)"/g)].map(x => x[1]))
      .toEqual(["Kolay", "Kolay", "Orta", "YDS", "YDS"]);
    expect((html.match(/data-testid="english-sentence-tooltips"/g)??[]).length).toBe(5);
  });
  test("secondary Verb Approach preserves its five-tier set and overrides primary Noun meaning", () => {
    const html = renderToStaticMarkup(
      <SentenceVocabularyProvider words={[word]}>
        <AdditionalWordSense word={word} sense={word.senses[0]}/>
      </SentenceVocabularyProvider>,
    );
    expect(html).toContain("Verb · yaklaşmak · 5 örnek");
    expect((html.match(/data-testid="word-example"/g)??[]).length).toBe(5);
    expect([...html.matchAll(/data-difficulty="([^"]+)"/g)].map(x => x[1])).toEqual(tiers);
    expect(html).toContain("approach: yaklaşmak");
    expect(html).not.toContain("approach: yaklaşım");
  });
  test("legacy unlabeled examples do not receive a fabricated difficulty badge", () => {
    const html=renderToStaticMarkup(<WordExample word={word}
      example={{sentence:"This approach is clear.",translation:"Bu yaklaşım açıktır."}}/>);
    expect(html).toContain('data-difficulty="unclassified"');
    expect(html).not.toContain('aria-label="Cümle seviyesi:');
  });
});
