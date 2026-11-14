import type { GameSession } from "@yds-atlas/shared";
import type { ReviewRating } from "./spaced-repetition";

export interface RatedWord {
  wordId: string;
  rating: ReviewRating;
}

/**
 * Only complete v3 game assessments can become review outcomes.
 * The older v2 score delta, tutorial sessions and unfinished assessments
 * do not contain enough trusted evidence for this mapping.
 *
 * This function is pure: it never changes the stored score or schedule.
 */
export function rateCompletedGame(session: GameSession): RatedWord[] {
  if (session.version !== 3 || session.tutorial || session.phase !== "complete" ||
      session.queue.length !== 0 || session.words.length === 0 || session.words.length > 100) {
    throw new Error("Tamamlanmamis veya desteklenmeyen gorev tekrar takvimine yazilamaz.");
  }

  const seen = new Set<string>();
  return session.words.map((word) => {
    if (!word.id.trim() || seen.has(word.id))
      throw new Error("Gorevde gecersiz veya tekrarlanan kelime kimligi var.");
    seen.add(word.id);
    const assessment = session.assessment[word.id];
    if (!assessment || !assessment.matchingDone ||
        !Number.isSafeInteger(assessment.matchingErrors) || assessment.matchingErrors < 0 ||
        !assessment.meaning || !assessment.context ||
        (assessment.meaning.correct && assessment.meaning.confidence === null) ||
        (assessment.context.correct && assessment.context.confidence === null)) {
      throw new Error("Kelimenin son degerlendirmesi eksik.");
    }

    let rating: ReviewRating;
    if (!assessment.meaning.correct || !assessment.context.correct) {
      rating = "again";
    } else if (assessment.matchingErrors > 0 ||
        assessment.meaning.confidence === -10 || assessment.context.confidence === -10) {
      rating = "hard";
    } else if (assessment.meaning.confidence === 20 && assessment.context.confidence === 20) {
      rating = "easy";
    } else {
      rating = "good";
    }
    return { wordId: word.id, rating };
  });
}
