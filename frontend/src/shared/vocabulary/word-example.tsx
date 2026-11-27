import type { WordExample as Example, WordEntry } from "@yds-atlas/shared";
import { getStarterWord } from "@yds-atlas/shared/starter-vocabulary";
import { escapeRegExp } from "@/shared/lib/regexp";
import { SentenceWordTooltips } from "@/shared/vocabulary/sentence-word-tooltips";

function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const escaped = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (!escaped.length) return <>{text}</>;
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const segments: { text: string; highlight: boolean; offset: number }[] = [];
  let offset = 0;
  text.split(pattern).forEach((part, index) => {
    segments.push({ text: part, highlight: index % 2 === 1, offset });
    offset += part.length;
  });
  return (
    <>
      {segments.map((segment) =>
        segment.highlight ? (
          <strong key={segment.offset} className="font-bold italic text-atlas-navy">
            {segment.text}
          </strong>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

export function WordExample({
  word,
  example,
  compact = false,
  allowDuringGame = false,
}: {
  word: Pick<WordEntry, "word" | "meanings" | "partOfSpeech" | "examples">;
  example: Example;
  compact?: boolean;
  allowDuringGame?: boolean;
}) {
  const seed = getStarterWord(word.word)?.examples.find(
    (item) => item.sentence === example.sentence,
  );
  const ordinal =
    word.examples.findIndex(
      (item) => item.sentence === example.sentence && item.translation === example.translation,
    ) + 1;
  const translation = example.translation || seed?.translation;
  const translationTerms = example.translationFocus?.length
    ? example.translationFocus
    : translation === seed?.translation && seed?.translationFocus?.length
      ? seed.translationFocus
      : word.meanings;
  const wiktionarySource = example.source?.match(
    /^DictionaryAPI\.dev \/ Wiktionary \(([^)]+)\): (https:\/\/en\.wiktionary\.org\/\S+)$/,
  );
  return (
    <div
      className={
        compact ? "space-y-2" : "space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5"
      }
    >
      <div className="flex justify-between gap-2 text-xs font-semibold tracking-wide text-atlas-muted">
        <span lang="en">EXAMPLE SENTENCE</span>
        <span>
          {ordinal > 0 && `${ordinal} / ${word.examples.length}`}
          {example.difficulty &&
            " · " + { easy: "Kolay", medium: "Orta", yds: "YDS" }[example.difficulty]}
        </span>
      </div>
      <p className="text-sm leading-7 text-atlas-ink sm:text-base">
        <SentenceWordTooltips
          text={example.sentence}
          focusWord={word}
          allowDuringGame={allowDuringGame}
        />
      </p>
      <p className="text-sm leading-7 text-slate-600">
        {translation ? (
          <HighlightedText text={translation} terms={translationTerms} />
        ) : (
          "Bu cümlenin Türkçe çevirisi henüz eklenmemiş."
        )}
      </p>
      {wiktionarySource && (
        <p className="text-[11px] leading-5 text-slate-500">
          Kaynak:{" "}
          <a
            className="underline underline-offset-2"
            href={wiktionarySource[2]}
            target="_blank"
            rel="noreferrer"
          >
            Wiktionary · {wiktionarySource[1]}
          </a>
        </p>
      )}
    </div>
  );
}
