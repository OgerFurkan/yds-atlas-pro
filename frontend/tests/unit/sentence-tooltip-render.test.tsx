import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EnglishChatSentenceTooltips, SentenceVocabularyProvider, SentenceWordTooltips,
} from "@/features/word-library/components/sentence-word-tooltips";

const entries = [
  { word: "Abandon", meanings: ["terk etmek"], partOfSpeech: "Verb", cefr: "B2" as const },
  { word: "Approach", meanings: ["yaklaşım"], partOfSpeech: "Noun", cefr: "B2" as const },
];

describe("sentence tooltip surfaces and assessment safety", () => {
  test("the whole English sentence has word buttons, with real library meanings", () => {
    const html = renderToStaticMarkup(
      <SentenceVocabularyProvider words={entries}>
        <SentenceWordTooltips text="They abandon the approach." />
      </SentenceVocabularyProvider>,
    );
    expect(html).toContain('data-testid="english-sentence-tooltips"');
    expect((html.match(/data-testid="sentence-word"/g) ?? []).length).toBe(4);
    expect(html).toContain("abandon: terk etmek");
    expect(html).toContain("approach: yaklaşım");
    expect(html).toContain("Kütüphanende henüz kayıtlı değil");
  });
  test("an Inspector result can provide the exact focused meaning before saving to the library", () => {
    const html = renderToStaticMarkup(
      <SentenceVocabularyProvider words={[]}>
        <SentenceWordTooltips text="We mitigate the problem." focusWord={{ word:"Mitigate", partOfSpeech:"Verb",meanings:["hafifletmek"] }} />
      </SentenceVocabularyProvider>,
    );
    expect(html).toContain("mitigate: hafifletmek");
    expect(html).toContain('<strong class="font-bold italic">mitigate</strong>');
  });
  test("game assessment disables vocabulary hints; didactic flashcard opt-in is explicit", () => {
    const denied = renderToStaticMarkup(
      <SentenceVocabularyProvider words={entries} enabled={false}>
        <SentenceWordTooltips text="They abandon the ship." />
      </SentenceVocabularyProvider>,
    );
    expect(denied).not.toContain('data-testid="sentence-word"');
    const taught = renderToStaticMarkup(
      <SentenceVocabularyProvider words={entries} enabled={false}>
        <SentenceWordTooltips text="They abandon the ship." allowDuringGame />
      </SentenceVocabularyProvider>,
    );
    expect(taught).toContain('data-testid="sentence-word"');
  });
  test("chat English gets tooltips, Turkish and code-like text stay untouched", () => {
    const html = renderToStaticMarkup(
      <SentenceVocabularyProvider words={entries}>
        <EnglishChatSentenceTooltips text="Bu örneği düşün. The students abandon the project." />
      </SentenceVocabularyProvider>,
    );
    expect(html).toContain("Bu örneği düşün.");
    expect(html).toContain('data-testid="sentence-word"');
    expect(html).toContain('abandon: terk etmek');
  });
});