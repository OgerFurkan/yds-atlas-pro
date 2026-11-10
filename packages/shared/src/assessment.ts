import type { Confidence, WordAssessment } from "./learning-game";

export function emptyAssessment(): WordAssessment {
  return { matchingErrors: 0, matchingDone: false, meaning: null, context: null };
}

function confidenceFactor(confidence: Confidence | null) {
  return confidence === 20 ? 1 : confidence === 0 ? 0.85 : confidence === -10 ? 0.6 : 0;
}

// Recognition alone cannot put a word in the learned group: context carries half the weight.
export function assessmentScore(assessment: WordAssessment | undefined) {
  if (!assessment) return 0;
  const matching = assessment.matchingDone ? Math.max(0, 20 - assessment.matchingErrors * 10) : 0;
  const meaning = assessment.meaning?.correct
    ? 30 * confidenceFactor(assessment.meaning.confidence)
    : 0;
  const context = assessment.context?.correct
    ? 50 * confidenceFactor(assessment.context.confidence)
    : 0;
  return Math.round(matching + meaning + context);
}
