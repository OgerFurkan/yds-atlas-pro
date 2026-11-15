/**
 * Learning evidence v2: strictly observational, never a calibrated probability.
 * An assessment score describes ONE completed game, not long-term mastery.
 * Unknown fields remain null; legacy data must not be upgraded into invented recall history.
 */
export type RecallConfidence = -10 | 0 | 20 | null;
export type EvidenceState = "not-assessed" | "recover" | "building" | "repeated-success";
export type ErrorFocus = "meaning" | "context" | "both" | "unknown";

export interface LearningObservation {
  wordId: string;
  sessionId: string;
  completedAt: string;
  score: number;
  /** Available only for verified v3 final-stage assessments. */
  meaningCorrect: boolean | null;
  contextCorrect: boolean | null;
  matchingErrors: number | null;
  meaningConfidence: RecallConfidence;
  contextConfidence: RecallConfidence;
}

export interface LearningEvidenceSummary {
  state: EvidenceState;
  observedSessions: number;
  observedDays: number;
  lastScore: number | null;
  lastCompletedAt: string | null;
  recentFailures: number;
  consecutiveSuccessfulSessions: number;
  meaningErrors: number;
  contextErrors: number;
  supportedContextObservations: number;
  errorFocus: ErrorFocus;
  dataQuality: "none" | "legacy-scores" | "detailed";
}

const EMPTY: LearningEvidenceSummary = {
  state: "not-assessed", observedSessions: 0, observedDays: 0,
  lastScore: null, lastCompletedAt: null, recentFailures: 0,
  consecutiveSuccessfulSessions: 0, meaningErrors: 0,
  contextErrors: 0, supportedContextObservations: 0,
  errorFocus: "unknown", dataQuality: "none",
};

/** A separate reliability gate: do not infer 'mastered' from one high score. */
function successful(observation: LearningObservation): boolean {
  if (observation.meaningCorrect !== null && observation.contextCorrect !== null)
    return observation.meaningCorrect && observation.contextCorrect;
  // For old data, the score is an imperfect signal, NOT proof of contextual recall.
  return observation.score >= 80;
}
function failure(observation: LearningObservation): boolean {
  if (observation.meaningCorrect === false || observation.contextCorrect === false) return true;
  return observation.score < 40;
}
function validObservation(row: LearningObservation): boolean {
  return typeof row.wordId === "string" && row.wordId.length > 0 &&
    typeof row.sessionId === "string" && row.sessionId.length > 0 &&
    Number.isInteger(row.score) && row.score >= 0 && row.score <= 100 &&
    Number.isFinite(Date.parse(row.completedAt)) &&
    (row.meaningCorrect === null || typeof row.meaningCorrect === "boolean") &&
    (row.contextCorrect === null || typeof row.contextCorrect === "boolean") &&
    (row.matchingErrors === null || (Number.isSafeInteger(row.matchingErrors) && row.matchingErrors >= 0)) &&
    ([null, -10, 0, 20] as readonly unknown[]).includes(row.meaningConfidence) &&
    ([null, -10, 0, 20] as readonly unknown[]).includes(row.contextConfidence);
}

/** Deterministic, duplicate-resistant summary over real completed sessions. */
export function summarizeLearningEvidence(
  wordId: string,
  input: readonly LearningObservation[],
  now = new Date(),
): LearningEvidenceSummary {
  const limit = now.getTime();
  if (!Number.isFinite(limit)) throw new Error("Geçersiz değerlendirme tarihi.");
  const unique = new Map<string, LearningObservation>();
  for (const row of input) {
    if (!validObservation(row)) throw new Error("Öğrenme kanıtı geçersiz.");
    if (row.wordId !== wordId) continue;
    const timestamp = Date.parse(row.completedAt);
    // Future-dated entries cannot make a learner look more practiced.
    if (timestamp > limit + 5 * 60_000) continue;
    const previous = unique.get(row.sessionId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row))
      throw new Error("Aynı oturum için çelişkili değerlendirmeler var.");
    unique.set(row.sessionId, row);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    Date.parse(b.completedAt) - Date.parse(a.completedAt) || a.sessionId.localeCompare(b.sessionId));
  if (!ordered.length) return { ...EMPTY };
  const recent = ordered.slice(0, 5);
  const failed = recent.filter(failure).length;
  let successStreak = 0;
  for (const row of ordered) { if (!successful(row)) break; successStreak += 1; }
  const days = new Set(ordered.map((row) => row.completedAt.slice(0, 10)));
  // Only verified detailed successes in the current uninterrupted success run
  // may establish independent successful recall days. Failures or legacy
  // high scores must never supply the missing proof.
  const verifiedStreak = ordered.slice(0, successStreak).filter((row) =>
    row.meaningCorrect === true && row.contextCorrect === true);
  const verifiedSuccessDays = new Set(verifiedStreak.map((row) => row.completedAt.slice(0, 10)));
  const detailed = ordered.filter((row) => row.meaningCorrect !== null && row.contextCorrect !== null);
  const meaningErrors = detailed.filter((row) => row.meaningCorrect === false).length;
  const contextErrors = detailed.filter((row) => row.contextCorrect === false).length;
  const focus: ErrorFocus = detailed.length === 0 ? "unknown"
    : meaningErrors > 0 && contextErrors > 0 ? "both"
    : meaningErrors > 0 ? "meaning"
    : contextErrors > 0 ? "context" : "unknown";
  // 'repeated-success' is deliberately NOT named 'mastered' and does not
  // estimate a retention probability. It requires independent successes across days.
  const state: EvidenceState = failure(ordered[0]) || failed >= 2
    ? "recover"
    : successStreak >= 3 && verifiedStreak.length >= 3 && verifiedSuccessDays.size >= 2
      ? "repeated-success" : "building";
  return {
    state, observedSessions: ordered.length, observedDays: days.size,
    lastScore: ordered[0].score, lastCompletedAt: ordered[0].completedAt,
    recentFailures: failed, consecutiveSuccessfulSessions: successStreak,
    meaningErrors, contextErrors, supportedContextObservations: detailed.length,
    errorFocus: focus,
    dataQuality: detailed.length ? "detailed" : "legacy-scores",
  };
}

export function learningEvidenceByWord(
  input: readonly LearningObservation[], now = new Date(),
): Map<string, LearningEvidenceSummary> {
  const groups = new Map<string, LearningObservation[]>();
  for (const observation of input) {
    const group = groups.get(observation.wordId) ?? [];
    group.push(observation); groups.set(observation.wordId, group);
  }
  return new Map([...groups].map(([wordId, rows]) => [wordId, summarizeLearningEvidence(wordId, rows, now)]));
}
