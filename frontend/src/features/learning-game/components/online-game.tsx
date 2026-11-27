import { type OnlineAction, type OnlineView, phaseLabels } from "@yds-atlas/shared";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { PronunciationButtons } from "@/shared/ui/pronunciation-buttons";
import { WordCredit } from "@/shared/ui/word-credit";
export function OnlineGame({
  view,
  busy,
  act,
  leave,
}: {
  view: OnlineView;
  busy: boolean;
  act: (a: OnlineAction) => void;
  leave: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const active = view.status === "active";
  return (
    <section
      className="mx-auto max-w-3xl space-y-4 rounded-xl border bg-card p-5"
      aria-busy={busy}
      data-phase={view.phase}
      data-group={view.group}
    >
      <h1 className="text-xl font-bold">
        {active
          ? phaseLabels[view.phase]
          : view.status === "complete"
            ? "Değerlendirme tamamlandı"
            : view.status === "expired"
              ? "Değerlendirme süresi doldu"
              : "Değerlendirme iptal edildi"}
      </h1>
      {active && (
        <>
          <p>
            Grup {view.group} · {view.total} kelime
          </p>
          {view.prompt && (
            <h2 className="text-xl" lang="en">
              {view.prompt}
            </h2>
          )}
          {view.phase === "flashcards" && !revealed && (
            <Button onClick={() => setRevealed(true)}>Kartı çevir ve anlamı göster</Button>
          )}
          {view.choices && (
            <div className="grid gap-2 sm:grid-cols-2">
              {view.choices.map((option) => (
                <Button
                  key={option.token}
                  data-side={option.side}
                  variant={option.selected ? "default" : "outline"}
                  disabled={
                    busy ||
                    option.matched ||
                    (!option.side && view.feedback !== undefined) ||
                    (!!option.side && view.feedback === false)
                  }
                  onClick={() => act({ kind: "choose", token: option.token })}
                >
                  {option.text}
                </Button>
              ))}
            </div>
          )}
          {view.feedback !== undefined && <p role="status">{view.feedback ? "Doğru" : "Yanlış"}</p>}
          {view.lesson && (view.phase !== "flashcards" || revealed) && (
            <div className="space-y-2">
              <p>
                <strong lang="en">{view.lesson.word}</strong> · {view.lesson.meanings.join(", ")}
              </p>
              <p>{[view.lesson.partOfSpeech, view.lesson.cefr].filter(Boolean).join(" · ")}</p>
              {view.lesson.usageNote && <p>{view.lesson.usageNote}</p>}
              {view.lesson.sentence && <p lang="en">{view.lesson.sentence}</p>}
              {view.lesson.translation && <p>{view.lesson.translation}</p>}
              {view.lesson.examples?.length > 0 && (
                <details>
                  <summary className="cursor-pointer font-medium">
                    Örnek cümleler ({view.lesson.examples.length})
                  </summary>
                  <ol className="mt-2 list-decimal space-y-2 pl-5">
                    {view.lesson.examples.map(({ sentence, translation }) => (
                      <li key={sentence}>
                        <p lang="en">{sentence}</p>
                        <p>{translation}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <PronunciationButtons
                word={view.lesson.word}
                uk={view.lesson.pronunciationUk}
                us={view.lesson.pronunciationUs}
              />
              {view.lesson.attribution && <WordCredit credit={view.lesson.attribution} />}
            </div>
          )}
          {view.confidence &&
            ([-10, 0, 20] as const).map((value, i) => (
              <Button
                key={value}
                disabled={busy}
                onClick={() => act({ kind: "confidence", value })}
              >
                {["Zor hatırladım", "Hatırladım", "Kolay hatırladım"][i]}
              </Button>
            ))}
          {view.next && (view.phase !== "flashcards" || revealed) && (
            <Button disabled={busy} onClick={() => act({ kind: "next" })}>
              {view.feedback === false && view.phase.endsWith("matching")
                ? "Yeniden dene"
                : "Devam et"}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={leave}>
              Ara ver
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Bu değerlendirmeyi puan kaydetmeden iptal et?"))
                  act({ kind: "cancel" });
              }}
            >
              İptal et
            </Button>
          </div>
        </>
      )}
      {!active && (
        <>
          {view.results?.map((w) => (
            <p key={w.word}>
              <strong>{w.word}</strong> · {w.meaning} ·{" "}
              {w.score === null
                ? "Kelime değişti veya silindi. Puan işlenmedi."
                : w.score >= 80
                  ? "Öğrenilen"
                  : w.score >= 40
                    ? "Tekrar gerektiren"
                    : "Zorlanılan"}
            </p>
          ))}
          <Button onClick={leave}>Ana sayfa</Button>
        </>
      )}
    </section>
  );
}
