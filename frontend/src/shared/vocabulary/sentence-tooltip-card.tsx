import type { LexiconPreview } from "@yds-atlas/shared";
import { PronunciationButtons } from "@/shared/ui/pronunciation-buttons";

export function SentenceTooltipCard({
  text,
  token,
  selected,
  matches,
  lookup,
  owner,
  status,
  onClose,
  onRetry,
}: {
  text: string;
  token: string;
  selected?: LexiconPreview;
  matches: LexiconPreview[];
  lookup: boolean;
  owner: string | null;
  status: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <span lang="tr" className="block">
      <span className="flex items-center justify-between gap-4">
        <strong lang="en" className="atlas-tooltip-title">
          {text}
        </strong>
        <button
          aria-label="Kapat"
          type="button"
          className="atlas-tooltip-close"
          onClick={() => onClose()}
        >
          ×
        </button>
      </span>
      {selected ? (
        <>
          <span className="block text-xs text-atlas-muted">
            {selected.partOfSpeech}
            {selected.word === token && selected.ipaUk && " · UK " + selected.ipaUk}
            {selected.word === token &&
              selected.ipaUs &&
              selected.ipaUs !== selected.ipaUk &&
              " · US " + selected.ipaUs}
          </span>
          <PronunciationButtons
            compact
            word={token}
            uk={selected.word === token ? (selected.audioUk ?? undefined) : undefined}
            us={selected.word === token ? (selected.audioUs ?? undefined) : undefined}
          />
          <strong className="block text-base leading-snug">{selected.meanings[0]}</strong>
          {selected.word !== token && (
            <span className="mt-1 block text-xs text-atlas-muted">
              Kök biçimi · {selected.word}
            </span>
          )}
          {selected.attribution && (
            <span className="block text-xs">
              <a href={selected.attribution.source} rel="noreferrer" target="_blank">
                {selected.attribution.author}
              </a>{" "}
              ·{" "}
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                rel="noreferrer"
                target="_blank"
              >
                CC BY-SA 4.0
              </a>
            </span>
          )}
          {selected.meanings.length > 1 && (
            <details className="mt-3 border-t border-border pt-2 text-xs">
              <summary className="cursor-pointer font-semibold">Daha fazla bilgi</summary>
              {selected.meanings.slice(1).join(" · ")}
            </details>
          )}
        </>
      ) : matches.length > 1 ? (
        <>
          <span>Bağlama göre birden fazla anlam mümkün.</span>
          {matches.map((m) => (
            <span className="block" key={m.id}>
              {m.word} · {m.partOfSpeech} · {m.meanings[0]}
            </span>
          ))}
        </>
      ) : !lookup ? (
        <span>
          {owner
            ? "Bu oturumda ortak sözlük kullanılamıyor."
            : "Ortak sözlükteki anlamları görmek için giriş yap."}
        </span>
      ) : status === "error" ? (
        <button type="button" onClick={onRetry}>
          Sözlük okunamadı. Yeniden dene
        </button>
      ) : status !== "ready" ? (
        <span>Aranıyor…</span>
      ) : (
        <span>Ortak sözlükte karşılık bulunamadı.</span>
      )}
    </span>
  );
}
