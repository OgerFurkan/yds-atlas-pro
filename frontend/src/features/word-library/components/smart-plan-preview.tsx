import { getWordGroup, type WordEntry } from "@yds-atlas/shared";
import { CalendarClock, CircleAlert, Clock3, Play, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { isGameReady } from "@/features/learning-game/model/game-engine";
import { Button } from "@/shared/ui/button";
import type { DailyGroup, DailyPlan } from "../model/daily-groups";
import { buildSmartDailyPlan, type SmartPlanTask } from "../model/smart-daily-plan";

const MINUTE_OPTIONS = [15, 20, 30, 45, 60] as const;
const TASK_TITLES = {
  due: "Zamanı gelen tekrarlar",
  difficult: "Zorlanılan kelimeler",
  new: "Günün yeni kelimeleri",
} as const;

interface SmartPlanPreviewProps {
  plan: DailyPlan;
  words: readonly WordEntry[];
  onStudyGroup: (group: DailyGroup) => void;
  disabled?: boolean;
}

/**
 * Phase 4A: explicit preview and manual launch. There is no schedule repository
 * yet, so DO NOT pretend that an empty schedule list means zero due reviews.
 * Only difficult/new tasks can be planned with the currently available data.
 */
export function SmartPlanPreview({
  plan,
  words,
  onStudyGroup,
  disabled = false,
}: SmartPlanPreviewProps) {
  const availableDays = plan.groups.filter((group) => group.total > 0);
  const defaultDay = availableDays.find((group) => group.progress < 1)?.day ??
    availableDays[0]?.day ?? 1;
  const [manualDay, setManualDay] = useState<number | null>(null);
  const activeDay = manualDay !== null && availableDays.some((group) => group.day === manualDay)
    ? manualDay
    : defaultDay;
  const [minutes, setMinutes] = useState<number>(20);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [launchError, setLaunchError] = useState("");
  const byId = useMemo(() => new Map(words.map((word) => [word.id, word])), [words]);

  // Read only: built from already-calculated daily group views. Never calls
  // DailyWordGroupsRepository.syncWords, localStorage writes or a cloud API.
  const proposal = useMemo(() => {
    if (generatedAt === null || disabled || availableDays.length === 0) return null;
    return buildSmartDailyPlan({
      words,
      schedules: [], // Not wired: timed due reviews must be added in a later phase.
      assignments: availableDays.map((group) => ({
        day: group.day,
        words: group.words.map((word) => word.id),
      })),
      activeDay,
      minutesAvailable: minutes,
      now: new Date(generatedAt),
    });
  }, [activeDay, availableDays, disabled, generatedAt, minutes, words]);

  function launch(task: SmartPlanTask) {
    if (task.kind === "due" || disabled) return;
    const selected = task.wordIds.map((id) => byId.get(id));
    if (!selected.every((word): word is WordEntry => !!word && isGameReady(word))) {
      setLaunchError("Kelime bilgileri değişmiş. Planı yeniden oluşturup tekrar dene.");
      return;
    }
    const readyWords = selected as WordEntry[];
    const source = plan.groups[activeDay - 1];
    if (!source || readyWords.length === 0) {
      setLaunchError("Çalışmaya hazır kelime bulunamadı.");
      return;
    }
    setLaunchError("");
    // Existing game entry point uses only day/playableWords. Never mutates the
    // persisted day assignments or silently starts another task.
    onStudyGroup({
      ...source,
      words: readyWords,
      playableWords: readyWords,
      total: readyWords.length,
      playable: readyWords.length,
      hard: readyWords.filter((word) => getWordGroup(word.score) === "hard").length,
      review: readyWords.filter((word) => getWordGroup(word.score) === "review").length,
      learned: 0,
      progress: 0,
    });
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5"
      role="region"
      aria-labelledby="smart-plan-heading"
      data-testid="smart-plan-preview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-atlas-blue">
            <Sparkles aria-hidden="true" size={15} /> PHASE 4A · ÖNİZLEME
          </p>
          <h3 id="smart-plan-heading" className="mt-1 text-lg font-semibold text-foreground">
            Bugünün akıllı planı
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Süreni ve çalışmak istediğin günü seç. Planı önce gör, istediğin adımı kendin başlat.
          </p>
        </div>
        <CalendarClock aria-hidden="true" className="text-atlas-blue" size={25} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="block text-sm font-medium text-foreground">
          Çalışılacak gün
          <select
            className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground"
            value={activeDay}
            onChange={(event) => { setManualDay(Number(event.target.value)); setGeneratedAt(null); }}
            disabled={disabled || availableDays.length === 0}
          >
            {availableDays.length === 0 ? <option value={1}>Önce kelime ekle</option> : null}
            {availableDays.map((group) => (
              <option key={group.day} value={group.day}>
                Gün {group.day} · {group.total} kelime
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-foreground">
          Ayırabileceğin süre
          <select
            className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground"
            value={minutes}
            onChange={(event) => { setMinutes(Number(event.target.value)); setGeneratedAt(null); }}
            disabled={disabled}
          >
            {MINUTE_OPTIONS.map((value) => <option key={value} value={value}>{value} dakika</option>)}
          </select>
        </label>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={disabled || availableDays.length === 0}
          onClick={() => { setLaunchError(""); setGeneratedAt(Date.now()); }}
        >
          <Sparkles aria-hidden="true" size={16} /> Plan oluştur
        </Button>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-foreground">
        <CircleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-amber-600" />
        <p>
          Tekrar takvimi uygulamaya henüz bağlanmadı. Bu sürüm yalnızca günlere atanmış
          zorlanılan ve yeni kelimeler için öneri oluşturur; zamanı gelen tekrarların
          tamamını gösterdiğini iddia etmez. Öneri oluşturmak kayıtlı grupları değiştirmez.
        </p>
      </div>

      {disabled && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Günlük plan verisi okunamadığı için güvenli öneri oluşturulamıyor.
        </p>
      )}
      {launchError && <p role="alert" className="mt-3 text-sm text-destructive">{launchError}</p>}
      {proposal && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <Clock3 aria-hidden="true" size={16} />
            <strong>{proposal.tasks.length} çalışma adımı</strong>
            <span className="text-muted-foreground">
              · {proposal.minutesPlanned} dk planlandı · {proposal.minutesRemaining} dk boş
            </span>
          </p>
          {proposal.tasks.length === 0 && (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Bu gün ve süre için çalışmaya hazır kelime bulunamadı.
            </p>
          )}
          <ol className="space-y-2">
            {proposal.tasks.map((task, index) => (
              <li key={`${task.kind}:${index}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3">
                <div className="min-w-0 flex-1">
                  <strong className="text-sm text-foreground">{index + 1}. {TASK_TITLES[task.kind]}</strong>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {task.wordIds.length} kelime · yaklaşık {task.estimatedMinutes} dakika
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={task.kind === "due"}
                  onClick={() => launch(task)}
                  aria-label={`${TASK_TITLES[task.kind]} · ${task.wordIds.length} kelimeyi çalış`}
                >
                  <Play aria-hidden="true" size={14} /> Çalış
                </Button>
              </li>
            ))}
          </ol>
          {(proposal.needsEnrichment.length > 0 || proposal.needsReviewContent.length > 0) && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {proposal.needsEnrichment.length + proposal.needsReviewContent.length} kelimenin
              çalışma için gerekli bilgileri henüz tamamlanmamış.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Süreler tahminidir; oyunların gerçek tamamlanma süresi kişiye göre değişir.
            Her adım yalnızca Çalış düğmesine basınca başlar.
          </p>
        </div>
      )}
    </section>
  );
}
