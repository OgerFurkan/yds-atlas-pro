import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WordFillProgress } from "../model/prepare-word-inputs";

export function AiFillProgress({ progress }: { progress: WordFillProgress }) {
  const { t } = useTranslation();
  const { completed, total, batchSize } = progress;
  const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const failedWords = progress.failedWords ?? [];
  const retry = progress.retry;
  const remaining = Math.max(
    0,
    Math.ceil((total - completed - failedWords.length) / batchSize),
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-atlas-line bg-gradient-to-r from-atlas-blue-pale via-card to-atlas-orange-pale px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-xs font-semibold text-atlas-ink">
          <span className="relative grid size-6 shrink-0 place-items-center rounded-full bg-atlas-blue/10 text-atlas-blue">
            <Sparkles size={13} />
            <span className="absolute inset-0 animate-ping rounded-full bg-atlas-blue/10 motion-reduce:hidden" />
          </span>
          <span className="truncate">{t("library.aiProgress.title")}</span>
        </p>
        <span className="shrink-0 rounded-full bg-card/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-atlas-blue ring-1 ring-atlas-line">
          {t("library.aiProgress.count", { completed, total })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-label={t("library.aiProgress.title")}
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-atlas-line/60"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-atlas-blue via-atlas-blue to-atlas-orange transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-atlas-muted">
        {retry?.secondsRemaining
          ? retry.reason === "rate-limit"
            ? `AI istek sınırı: ${retry.secondsRemaining} sn sonra yalnızca eksik kelimeler tekrar denenecek. Pencereyi kapatma.`
            : `Gemini geçici olarak meşgul: ${retry.secondsRemaining} sn sonra otomatik tekrar denenecek.`
          : remaining > 0
          ? t("library.aiProgress.hint", { count: remaining })
          : failedWords.length > 0
            ? `${completed}/${total} kelime hazir. Eksikler tekrar denenebilir.`
            : t("library.aiProgress.finishing")}
      </p>
      {failedWords.length > 0 && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-amber-300/50 bg-amber-50/80 p-2.5 text-xs text-amber-900"
        >
          <p className="font-semibold">
            {failedWords.length} kelime tamamlanamadi
          </p>
          <p className="mt-1 break-words">
            {failedWords.join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
