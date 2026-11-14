import { getVisibleWordGroup, type WordEntry } from "@yds-atlas/shared";
import { CalendarClock, CircleAlert, Clock3, Play, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isGameReady } from "@/features/learning-game/model/game-engine";
import { loadCloudReviewSchedules } from "@/features/review/api/cloud-review-schedules-api";
import { listGuestReviewSchedules } from "@/features/review/api/guest-review-schedule-repository";
import type { ReviewSchedule } from "@/features/review/model/spaced-repetition";
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
  userId?: string | null;
  onStudyGroup: (group: DailyGroup) => void;
  disabled?: boolean;
}

/**
 * Read-only preview. Schedules are fetched only after the user clicks Plan olustur.
 * Authenticated accounts use the JWT-protected cloud endpoint. Guests use only
 * their scoped, validated local review ledger. Neither branch writes schedules.
 */
export function SmartPlanPreview({
  plan,
  words,
  userId = null,
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
  const [loaded, setLoaded] = useState<{
    userId: string | null;
    schedules: ReviewSchedule[];
    generatedAt: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [launchError, setLaunchError] = useState("");
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current += 1; }, []);

  function invalidate() {
    // Never let a late response resurrect a plan for an earlier day or duration.
    requestId.current += 1;
    setLoaded(null);
    setPending(false);
    setLoadError("");
    setLaunchError("");
  }

  async function generatePlan() {
    if (pending || disabled || !words.length) return;
    const request = ++requestId.current;
    setPending(true);
    setLoaded(null);
    setLoadError("");
    setLaunchError("");
    try {
      const schedules = userId
        ? await loadCloudReviewSchedules(userId)
        : listGuestReviewSchedules(window.localStorage, new Set(words.map((word) => word.id)));
      if (request !== requestId.current) return;
      // A malformed/duplicate cloud response must not be presented as an empty queue.
      const ids = new Set<string>();
      for (const schedule of schedules) {
        if (ids.has(schedule.wordId)) throw new Error("Tekrar takviminde yinelenen kelime var.");
        ids.add(schedule.wordId);
      }
      setLoaded({ userId, schedules, generatedAt: Date.now() });
    } catch (reason) {
      if (request === requestId.current) {
        setLoadError(reason instanceof Error ? reason.message : "Tekrar takvimi okunamadı.");
      }
    } finally {
      if (request === requestId.current) setPending(false);
    }
  }
  const byId = useMemo(() => new Map(words.map((word) => [word.id, word])), [words]);

  // Pure calculation. Network and storage reads happen only in generatePlan().
  const proposal = useMemo(() => {
    if (!loaded || loaded.userId !== userId || disabled || !words.length) return null;
    return buildSmartDailyPlan({
      words,
      schedules: loaded.schedules,
      assignments: availableDays.map((group) => ({
        day: group.day,
        words: group.words.map((word) => word.id),
      })),
      activeDay,
      minutesAvailable: minutes,
      now: new Date(loaded.generatedAt),
    });
  }, [activeDay, availableDays, disabled, loaded, minutes, userId, words]);

  function launch(task: SmartPlanTask) {
    if (disabled || pending || !loaded || loaded.userId !== userId) return;
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
      hard: readyWords.filter((word) => getVisibleWordGroup(word) === "hard").length,
      review: readyWords.filter((word) => getVisibleWordGroup(word) === "review").length,
      learned: readyWords.filter((word) => getVisibleWordGroup(word) === "learned").length,
      progress: readyWords.filter((word) => getVisibleWordGroup(word) === "learned").length / readyWords.length,
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
            onChange={(event) => { setManualDay(Number(event.target.value)); invalidate(); }}
            disabled={disabled || availableDays.length === 0 || pending}
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
            onChange={(event) => { setMinutes(Number(event.target.value)); invalidate(); }}
            disabled={disabled || pending}
          >
            {MINUTE_OPTIONS.map((value) => <option key={value} value={value}>{value} dakika</option>)}
          </select>
        </label>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={disabled || pending || words.length === 0}
          onClick={() => void generatePlan()}
        >
          {pending ? <RefreshCw aria-hidden="true" size={16} className="animate-spin" />
            : <Sparkles aria-hidden="true" size={16} />}
          {pending ? "Tekrarlar okunuyor…" : "Plan oluştur"}
        </Button>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
        <CalendarClock aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-atlas-blue" />
        <p role="status">
          {pending
            ? "Tekrar takvimi okunuyor; öneri tamamlanana kadar çalışma başlatılamaz."
            : loaded?.userId === userId
              ? `${loaded.schedules.length} tekrar kaydı ${userId ? "hesabından" : "misafir kayıtlarından"} okundu. Zamanı gelenler önceliklendirildi.`
              : `Plan oluştur dediğinde ${userId ? "hesabındaki" : "bu cihazdaki misafir"} tekrar takvimi okunur. Öneri hiçbir veriyi değiştirmez.`}
        </p>
      </div>
      {loadError && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          Tekrar takvimi yüklenemedi: {loadError} Lütfen yeniden dene; eksik bir takvimle plan oluşturulmadı.
        </p>
      )}

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
                  disabled={disabled || pending}
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
