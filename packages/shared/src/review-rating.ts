import type { GameSession } from "./learning-game";

export type ReviewRating = "again" | "hard" | "good" | "easy";
export interface RatedWord { wordId: string; rating: ReviewRating }

/** One canonical, pure game-to-SRS mapping shared by guest and server writers. */
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
    if (!assessment.meaning.correct || !assessment.context.correct) rating = "again";
    else if (assessment.matchingErrors > 0 || assessment.meaning.confidence === -10 ||
             assessment.context.confidence === -10) rating = "hard";
    else if (assessment.meaning.confidence === 20 && assessment.context.confidence === 20) rating = "easy";
    else rating = "good";
    return { wordId: word.id, rating };
  });
}
