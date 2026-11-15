import { learningEvidenceByWord, type AccountState, type WordEntry } from "@yds-atlas/shared";
import {
  ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clipboard,
  Copy, GripVertical, History, Pencil, Plus, RefreshCw, RotateCcw,
  ShieldCheck, Sparkles, Target, Trash2, TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { loadCloudReviewSchedules } from "@/features/review/api/cloud-review-schedules-api";
import { loadRecordedAssessments, type RecordedAssessment } from "../api/learning-outcomes";
import { listGuestReviewSchedules } from "@/features/review/api/guest-review-schedule-repository";
import type { ReviewSchedule } from "@/features/review/model/spaced-repetition";
import { apiRequest } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";
import {
  createCalendar, listCalendar, removeCalendar, updateCalendar,
  type CalendarDraft, type CalendarEntry, type CalendarKind,
} from "../api/calendar-events";
import { buildCoachAgenda, localDay, type CoachTask } from "../model/coach-planner";

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const KINDS: Record<CalendarKind, string> = {
  review: "Tekrar", vocabulary: "Kelime", reading: "Okuma",
  translation: "Çeviri", exam: "Deneme", custom: "Özel çalışma",
};
const KIND_TONES: Record<CalendarKind, string> = {
  review: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  vocabulary: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  reading: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  translation: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  exam: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  custom: "bg-muted text-foreground",
};
const EMPTY_DRAFT: CalendarDraft = {
  day: "", kind: "custom", title: "", notes: "", minutes: 20,
  status: "planned", origin: "manual",
};

function monthStart(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), 1); }
function shiftedMonth(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}
function calendarDays(month: Date): Date[] {
  const start = monthStart(month);
  const firstWeekday = (start.getDay() + 6) % 7;
  const first = new Date(start.getFullYear(), start.getMonth(), 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
}
function humanDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
}
function monthTitle(date: Date): string {
  return date.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}
function statusLabel(status: CalendarEntry["status"]): string {
  return status === "done" ? "Elle tamamlandı" : status === "skipped" ? "Atlandı" : "Planlandı";
}

