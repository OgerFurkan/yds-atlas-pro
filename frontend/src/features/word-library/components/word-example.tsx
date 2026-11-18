import type { WordExample as Example, WordEntry } from "@yds-atlas/shared";
import { escapeRegExp } from "@/shared/lib/regexp";
import { getStarterWord } from "../data/starter-vocabulary";
import { SentenceWordTooltips } from "./sentence-word-tooltips";

const TIER_LABELS = {easy: "Kolay", medium: "Orta", yds: "YDS"} as const;
const TIER_CLASSES = {
  easy: "border-emerald-200 bg-emerald-50 text-emerald-900",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  yds: "border-blue-200 bg-blue-50 text-blue-900",
} as const;

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
  word: WordEntry;
  example: Example;
  compact?: boolean;
  allowDuringGame?: boolean;
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
      data-testid="word-example"
      data-difficulty={example.difficulty ?? "unclassified"}
      className={
        compact
          ? "space-y-2"
          : "space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:p-5"
      }
    >
      {example.difficulty && (
        <div className="flex flex-wrap items-center gap-2">
          <span aria-label={"Cümle seviyesi: " + TIER_LABELS[example.difficulty]}
            className={"inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wide " + TIER_CLASSES[example.difficulty]}>
            {TIER_LABELS[example.difficulty]}
          </span>
        </div>
      )}
      <p className="text-sm leading-7 text-slate-700 sm:text-base">
        <SentenceWordTooltips text={example.sentence} focusWord={word} allowDuringGame={allowDuringGame} />
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
