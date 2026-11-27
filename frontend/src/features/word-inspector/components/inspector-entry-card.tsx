import { BookMarked, CheckCircle2, LibraryBig } from "lucide-react";
import type { Ref } from "react";
import { withOccurrenceKeys } from "@/shared/lib/occurrence-keys";
import { Button } from "@/shared/ui/button";
import { PronunciationButtons } from "@/shared/ui/pronunciation-buttons";
import { WordCredit } from "@/shared/ui/word-credit";
import { WordExample } from "@/shared/vocabulary/word-example";
import type { InspectorEntry } from "../api/word-inspector-api";
import { TieredSentencePreview } from "./tiered-sentence-preview";

export function InspectorEntryCard({
  entry,
  heading,
  saving,
  savedMessage,
  onSave,
}: {
  entry: InspectorEntry;
  heading: Ref<HTMLHeadingElement>;
  saving: boolean;
  savedMessage?: string;
  onSave: () => void;
}) {
  return (
    <article
      className="overflow-hidden rounded-3xl border border-atlas-line bg-white shadow-sm"
      aria-labelledby="inspector-result-title"
    >
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-atlas-blue">
              <CheckCircle2 size={16} aria-hidden="true" /> Havuz kaydı ·{" "}
              {entry.status === "human_reviewed" ? "Editör onaylı" : "Makine kontrolünden geçmiş"}
            </p>
            <h2
              id="inspector-result-title"
              ref={heading}
              tabIndex={-1}
              className="mt-3 font-display text-3xl font-semibold text-atlas-navy sm:text-4xl"
            >
              {entry.word}
            </h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {entry.partOfSpeech}
              {entry.ipaUk && " · UK " + entry.ipaUk}
              {entry.ipaUs && " · US " + entry.ipaUs} · {entry.cefr}
            </p>
          </div>
          <Button variant="secondary" disabled={saving} onClick={onSave} className="min-h-11">
            {saving ? (
              <BookMarked size={17} aria-hidden="true" />
            ) : (
              <LibraryBig size={17} aria-hidden="true" />
            )}
            {saving ? "Kaydediliyor…" : "Kütüphaneye ekle"}
          </Button>
        </div>
        {savedMessage && (
          <p role="status" className="mt-3 text-sm text-emerald-800">
            {savedMessage}
          </p>
        )}
      </div>
      <div className="grid gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Anlamlar</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {entry.meanings.map((meaning) => (
              <li
                key={meaning}
                className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-atlas-navy"
              >
                {meaning}
              </li>
            ))}
          </ul>
          {entry.attribution && <WordCredit credit={entry.attribution} />}
          {entry.usageNote && (
            <p className="mt-4 text-sm leading-7 text-slate-600">{entry.usageNote}</p>
          )}
          {!!entry.alternatives.length && (
            <p className="mt-3 text-sm text-slate-600">
              Alternatif biçimler: {entry.alternatives.join(", ")}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-atlas-navy">Telaffuz bilgisi</h3>
          <PronunciationButtons
            compact
            word={entry.word}
            uk={entry.pronunciationUk?.startsWith("https://") ? entry.pronunciationUk : undefined}
            us={entry.pronunciationUs?.startsWith("https://") ? entry.pronunciationUs : undefined}
          />
          {entry.ipaUk && <p>UK · {entry.ipaUk}</p>}
          {entry.ipaUs && <p>US · {entry.ipaUs}</p>}
        </div>
      </div>
      <section
        className="border-t border-slate-100 px-5 py-6 sm:px-8"
        aria-labelledby="inspector-examples-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="inspector-examples-title" className="text-lg font-semibold text-atlas-navy">
            Beş kademeli örnek
          </h3>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-atlas-navy">
            2 kolay · 1 orta · 2 YDS
          </span>
        </div>
        <ol aria-label="Inspector örnekleri" className="mt-5 grid gap-3 lg:grid-cols-2">
          {withOccurrenceKeys(entry.examples, (example) => example.sentence).map(
            ({ item: example, key }) => (
              <li key={key} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                <WordExample word={entry} example={example} compact />
              </li>
            ),
          )}
        </ol>
        <TieredSentencePreview key={entry.word} word={entry.word} />
      </section>
    </article>
  );
}
