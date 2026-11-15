import {
  learningEvidenceByWord, type LearningObservation, type WordEntry,
} from "@yds-atlas/shared";
import { isGameReady } from "@/features/learning-game/model/game-engine";
import { dueReviews, type ReviewSchedule } from "@/features/review/model/spaced-repetition";

export type CoachTaskKind = "due" | "recover" | "strengthen" | "new";
export interface CoachTask {
  kind: CoachTaskKind;
  wordIds: string[];
  minutes: number;
  title: string;
  reason: string;
}
export interface CoachAgenda {
  tasks: CoachTask[];
  minutesPlanned: number;
  minutesRemaining: number;
  dueCount: number;
  blockedDueCount: number;
  vulnerableCount: number;
  newCount: number;
  observedWordCount: number;
  contextualDifficultyCount: number;
  dataBasis: string;
}
export interface CoachInput {
  words: readonly WordEntry[];
  schedules: readonly ReviewSchedule[];
  minutesAvailable: number;
  now: Date;
  assessments?: readonly LearningObservation[];
}
const COST: Record<CoachTaskKind, number> = { due: 2, recover: 3, strengthen: 3, new: 4 };
const TITLE: Record<CoachTaskKind, string> = {
  due: "Zamanı gelen tekrarlar",
  recover: "Yanlışları güvenle toparla",
  strengthen: "Kalıcılığı güçlendir",
  new: "Yeni kelime için ilk yoklama",
};
const BASE_REASON: Record<CoachTaskKind, string> = {
  due: "Tekrar tarihi gelmiş kelimeler; zamanından önce getirilen yok.",
  recover: "Son değerlendirmelerde unutulan veya zorlanılan kelimeler öncelikli.",
  strengthen: "Bir oturum puanı kalıcı öğrenme sayılmadı; farklı günlerde hatırlama destekleniyor.",
  new: "Kayıtlı bir oyun değerlendirmesi olmayan kelimelerle kısa başlangıç çalışması.",
};
const orderByAge = (a: WordEntry, b: WordEntry) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Honest coach v2. It does not train an LLM, infer retention probabilities,
 * regrade words, or reschedule future-due cards. It only recommends study.
 * Distinguishes a zero scored in a failed completed game from an unassessed zero.
 * Personal labels (manualGroup) never count as evidence.
 */
export function buildCoachAgenda({words, schedules, minutesAvailable, now, assessments = []}: CoachInput): CoachAgenda {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(minutesAvailable) ||
      minutesAvailable < 5 || minutesAvailable > 240) throw new Error("Geçersiz plan süresi veya tarih.");
  const library = new Map(words.filter((word) => word.id.trim()).map((word) => [word.id, word]));
  if (library.size !== words.length) throw new Error("Tekrarlanan veya kimliği olmayan kütüphane kelimesi var.");
  const evidence = learningEvidenceByWord(assessments, now);
  const scheduled = new Set(schedules.map((row) => row.wordId));
  const due: string[] = [];
  const seenDue = new Set<string>();
  let blockedDueCount = 0;
  for (const row of dueReviews(schedules, now)) {
    if (seenDue.has(row.wordId)) continue;
    seenDue.add(row.wordId);
    const word = library.get(row.wordId);
    if (!word) continue;
    if (isGameReady(word)) due.push(word.id);
    else blockedDueCount += 1;
  }
  const candidates = [...library.values()].filter((word) => !scheduled.has(word.id) && isGameReady(word));
  function isRecover(word: WordEntry) {
    const history = evidence.get(word.id);
    return history?.state === "recover" ||
      (!history && word.score > 0 && word.score < 40);
  }
  const recover = candidates.filter(isRecover).sort((a,b) => {
    const left = evidence.get(a.id),right = evidence.get(b.id);
    return (right?.recentFailures ?? 0) - (left?.recentFailures ?? 0) ||
      a.score - b.score || orderByAge(a,b);
  }).map((word) => word.id);
  const recoveryIds = new Set(recover);
  const strengthen = candidates.filter((word) => {
    if (recoveryIds.has(word.id)) return false;
    const history = evidence.get(word.id);
    // Legacy 40–100 scores are not proof of durable learning.
    return history ? history.state !== "repeated-success" : word.score > 0;
  }).sort((a,b) => a.score - b.score || orderByAge(a,b)).map((word) => word.id);
  const strengthenIds = new Set(strengthen);
  const firstLook = candidates.filter((word) =>
    !recoveryIds.has(word.id) && !strengthenIds.has(word.id) &&
    !evidence.has(word.id) && word.score === 0).sort(orderByAge).map((word) => word.id);
  const buckets: Record<CoachTaskKind,string[]> = { due, recover, strengthen, new: firstLook };
  let remaining = minutesAvailable;
  const tasks: CoachTask[] = [];
  for (const kind of ["due","recover","strengthen","new"] as const) {
    const pool = buckets[kind];
    const count = Math.min(pool.length, Math.floor(remaining / COST[kind]));
    for (let start = 0; start < count; start += 5) {
      const wordIds = pool.slice(start, Math.min(count, start + 5));
      const contextProblems = wordIds.filter((id) => evidence.get(id)?.errorFocus === "context" ||
        evidence.get(id)?.errorFocus === "both").length;
      const specific = kind === "recover" && contextProblems > 0
        ? ` ${contextProblems} kelime bağlam sorularında zorlanmış; cümle içi hatırlamaya odaklan.`
        : "";
      tasks.push({kind,wordIds,minutes:wordIds.length*COST[kind],
        title:TITLE[kind],reason:BASE_REASON[kind]+specific});
    }
    remaining -= count*COST[kind];
  }
  return {
    tasks, minutesPlanned: minutesAvailable - remaining, minutesRemaining: remaining,
    dueCount: due.length, blockedDueCount,
    vulnerableCount: recover.length + strengthen.length, newCount: firstLook.length,
    observedWordCount: [...library.keys()].filter((id) => evidence.has(id)).length,
    contextualDifficultyCount: [...library.keys()].filter((id) =>
      evidence.get(id)?.errorFocus === "context" || evidence.get(id)?.errorFocus === "both").length,
    dataBasis: "Gerçek oyun sonuçları (mevcutsa anlam/bağlam hataları), tekrar tarihleri, " +
      "eski puanlardan sınırlı kanıt ve içerik uygunluğu. Bir oturum puanı kalıcı öğrenme değildir.",
  };
}

/** Calendar dates are user's local days, not UTC midnight strings. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}
export function validCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const dt = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0,10) === day;
}
