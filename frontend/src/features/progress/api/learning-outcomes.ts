import type { LearningObservation, RecallConfidence } from "@yds-atlas/shared";
import { supabase } from "@/shared/api/supabase-client";

export type RecordedAssessment = LearningObservation;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 150;
const MAX_RESULTS = 900;
const MAX_PER_SESSION = 100;

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}
function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
function confidence(value: unknown): RecallConfidence {
  return value === -10 || value === 0 || value === 20 ? value : null;
}
function extractAssessment(snapshot: unknown, wordId: string) {
  const missing = { meaningCorrect: null, contextCorrect: null, matchingErrors: null,
    meaningConfidence: null, contextConfidence: null };
  if (!isRecord(snapshot) || snapshot.version !== 3 || snapshot.phase !== "complete" ||
      snapshot.tutorial !== false || !isRecord(snapshot.assessment)) return missing;
  const item = snapshot.assessment[wordId];
  if (!isRecord(item) || item.matchingDone !== true ||
      !isRecord(item.meaning) || !isRecord(item.context) ||
      !Number.isSafeInteger(item.matchingErrors) || (item.matchingErrors as number) < 0) return missing;
  const meaningCorrect = boolOrNull(item.meaning.correct);
  const contextCorrect = boolOrNull(item.context.correct);
  if (meaningCorrect === null || contextCorrect === null) return missing;
  return {
    meaningCorrect, contextCorrect, matchingErrors: item.matchingErrors as number,
    meaningConfidence: confidence(item.meaning.confidence),
    contextConfidence: confidence(item.context.confidence),
  };
}

/**
 * Reads authenticated, owner-RLS protected completed sessions only.
 * No service-role key, no guessed question-level details, and no silent 1000-row
 * truncation. Future-dated or malformed rows fail closed rather than bias coaching.
 */
export async function loadRecordedAssessments(userId: string): Promise<RecordedAssessment[]> {
  if (!supabase || !UUID.test(userId)) throw new Error("Öğrenme geçmişi için geçerli bir oturum gerekli.");
  const session = await supabase.auth.getSession();
  if (session.error || session.data.session?.user.id !== userId)
    throw new Error("Hesap oturumu değişti. Öğrenme geçmişi okunamadı.");
  const results: Array<{ sessionId: string; scores: unknown[]; completedAt: string }> = [];
  // A 180-day evidence window bounds data retrieval without pretending that
  // older learning events never happened. Long-term mastery remains uncalibrated.
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  for (let offset = 0; offset < MAX_RESULTS; offset += PAGE) {
    const { data, error } = await supabase.from("learning_results")
      .select("session_id,scores,completed_at")
      .eq("user_id", userId).gte("completed_at", since)
      .order("completed_at", { ascending: false }).order("session_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Değerlendirmeler okunamadı: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Değerlendirme sayfalaması doğrulanamadı.");
    for (const row of data) {
      if (!UUID.test(row.session_id) || typeof row.completed_at !== "string" ||
          !Number.isFinite(Date.parse(row.completed_at)) || !Array.isArray(row.scores) ||
          row.scores.length < 1 || row.scores.length > MAX_PER_SESSION)
        throw new Error("Değerlendirme kaydının yapısı geçersiz.");
      results.push({ sessionId: row.session_id, scores: row.scores, completedAt: row.completed_at });
    }
    if (data.length < PAGE) break;
    if (offset + PAGE >= MAX_RESULTS)
      throw new Error("Geçmiş çok büyük: eksik verilerle koç önerisi üretilmez.");
  }
  const allSnapshots = new Map<string, unknown>();
  const ids = [...new Set(results.map((row) => row.sessionId))];
  for (let i = 0; i < ids.length; i += 75) {
    const batch = ids.slice(i, i + 75);
    const { data, error } = await supabase.from("learning_sessions")
      .select("id,snapshot").eq("user_id", userId).in("id", batch);
    if (error) throw new Error(`Oyun detayları okunamadı: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Oyun detayları doğrulanamadı.");
    for (const row of data) if (typeof row.id === "string") allSnapshots.set(row.id, row.snapshot);
  }
  const output: RecordedAssessment[] = [];
  const seenSessions = new Set<string>();
  for (const result of results) {
    if (seenSessions.has(result.sessionId)) throw new Error("Yinelenen oyun sonucu var.");
    seenSessions.add(result.sessionId);
    const snapshot = allSnapshots.get(result.sessionId);
    const seenWords = new Set<string>();
    for (const raw of result.scores) {
      if (!isRecord(raw) || typeof raw.id !== "string" || !UUID.test(raw.id) ||
          !Number.isInteger(raw.score) || (raw.score as number) < 0 || (raw.score as number) > 100 ||
          seenWords.has(raw.id)) throw new Error("Değerlendirme puanı veya kelime kimliği geçersiz.");
      seenWords.add(raw.id);
      output.push({ wordId: raw.id, sessionId: result.sessionId, score: raw.score as number,
        completedAt: new Date(result.completedAt).toISOString(), ...extractAssessment(snapshot, raw.id) });
    }
  }
  const latest = await supabase.auth.getSession();
  if (latest.error || latest.data.session?.user.id !== userId)
    throw new Error("Oturum değişti. Başka hesaba ait veriler gösterilmeyecek.");
  return output;
}
