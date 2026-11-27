import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import type { GameSession } from "../model/game-session";
export function DayTaskStart({
  day,
  saved,
  discarding,
  wordCount,
  onResume,
  requestDiscard,
  onStart,
  onOpenLibrary,
  discardDialog,
}: {
  day: number;
  saved: GameSession | null;
  discarding: boolean;
  wordCount: number;
  onResume: () => void;
  requestDiscard: () => void;
  onStart: () => void;
  onOpenLibrary: () => void;
  discardDialog: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-4xl space-y-3 rounded-xl border border-border bg-card p-5">
      <h1 className="text-xl font-semibold text-foreground">
        {t("library.daily.manage.dayGameTitle", { day: day })}
      </h1>
      {saved && !saved.saved && (
        <>
          <p className="text-sm text-muted-foreground">{t("taskIntro.chooseSavedTask")}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={discarding} onClick={onResume}>
              {t("taskIntro.continue")}
            </Button>
            {saved.phase !== "complete" && (
              <Button variant="outline" disabled={discarding} onClick={requestDiscard}>
                {t(discarding ? "taskIntro.discarding" : "taskIntro.discard")}
              </Button>
            )}
          </div>
        </>
      )}
      {(!saved || saved.saved) && wordCount > 0 && (
        <Button onClick={onStart}>{t("library.daily.manage.study")}</Button>
      )}
      {!wordCount && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("library.daily.manage.dayGameEmpty")}
        </p>
      )}
      <Button variant="ghost" onClick={onOpenLibrary}>
        <ArrowLeft size={17} /> {t("library.daily.manage.dayGameBack")}
      </Button>
      {discardDialog}
    </section>
  );
}
