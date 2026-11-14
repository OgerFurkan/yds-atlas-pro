import type { WordEntry } from "@yds-atlas/shared";
import { Cloud, GitCompareArrows, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/shared/ui/dialog";
import { previewDailyPlanSync } from "../api/daily-plan-preflight-source";
import type { SyncPreflightResult, SyncPreflightStatus } from "../model/daily-plan-sync-preflight";

type PreviewChoice = "later" | "local" | "cloud";

const content = {
  tr: {
    heading: "Bulut planı karşılaştırması",
    subtitle: "Bu cihazdaki günlük plan ile bulut planının farklarına güvenle bak.",
    open: "Senkronizasyon önizlemesi",
    previewOnly: "Sadece okuma · Kaydetme ve senkronizasyon kapalı",
    signIn: "Bulut karşılaştırmasını kullanmak için hesabına giriş yapmalısın.",
    ask: "Planları karşılaştır",
    retry: "Yeniden karşılaştır",
    working: "Planlar okunuyor…",
    before: "Karşılaştırma yalnızca butona bastığında başlar. Hiçbir plana yazılmaz.",
    local: "Yerel plandaki kelimeler",
    cloud: "Bulut planındaki kelimeler",
    revision: "Bulut revizyonu",
    placement: "Farklı günlere atanan kelimeler",
    exclusions: "Farklı dışlama kayıtları",
    order: "Sıralaması farklı günler",
    size: "Günlük hedef farklı",
    days: "günler",
    none: "Yok",
    day: "gün",
    unassigned: "Atanmamış",
    problems: "Önce çözülmesi gereken problemler",
    decision: "Gelecekteki çözüm tercihini incele",
    later: "Şimdilik karar vermeyeceğim",
    keepLocal: "Bu cihazdaki planı korumak isterim",
    keepCloud: "Buluttaki planı korumak isterim",
    choiceDisclaimer: "Bu seçim yalnızca bu penceredeki taslaktır. Kaydedilmez ve hiçbir veri değiştirilmez.",
    unsafe: "Geçersiz plan nedeniyle seçim yapılamaz. Verilerin korunması için işlem durduruldu.",
    unknown: "Bilinmeyen kelime",
    more: "diğer fark gösterilmiyor",
    status: {
      blocked: "Karşılaştırma engellendi",
      "both-empty": "İki planda da kayıt yok",
      "local-only": "Yalnızca yerel plan mevcut",
      "cloud-only": "Yalnızca bulut planı mevcut",
      identical: "Planlar birbiriyle aynı",
      different: "Planlar arasında farklar var",
    },
  },
  en: {
    heading: "Cloud plan comparison",
    subtitle: "Safely compare your daily plan on this device with the cloud plan.",
    open: "Sync preview",
    previewOnly: "Read-only · Saving and synchronization disabled",
    signIn: "Sign in to your account to compare cloud plans.",
    ask: "Compare plans",
    retry: "Compare again",
    working: "Reading plans…",
    before: "Comparison starts only after you click the button. Neither plan is written.",
    local: "Words in local plan",
    cloud: "Words in cloud plan",
    revision: "Cloud revision",
    placement: "Words assigned to different days",
    exclusions: "Exclusion differences",
    order: "Days with a different order",
    size: "Daily target differs",
    days: "days",
    none: "None",
    day: "day",
    unassigned: "Unassigned",
    problems: "Problems that must be resolved first",
    decision: "Preview a future resolution preference",
    later: "Decide later",
    keepLocal: "I would prefer to keep this device's plan",
    keepCloud: "I would prefer to keep the cloud plan",
    choiceDisclaimer: "This is only a temporary preview choice. It is not saved and changes no data.",
    unsafe: "Cannot choose while the plan is invalid. The operation is blocked to protect your data.",
    unknown: "Unknown word",
    more: "additional differences not shown",
    status: {
      blocked: "Comparison blocked",
      "both-empty": "Neither plan exists",
      "local-only": "Local plan only",
      "cloud-only": "Cloud plan only",
      identical: "Plans are identical",
      different: "Plans differ",
    },
  },
} satisfies Record<"tr" | "en", Record<string, unknown>>;

const VISIBLE_LIMIT = 25;

export function DailyPlanSyncPreview({
  userId, words,
}: {
  userId: string | null;
  words: readonly WordEntry[];
}) {
  const { i18n } = useTranslation();
  const copy = i18n.resolvedLanguage?.startsWith("en") || i18n.language.startsWith("en")
    ? content.en : content.tr;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SyncPreflightResult | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<PreviewChoice>("later");
  const request = useRef(0);

  useEffect(() => () => { request.current += 1; }, []);

  function changeOpen(value: boolean) {
    if (!value) {
      request.current += 1;
      setPending(false);
      setResult(null);
      setError("");
      setChoice("later");
    }
    setOpen(value);
  }

  async function compare() {
    if (!userId || pending) return;
    const current = ++request.current;
    setPending(true);
    setResult(null);
    setError("");
    setChoice("later");
    try {
      // Explicit user action. Existing helper performs GET only; never PUT or local writes.
      const preview = await previewDailyPlanSync(
        userId, words.map((word) => word.id), window.localStorage,
      );
      if (request.current === current) setResult(preview);
    } catch (reason) {
      if (request.current === current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (request.current === current) setPending(false);
    }
  }

  const wordNames = new Map(words.map((word) => [word.id, word.word]));
  const labelDay = (day: number | null) => day === null ? copy.unassigned : `${day}. ${copy.day}`;

  return (
    <>
      <section aria-label={copy.heading} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 rounded-xl bg-muted p-2 text-foreground"><Cloud size={20} aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{copy.heading}</p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.previewOnly}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => changeOpen(true)}>
          <GitCompareArrows size={16} aria-hidden="true" /> {copy.open}
        </Button>
      </section>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="!w-[min(760px,calc(100vw-24px))] max-w-none">
          <DialogHeader>
            <div className="min-w-0 pr-9">
              <DialogTitle>{copy.heading}</DialogTitle>
              <DialogDescription>{copy.subtitle}</DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-4 p-4 sm:p-6">
            <p className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground">
              <ShieldCheck size={16} aria-hidden="true" /> {copy.previewOnly}
            </p>
            {!userId ? (
              <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
                <LockKeyhole className="mr-2 inline" size={16} aria-hidden="true" />{copy.signIn}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{copy.before}</p>
                <Button onClick={() => void compare()} disabled={pending}>
                  <RefreshCw size={16} className={pending ? "animate-spin" : ""} aria-hidden="true" />
                  {pending ? copy.working : result || error ? copy.retry : copy.ask}
                </Button>
                {pending && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{copy.working}</p>}
                {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
                {result && (
                  <div className="space-y-4" aria-live="polite">
                    <h3 className="text-base font-semibold text-foreground">{copy.status[result.status as SyncPreflightStatus]}</h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {[
                        [copy.local, result.localWords],
                        [copy.cloud, result.cloudWords],
                        [copy.revision, result.cloudRevision],
                      ].map(([label, number]) => (
                        <div key={label} className="rounded-xl border border-border bg-muted p-3">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <strong className="mt-1 block text-xl text-foreground tabular-nums">{number}</strong>
                        </div>
                      ))}
                    </div>
                    {result.problems.length > 0 && (
                      <section role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
                        <h4 className="font-semibold">{copy.problems}</h4>
                        <ul className="list-inside list-disc space-y-1 text-sm">{result.problems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
                        <p className="text-sm">{copy.unsafe}</p>
                      </section>
                    )}
                    {result.status === "different" && (
                      <div className="space-y-3">
                        <section className="rounded-xl border border-border p-3">
                          <h4 className="text-sm font-semibold text-foreground">{copy.placement} ({result.changedPlacements.length})</h4>
                          {result.changedPlacements.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">{copy.none}</p> : (
                            <ul className="mt-2 space-y-2">
                              {result.changedPlacements.slice(0, VISIBLE_LIMIT).map((item) => (
                                <li key={item.wordId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-xs">
                                  <span className="font-semibold text-foreground">{wordNames.get(item.wordId) ?? copy.unknown}</span>
                                  <span className="text-muted-foreground">{labelDay(item.localDay)} → {labelDay(item.cloudDay)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {result.changedPlacements.length > VISIBLE_LIMIT && <p className="mt-2 text-xs text-muted-foreground">+{result.changedPlacements.length - VISIBLE_LIMIT} {copy.more}</p>}
                        </section>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-xl border border-border p-3 text-sm text-foreground">
                            <p className="text-xs text-muted-foreground">{copy.exclusions}</p>
                            <strong>{result.changedExclusions.length}</strong>
                            {result.changedExclusions.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{result.changedExclusions.slice(0, 8).map((id) => <li key={id}>{wordNames.get(id) ?? copy.unknown}</li>)}</ul>
                            )}
                          </div>
                          <div className="rounded-xl border border-border p-3 text-sm text-foreground">
                            <p className="text-xs text-muted-foreground">{copy.order}</p>
                            <strong>{result.changedOrderDays.length ? result.changedOrderDays.join(", ") : copy.none}</strong>
                          </div>
                          <div className="rounded-xl border border-border p-3 text-sm text-foreground">
                            <p className="text-xs text-muted-foreground">{copy.size}</p>
                            <strong>{result.groupSizeChanged ? "✓" : copy.none}</strong>
                          </div>
                        </div>
                      </div>
                    )}
                    {result.requiresUserDecision && result.status !== "blocked" && (
                      <fieldset className="space-y-2 rounded-xl border border-border p-3">
                        <legend className="px-1 text-sm font-semibold text-foreground">{copy.decision}</legend>
                        {([
                          ["later", copy.later], ["local", copy.keepLocal], ["cloud", copy.keepCloud],
                        ] as const).map(([value, label]) => (
                          <label key={value} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted">
                            <input type="radio" name="atlas-sync-preview-choice" className="mt-1 accent-atlas-orange"
                              checked={choice === value} onChange={() => setChoice(value)} />
                            <span>{label}</span>
                          </label>
                        ))}
                        <p className="mt-2 text-xs text-muted-foreground">{copy.choiceDisclaimer}</p>
                      </fieldset>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