export function ProgressPage({
  words, userId, onStartStudy, onOpenLibrary,
}: {
  words: WordEntry[];
  userId: string | null;
  onStartStudy: (wordIds: string[], title: string) => void;
  onOpenLibrary: () => void;
}) {
  // A single clock snapshot prevents inconsistent render-time dates and totals.
  // Refreshing the underlying data also refreshes the time-sensitive agenda.
  const [now, setNow] = useState(() => new Date());
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [day, setDay] = useState(() => localDay(new Date()));
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [history, setHistory] = useState<AccountState | null>(null);
  const [schedules, setSchedules] = useState<ReviewSchedule[] | null>(null);
  const [assessments, setAssessments] = useState<RecordedAssessment[] | null>(null);
  const [outcomeError, setOutcomeError] = useState("");
  const [calendarError, setCalendarError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEntry | null>(null);
  const [draft, setDraft] = useState<CalendarDraft>(EMPTY_DRAFT);
  const [copied, setCopied] = useState<CalendarDraft | null>(null);
  const [minutes, setMinutes] = useState(30);
  const request = useRef(0);
  const today = localDay(now);
  const days = useMemo(() => calendarDays(month), [month]);
  const first = localDay(days[0]);
  const last = localDay(days[days.length - 1]);
  const wordMap = useMemo(() => new Map(words.map((word) => [word.id, word])), [words]);

  const load = useCallback(async () => {
    const ticket = ++request.current;
    setLoading(true);
    // Each source is isolated: a calendar schema problem must not hide real history.
    const [calendarResult, scheduleResult, accountResult, outcomeResult] = await Promise.allSettled([
      listCalendar(userId, first, last),
      userId ? loadCloudReviewSchedules(userId)
        : Promise.resolve(listGuestReviewSchedules(window.localStorage, new Set(words.map((word) => word.id)))),
      userId ? apiRequest<AccountState>("/api/account", undefined, userId) : Promise.resolve(null),
      userId ? loadRecordedAssessments(userId) : Promise.resolve([]),
    ]);
    if (ticket !== request.current) return;
    if (calendarResult.status === "fulfilled") { setEntries(calendarResult.value); setCalendarError(""); }
    else { setEntries([]); setCalendarError(String(calendarResult.reason instanceof Error ? calendarResult.reason.message : calendarResult.reason)); }
    if (scheduleResult.status === "fulfilled") { setSchedules(scheduleResult.value); setScheduleError(""); }
    else { setSchedules(null); setScheduleError(String(scheduleResult.reason instanceof Error ? scheduleResult.reason.message : scheduleResult.reason)); }
    if (accountResult.status === "fulfilled") { setHistory(accountResult.value); setHistoryError(""); }
    else { setHistory(null); setHistoryError(String(accountResult.reason instanceof Error ? accountResult.reason.message : accountResult.reason)); }
    if (outcomeResult.status === "fulfilled") { setAssessments(outcomeResult.value); setOutcomeError(""); }
    else { setAssessments(null); setOutcomeError(String(outcomeResult.reason instanceof Error ? outcomeResult.reason.message : outcomeResult.reason)); }
    setNow(new Date());
    setLoading(false);
  }, [first, last, userId, words]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load, revision]);

  const actualByDay = useMemo(() => {
    const days = new Map<string, Set<string>>();
    for (const p of history?.progress ?? []) {
      const ids = days.get(p.day) ?? new Set<string>();
      ids.add(p.word_id);
      days.set(p.day, ids);
    }
    for (const result of assessments ?? []) {
      const day = localDay(new Date(result.completedAt));
      const ids = days.get(day) ?? new Set<string>();
      ids.add(result.wordId);
      days.set(day, ids);
    }
    return days;
  }, [history, assessments]);
  const goals = useMemo(() => new Set((history?.completedDays ?? []).map((item) => item.day)), [history]);
  const eventsByDay = useMemo(() => {
    const value = new Map<string, CalendarEntry[]>();
    for (const entry of entries) value.set(entry.day, [...(value.get(entry.day) ?? []), entry]);
    return value;
  }, [entries]);
  const dueByDay = useMemo(() => {
    const result = new Map<string, number>();
    for (const schedule of schedules ?? []) {
      if (!wordMap.has(schedule.wordId) || !Number.isFinite(Date.parse(schedule.dueAt))) continue;
      const date = localDay(new Date(schedule.dueAt));
      result.set(date, (result.get(date) ?? 0) + 1);
    }
    return result;
  }, [schedules, wordMap]);
  const coachCalculation = useMemo(() => {
    if (schedules === null || (userId && (assessments === null || history === null)))
      return { agenda: null, error: "" };
    try {
      return { agenda: buildCoachAgenda({ words, schedules, minutesAvailable: minutes,
        now, timeZone, assessments: assessments ?? [] }), error: "" };
    } catch (error) {
      // Fail closed. A malformed history cannot take down the entire page.
      return { agenda: null, error: error instanceof Error ? error.message : "Koç verisi geçersiz." };
    }
  }, [words, schedules, minutes, history, assessments, userId, now, timeZone]);
  const agenda = coachCalculation.agenda;
  // Evidence-based insights: a verified session is not a promise of mastery.
  const learningSignals = useMemo(() => {
    if (assessments === null) return null;
    const knownWords = new Set(words.map((word) => word.id));
    let observed: ReturnType<typeof learningEvidenceByWord>;
    try { observed = learningEvidenceByWord(assessments, now, timeZone); }
    catch { return null; }
    const active = [...observed].filter(([id]) => knownWords.has(id));
    return {
      observed: active.length,
      context: active.filter(([, item]) => item.errorFocus === "context" || item.errorFocus === "both").length,
      recover: active.filter(([, item]) => item.state === "recover").length,
      repeated: active.filter(([, item]) => item.state === "repeated-success").length,
    };
  }, [assessments, words, now, timeZone]);
  const chosenEntries = eventsByDay.get(day) ?? [];
  const actualToday = actualByDay.get(today)?.size ?? 0;
  const activeDays = [...actualByDay.keys()].filter((d) => {
    const daysAgo = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000;
    return daysAgo >= 0 && daysAgo < 7;
  }).length;
  const dueNow = (schedules ?? []).filter((s) => wordMap.has(s.wordId) && Date.parse(s.dueAt) <= now.getTime()).length;
  const upcoming = entries.filter((e) => e.day >= today && e.status === "planned").length;

  function moveMonth(amount: number) {
    const target = shiftedMonth(month, amount);
    setMonth(target);
    setDay(localDay(target));
    setNotice("");
  }
  function edit(entry?: CalendarEntry) {
    setNotice("");
    setEditing(entry ?? null);
    setDraft(entry ? {
      day: entry.day, kind: entry.kind, title: entry.title, notes: entry.notes,
      minutes: entry.minutes, status: entry.status, origin: entry.origin,
    } : { ...EMPTY_DRAFT, day });
    setFormOpen(true);
  }
  async function mutate(task: () => Promise<unknown>, message: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setNotice("");
    try {
      await task();
      setRevision((value) => value + 1);
      setNotice(message);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Takvim işlemi başarısız.");
      setRevision((value) => value + 1); // Refresh on optimistic conflict; never silently overwrite.
      return false;
    } finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = { ...draft };
    // Do not discard the user's draft when a write fails or a revision conflicts.
    const saved = await mutate(() => editing
      ? updateCalendar(userId, editing, value)
      : createCalendar(userId, value), editing ? "Çalışma güncellendi." : "Takvime eklendi.");
    if (saved) setFormOpen(false);
  }
  async function moveEntry(entry: CalendarEntry, target: string) {
    if (entry.day === target) return;
    await mutate(() => updateCalendar(userId, entry, {
      day: target, kind: entry.kind, title: entry.title, notes: entry.notes,
      minutes: entry.minutes, status: entry.status, origin: entry.origin,
    }), "Etkinlik başka güne taşındı.");
  }
  async function copyToDay() {
    if (!copied) return;
    await mutate(() => createCalendar(userId, { ...copied, day, status: "planned" }), "Çalışma bu güne kopyalandı.");
  }
  function copyEntry(entry: CalendarEntry) {
    setCopied({ day: entry.day, kind: entry.kind, title: entry.title, notes: entry.notes,
      minutes: entry.minutes, status: "planned", origin: entry.origin });
    setNotice("Kopyalandı. Hedef günü seçip 'Yapıştır' düğmesine bas.");
  }
  async function storeCoachTask(task: CoachTask) {
    const labels = task.wordIds.map((id) => wordMap.get(id)?.word).filter(Boolean).join(", ");
    await mutate(() => createCalendar(userId, {
      day, kind: task.kind === "new" ? "vocabulary" : "review",
      title: task.title, minutes: task.minutes < 5 ? 5 : task.minutes,
      notes: `${task.reason}\nÖnerilen kelimeler: ${labels}`.slice(0, 1500),
      status: "planned", origin: "coach",
    }), "Koçun önerisi seçili güne kaydedildi (öğrenildi sayılmadı).");
  }
  const dayHistoryWords = [...(actualByDay.get(day) ?? [])]
    .map((id) => wordMap.get(id)?.word ?? "Kütüphaneden kaldırılmış kelime").slice(0, 25);
  const dayDueWords = (schedules ?? [])
    .filter((item) => wordMap.has(item.wordId) && localDay(new Date(item.dueAt)) === day)
    .map((item) => wordMap.get(item.wordId)?.word ?? "")
    .filter(Boolean).slice(0, 30);

  return (
    <div className="space-y-6 text-foreground" data-testid="progress-calendar-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-atlas-blue"><Sparkles size={15}/> ATLAS · İLERLEME MERKEZİ</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Öğrenmenin kontrol paneli</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Gerçek çalışmaların, tekrar takvimin, kişisel koçun ve kendi planların tek yerde. Artık gün numarası seçmek zorunda değilsin.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={16}/> Yenile</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Bugün çalışılan kelime", value: userId ? actualToday : "—", icon: <ShieldCheck size={17}/>, hint: userId ? "Hesapta kayıtlı sonuçlar" : "Misafir için ayrıntılı geçmiş yok" },
          { label: "Zamanı gelen tekrar", value: schedules ? dueNow : "—", icon: <RotateCcw size={17}/>, hint: "Tüm kütüphanede" },
          { label: "Son 7 gün aktif", value: history ? activeDays : "—", icon: <TrendingUp size={17}/>, hint: "Kayıtlı öğrenme günleri" },
          { label: "Planlanan etkinlikler", value: upcoming, icon: <Target size={17}/>, hint: "Görünen takvim aralığında" },
        ].map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 text-muted-foreground"><span className="text-xs">{metric.label}</span>{metric.icon}</div>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{metric.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
          </div>
        ))}
      </div>
      {!userId && (
        <p role="status" className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Misafir koçu yalnız yerel kelime puanları ve tekrar takvimine göre sınırlı öneri verir.
          Ayrıntılı oyun değerlendirme geçmişi bulunmadığından kalıcı öğrenme kanıtı hesaplanmaz.
        </p>
      )}
      {userId && (
        <p role="status" className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Koç hesabında kayıtlı çalışma sonuçlarını kullanır. Sunucu doğrulamalı sonuç yazımı
          aşaması tamamlanana kadar bu kayıtlar bağımsız olarak doğrulanmış öğrenme kanıtı sayılmaz.
        </p>
      )}
      {userId && learningSignals !== null && (
        <section aria-label="Öğrenme kanıtının durumu" className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,120px))] md:items-center">
          <div>
            <p className="text-sm font-semibold text-foreground">Nasıl öğrendiğini anlamaya başlıyoruz</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Yalnızca kaydedilmiş oyunlar değerlendirilir. “Başarılı oturum”, “kalıcı öğrendim” anlamına gelmez. Veriler arttıkça öneriler değişir.</p>
          </div>
          <div className="rounded-xl bg-muted/60 p-3"><strong className="text-xl tabular-nums">{learningSignals.observed}</strong><p className="text-xs text-muted-foreground">oyun değerlendirme kaydı bulunan kelime</p></div>
          <div className="rounded-xl bg-muted/60 p-3"><strong className="text-xl tabular-nums">{learningSignals.recover}</strong><p className="text-xs text-muted-foreground">yeniden güçlendirilecek</p></div>
          <div className="rounded-xl bg-muted/60 p-3"><strong className="text-xl tabular-nums">{learningSignals.context}</strong><p className="text-xs text-muted-foreground">bağlamda zorlanılan</p></div>
        </section>
      )}
      {coachCalculation.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-200">Öğrenme kanıtı doğrulanamadı: {coachCalculation.error}. Yanlış bir plan gösterilmedi.</p>}
      {(calendarError || scheduleError || historyError || outcomeError) && (
        <div className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
          {calendarError && <p>Takvim: {calendarError}</p>}
          {scheduleError && <p>Tekrar takvimi: {scheduleError} Eksik takvimle koç önerisi üretilmez.</p>}
          {historyError && <p>Geçmiş: {historyError}</p>}
          {outcomeError && <p>Oyun değerlendirmeleri: {outcomeError}</p>}
        </div>
      )}
      <section aria-labelledby="coach-title" className="overflow-hidden rounded-2xl border border-atlas-blue/25 bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-atlas-blue/5 p-5">
          <div>
            <p className="text-xs font-semibold text-atlas-blue"><Sparkles size={14} className="mr-1 inline"/> AÇIKLANABİLİR ÖĞRENME KOÇU</p>
            <h2 id="coach-title" className="mt-1 text-xl font-semibold">Bugün neye çalışmalısın?</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">Tüm kütüphane ve zamanı gelen tekrarlar taranır. Düşük değerlendirmeler ve yeni kelimeler süreye göre dengelenir.</p>
          </div>
          <label className="text-sm font-medium">Süren
            <select className="ml-2 rounded-lg border border-border bg-background p-2 text-foreground" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
              {[15,20,30,45,60,90].map((n) => <option key={n} value={n}>{n} dk</option>)}
            </select>
          </label>
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          {agenda ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{agenda.dueCount} zamanı gelen</span><span>·</span>
                <span>{agenda.vulnerableCount} güçlendirme adayı</span><span>·</span>
                <span>{agenda.newCount} ilk yoklama</span><span>·</span>
                <strong className="text-foreground">{agenda.minutesPlanned} dk planlandı, {agenda.minutesRemaining} dk boş</strong>
              </div>
              <p className="text-xs text-muted-foreground" role="status">{agenda.observedWordCount} kelime için oyun kanıtı var. {agenda.contextualDifficultyCount > 0 ? `${agenda.contextualDifficultyCount} kelimede bağlam hatası kaydedildi; önerilerde bunu dikkate aldık.` : "Henüz ayrıntılı bağlam hatası ölçümü bulunmayabilir."}</p>
              {agenda.blockedDueCount > 0 && <p className="text-sm text-amber-600">{agenda.blockedDueCount} tekrarın çalışma içeriği eksik; oyuna gönderilmiyor.</p>}
              {agenda.tasks.length ? agenda.tasks.map((task, index) => (
                <div key={`${task.kind}-${index}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-atlas-blue/10 font-semibold text-atlas-blue">{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{task.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{task.wordIds.length} kelime · {task.minutes} dk · {task.reason}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void storeCoachTask(task)} disabled={busy || Boolean(calendarError)} title="Seçili takvim gününe kopyala"><CalendarDays size={15}/> Takvime ekle</Button>
                  <Button size="sm" onClick={() => onStartStudy(task.wordIds, task.title)}>Çalış <ArrowRight size={14}/></Button>
                </div>
              )) : <p className="rounded-lg bg-muted p-4 text-sm">Bu süre için çalışmaya hazır öneri bulunamadı. <button className="underline" onClick={onOpenLibrary}>Kütüphaneyi aç.</button></p>}
              <p className="text-xs text-muted-foreground">{userId ? agenda.dataBasis : "Misafir modunda ayrıntılı oyun sonucu bulunmaz; öneriler mevcut puanlar ve tekrar tarihlerinden oluşturulur. Bir oturum puanı kalıcı öğrenme değildir."} Bu sürüm kural tabanlıdır; AI tarafından incelenmiş gibi gösterilmez. Öğrenme puanları yalnızca oyun sonucuyla değişir.</p>
            </>
          ) : <p className="text-sm text-muted-foreground">Tekrar takvimi okununca koç önerileri burada görünecek.</p>}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.85fr)]">
        <section aria-label="Çalışma takvimi" className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Çalışma takvimi</p>
              <h2 className="mt-1 text-xl font-semibold capitalize">{monthTitle(month)}</h2>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => { const current = new Date(); setNow(current); setMonth(monthStart(current)); setDay(localDay(current)); }}>Bugün</Button>
              <Button variant="ghost" size="icon" aria-label="Önceki ay" onClick={() => moveMonth(-1)}><ChevronLeft size={18}/></Button>
              <Button variant="ghost" size="icon" aria-label="Sonraki ay" onClick={() => moveMonth(1)}><ChevronRight size={18}/></Button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">Çalışmaları günler arasında sürükleyebilirsin. Mobilde etkinlik düzenle → tarih değiştir. Kopyala/Yapıştır da desteklenir.</p>
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[580px]">
              <div className="mb-1 grid grid-cols-7 gap-1">{DAYS.map((name) => <span key={name} className="py-2 text-center text-xs font-semibold text-muted-foreground">{name}</span>)}</div>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((date) => {
                  const key = localDay(date);
                  const dayEntries = eventsByDay.get(key) ?? [];
                  const count = actualByDay.get(key)?.size ?? 0;
                  const due = dueByDay.get(key) ?? 0;
                  const active = key === day;
                  return (
                    <div key={key} role="button" tabIndex={0}
                      aria-label={`${humanDay(key)}; ${count} kayıtlı kelime; ${dayEntries.length} plan; ${due} tekrar tarihi`}
                      aria-pressed={active}
                      onClick={() => setDay(key)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDay(key); } }}
                      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-atlas-event")) event.preventDefault(); }}
                      onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("application/x-atlas-event"); const entry = entries.find((item) => item.id === id); if (entry) void moveEntry(entry, key); }}
                      className={`min-h-25 cursor-pointer rounded-xl border p-2 text-left transition focus-visible:outline-2 focus-visible:outline-atlas-blue ${active ? "border-atlas-blue bg-atlas-blue/10 ring-1 ring-atlas-blue/40" : "border-border bg-background hover:bg-muted/60"} ${date.getMonth() !== month.getMonth() ? "opacity-45" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${key === today ? "bg-atlas-orange text-white" : ""}`}>{date.getDate()}</span>
                        {goals.has(key) && <Check size={12} className="text-emerald-500" aria-label="Gerçek hedef tamamlandı"/>}
                      </div>
                      {count > 0 && <p className="mt-1 truncate text-[10px] text-emerald-600 dark:text-emerald-400">✓ {count} kelime</p>}
                      {due > 0 && <p className="mt-1 truncate text-[10px] text-blue-600 dark:text-blue-300">↻ {due} tekrar</p>}
                      {dayEntries.slice(0, 2).map((entry) => (
                        <div key={entry.id} draggable={!busy}
                          onDragStart={(event) => { event.dataTransfer.setData("application/x-atlas-event", entry.id); event.dataTransfer.effectAllowed = "move"; }}
                          title={`${entry.title} — ${statusLabel(entry.status)} (sürükleyerek taşı)`}
                          className={`mt-1 flex items-center gap-0.5 truncate rounded px-1 py-0.5 text-[10px] font-medium ${KIND_TONES[entry.kind]} ${entry.status === "done" ? "line-through opacity-70" : ""}`}>
                          <GripVertical size={10} className="shrink-0"/><span className="truncate">{entry.title}</span>
                        </div>
                      ))}
                      {dayEntries.length > 2 && <span className="text-[10px] text-muted-foreground">+{dayEntries.length - 2} etkinlik</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="text-emerald-600">✓ Kayıtlı çalışma</span><span className="text-blue-600 dark:text-blue-300">↻ Takvimli tekrar</span><span>▰ Kullanıcı planı</span></div>
        </section>
        <aside className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="Seçili gün detayları">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-xs font-semibold uppercase text-muted-foreground">Seçili gün</p><h2 className="mt-1 text-lg font-semibold capitalize">{humanDay(day)}</h2></div>
            <Button size="sm" onClick={() => edit()}><Plus size={15}/> Ekle</Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-muted p-3"><p className="text-muted-foreground">Gerçek çalışma</p><strong className="mt-1 block text-lg">{dayHistoryWords.length}{dayHistoryWords.length >= 25 ? "+" : ""} kelime</strong></div>
            <div className="rounded-xl bg-muted p-3"><p className="text-muted-foreground">Tekrar tarihi</p><strong className="mt-1 block text-lg">{dueByDay.get(day) ?? 0} kelime</strong></div>
          </div>
          {dayHistoryWords.length > 0 && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300"><ShieldCheck size={13} className="mr-1 inline"/> Kayıtlı çalışma</p><p className="mt-1 text-xs text-foreground">{dayHistoryWords.join(", ")}</p></div>}
          {dayDueWords.length > 0 && <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3"><p className="text-xs font-semibold text-blue-700 dark:text-blue-300"><RotateCcw size={13} className="mr-1 inline"/> Bu tarihe planlanmış tekrarlar</p><p className="mt-1 text-xs text-foreground">{dayDueWords.join(", ")}</p></div>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <strong className="text-sm">Planların · {chosenEntries.length}</strong>
            {copied && <Button size="sm" variant="outline" onClick={() => void copyToDay()} disabled={busy}><Clipboard size={14}/> Yapıştır</Button>}
          </div>
          {chosenEntries.length ? chosenEntries.map((entry) => (
            <div key={entry.id} className="space-y-2 rounded-xl border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{entry.title}</p><p className="mt-1 text-xs text-muted-foreground">{KINDS[entry.kind]} · {entry.minutes} dk · {statusLabel(entry.status)}</p></div>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${KIND_TONES[entry.kind]}`}>{entry.origin === "coach" ? "Koç önerisi" : "Kişisel"}</span>
              </div>
              {entry.notes && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{entry.notes}</p>}
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => edit(entry)} disabled={busy}><Pencil size={13}/> Düzenle/Taşı</Button>
                <Button size="sm" variant="ghost" onClick={() => copyEntry(entry)}><Copy size={13}/> Kopyala</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                  const next = new Date(`${entry.day}T12:00:00`);
                  next.setDate(next.getDate() + 7);
                  void mutate(() => createCalendar(userId, {
                    day: localDay(next), kind: entry.kind, title: entry.title, notes: entry.notes,
                    minutes: entry.minutes, status: "planned", origin: entry.origin,
                  }), "Çalışma 7 gün sonrasına kopyalandı.");
                }}>+7 gün</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void mutate(() => updateCalendar(userId, entry, {
                  day: entry.day, kind: entry.kind, title: entry.title, notes: entry.notes,
                  minutes: entry.minutes, origin: entry.origin, status: entry.status === "done" ? "planned" : "done",
                }), "Kişisel plan durumu değiştirildi; öğrenme puanı etkilenmez.") }><Check size={13}/> {entry.status === "done" ? "Geri al" : "Yapıldı"}</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Bu takvim kaydı silinsin mi?")) void mutate(() => removeCalendar(userId, entry), "Takvimden kaldırıldı."); }} disabled={busy} aria-label={`${entry.title} kaydını sil`}><Trash2 size={13}/></Button>
              </div>
            </div>
          )) : <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Bu güne manuel plan eklenmemiş.</p>}
          {notice && <p role="status" className="rounded-lg bg-muted p-3 text-xs">{notice}</p>}
          {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={13} className="animate-spin"/> Kayıtlar okunuyor…</p>}
          <div className="border-t border-border pt-4 text-xs text-muted-foreground"><History size={14} className="mr-1 inline"/> Kişisel etkinliği elle tamamlamak, oyun başarısı veya kalıcı öğrenme puanı değildir. Gerçek sonuçlar yalnızca oyun kayıtlarından hesaplanır.</div>
        </aside>
      </div>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="Son çalışma geçmişi">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><History size={19}/> Gerçek çalışma geçmişin</h2>
        <p className="mt-1 text-xs text-muted-foreground">Hesapta kayıtlı çalışma sonuçları; kişisel takvim notlarından ayrıdır. Sonuçların güvenilir sunucu yazıcısı geçişi tamamlanmamıştır.</p>
        {actualByDay.size ? <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{[...actualByDay.entries()].sort(([a],[b]) => b.localeCompare(a)).slice(0, 12).map(([date, ids]) => (
          <div key={date} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{humanDay(date)}</p><strong className="mt-1 block text-sm">{ids.size} kelime · {goals.has(date) ? "Kayıtlı günlük hedef" : "Kayıtlı çalışma"}</strong><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{[...ids].map((id) => wordMap.get(id)?.word ?? "Silinmiş kelime").slice(0, 8).join(", ")}</p></div>
        ))}</div> : <p className="mt-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">Henüz doğrulanmış tamamlanan çalışma kaydı bulunamadı. Takvimdeki manuel görevler bu istatistiğe eklenmez.</p>}
      </section>
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false); }}>
          <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-label="Takvim etkinliği düzenle" className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl">
            <div><h2 className="text-xl font-semibold">{editing ? "Çalışmayı düzenle" : "Yeni çalışma ekle"}</h2><p className="mt-1 text-xs text-muted-foreground">Taşımak için tarihi değiştir; kaydettiğinde mevcut veriler korunur.</p></div>
            <label className="block text-sm font-medium">Başlık
              <input autoFocus required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-foreground" placeholder="Örn. Reading + kelime tekrarı"/>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">Tarih
                <input type="date" required value={draft.day} onChange={(event) => setDraft({ ...draft, day: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-foreground"/>
              </label>
              <label className="block text-sm font-medium">Tür
                <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as CalendarKind })} className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-foreground">{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="block text-sm font-medium">Süre (dakika)
                <input type="number" min={5} max={240} step={5} required value={draft.minutes} onChange={(event) => setDraft({ ...draft, minutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-foreground"/>
              </label>
              <label className="block text-sm font-medium">Durum
                <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CalendarDraft["status"] })} className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-foreground"><option value="planned">Planlandı</option><option value="done">Elle tamamlandı</option><option value="skipped">Atlandı</option></select>
              </label>
            </div>
            <label className="block text-sm font-medium">Not
              <textarea rows={3} maxLength={1500} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-foreground" placeholder="Hangi konulara çalışacağım?"/>
            </label>
            {notice && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">{notice}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Vazgeç</Button><Button type="submit" disabled={busy}><Check size={15}/> Kaydet</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}
