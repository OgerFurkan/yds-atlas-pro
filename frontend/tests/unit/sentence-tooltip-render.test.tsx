import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuizPanel } from "@/features/learning-game/components/quiz-panel";
import { ChatMessageMarkdown } from "@/features/ai-chat/components/chat-message-markdown";
import { createSession } from "@/features/learning-game/model/game-engine";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
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
describe("answered game context can reveal words without leaking pre-answer hints", () => {
  test("assessment question hides vocabulary tooltips until answer, then shows safe sentence explanations", () => {
    const seed = starterVocabulary.find((entry) => entry.word.toLocaleLowerCase("en") === "expand") ?? starterVocabulary[0];
    const word = { ...seed, id: "tooltip-test-word", createdAt: "2026-11-18T00:00:00Z", updatedAt: "2026-11-18T00:00:00Z" };
    const base = createSession([word], 5);
    const session = { ...base, phase: "context" as const, queue: [word.id] };
    const panel = (answered: boolean) => renderToStaticMarkup(
      <SentenceVocabularyProvider words={[word]} enabled={false}>
        <QuizPanel session={answered ? {...session, answer: {choice: word.word, correct: true, confidence: null}} : session}
          onAnswer={() => {}} onConfidence={() => {}} onNext={() => {}} />
      </SentenceVocabularyProvider>,
    );
    expect(panel(false)).not.toContain('data-testid="english-sentence-tooltips"');
    const answered = panel(true);
    expect(answered).toContain('data-testid="english-sentence-tooltips"');
    expect(answered).toContain('data-testid="sentence-word"');
  });
});

describe("formatted AI chat preserves English tooltip coverage", () => {
  test("strong and emphasized English sentences receive tooltips but code does not", () => {
    const html = renderToStaticMarkup(
      <SentenceVocabularyProvider words={entries}>
        <ChatMessageMarkdown content={"**They abandon the plan.**\n\n*They approach the subject.*\n\n`They abandon the plan.`"} />
      </SentenceVocabularyProvider>,
    );
    expect((html.match(/data-word="abandon"/g) ?? []).length).toBe(1);
    expect((html.match(/data-word="approach"/g) ?? []).length).toBe(1);
    expect(html).toContain("<code");
  });
});

describe("explicit selected sense wins over an ambiguous personal library lemma", () => {
  test("Inspector Verb Approach is not overwritten by the library Noun Approach", () => {
    const html = renderToStaticMarkup(
      <SentenceVocabularyProvider words={[{word: "Approach", meanings: ["yaklaşım"], partOfSpeech: "Noun"}]}>
        <SentenceWordTooltips text="We approach this question." focusWord={{
          word: "Approach", meanings: ["yaklaşmak"], partOfSpeech: "Verb",
        }} />
      </SentenceVocabularyProvider>,
    );
    expect(html).toContain("approach: yaklaşmak");
    expect(html).not.toContain("approach: yaklaşım");
  });
});
