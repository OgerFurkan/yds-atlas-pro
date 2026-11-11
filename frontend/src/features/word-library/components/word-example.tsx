import type { WordExample as Example, WordEntry } from "@yds-atlas/shared";
import { escapeRegExp } from "@/shared/lib/regexp";
import { getStarterWord } from "../data/starter-vocabulary";

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
}: {
  word: WordEntry;
  example: Example;
  compact?: boolean;
}) {
  const seed = getStarterWord(word.word)?.examples.find(
    (item) => item.sentence === example.sentence,
  );
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
        compact
          ? "space-y-2"
          : "space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:p-5"
      }
    >
      <p className="text-sm leading-7 text-slate-700 sm:text-base">
        <HighlightedText text={example.sentence} terms={[word.word, ...word.alternatives]} />
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
