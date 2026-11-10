import type { WordEntry } from "@yds-atlas/shared";
import { getStarterWord, starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
import { wordKey } from "@/features/word-library/model/word-normalization";
import { escapeRegExp } from "@/shared/lib/regexp";
import { assessmentScore, emptyAssessment } from "./assessment";
import type { Confidence, GameSession } from "./game-session";
import { startMatchingBoard } from "./matching-engine";

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function wordPattern(word: WordEntry) {
  const alternatives = [word.word, ...word.alternatives]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return new RegExp(`(^|[^a-z])(${alternatives.join("|")})(?=$|[^a-z])`, "i");
}

export function usableExamples(word: WordEntry) {
  return word.examples.filter((example) => wordPattern(word).test(example.sentence));
}

export function isGameReady(word: WordEntry) {
  return word.score < 80 && word.meanings.length > 0 && usableExamples(word).length >= 5;
}

export function isFinal(session: GameSession) {
  return session.phase.startsWith("final-");
}
export function currentWord(session: GameSession) {
  return session.words.find((word) => word.id === session.queue[0]);
}
export function groupWords(session: GameSession) {
  return session.words.slice(
    session.groupIndex * session.batchSize,
    (session.groupIndex + 1) * session.batchSize,
  );
}

export function createSession(
  words: WordEntry[],
  batchSize: 5 | 10,
  tutorial = false,
): GameSession {
  if (!words.length) throw new Error("Çalışmak için en az bir kelime seç.");
  const ordered = shuffle(words);
  return {
    version: 3,
    id: crypto.randomUUID(),
    words: ordered,
    batchSize,
    groupIndex: 0,
    phase: "flashcards",
    queue: ordered.slice(0, batchSize).map((word) => word.id),
    stageCompleted: 0,
    attempts: {},
    scoreChanges: {},
    assessment: {},
    matching: null,
    answer: null,
    finalCorrect: 0,
    finalTotal: 0,
    tutorial,
    saved: false,
  };
}

// Stable rotation keeps choices unchanged when a saved question is reopened.
function orderChoices(values: string[], seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    const j = hash % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function makeQuestion(session: GameSession) {
  const word = currentWord(session);
  if (!word || session.phase === "final-matching") return null;
  const context = session.phase.endsWith("context");
  const attemptKey = `${session.phase}:${word.id}`;
  const attempt = session.attempts[attemptKey] ?? 0;
  const examples = usableExamples(word);
  const example = examples[attempt % examples.length];
  const sentence = example?.sentence.replace(wordPattern(word), "$1________");
  const correct = context ? word.word : word.meanings[0];
  const knownMeanings = new Set(word.meanings.map(wordKey));
  const seed = getStarterWord(word.word);
  const pool = [...session.words, ...starterVocabulary];
  const candidates =
    context && seed
      ? seed.distractors
      : pool
          .filter(
            (entry) =>
              wordKey(entry.word) !== wordKey(word.word) &&
              !entry.meanings.some((meaning) => knownMeanings.has(wordKey(meaning))) &&
              !word.alternatives.some(
                (alternative) => wordKey(alternative) === wordKey(entry.word),
              ),
          )
          .map((entry) => (context ? entry.word : entry.meanings[0]));
  const distractors = [
    ...new Set(
      candidates.filter(
        (value): value is string => Boolean(value) && wordKey(value) !== wordKey(correct),
      ),
    ),
  ];
  return {
    word,
    correct,
    context,
    sentence,
    example,
    choices: orderChoices(
      [correct, ...orderChoices(distractors, word.id).slice(0, 3)],
      `${session.id}:${session.phase}:${word.id}:${attempt}`,
    ),
  };
}

export function recordAnswer(session: GameSession, choice: string): GameSession {
  if (session.answer || session.phase === "flashcards" || session.phase === "complete")
    return session;
  const question = makeQuestion(session);
  if (!question?.choices.includes(choice)) return session;
  return { ...session, answer: { choice, correct: choice === question.correct, confidence: null } };
}

export function setConfidence(session: GameSession, confidence: Confidence): GameSession {
  if (!session.answer?.correct || !isFinal(session)) return session;
  return { ...session, answer: { ...session.answer, confidence } };
}

export function advance(session: GameSession, remembered = true): GameSession {
  if (session.phase === "complete" || session.phase === "final-matching") return session;
  const word = currentWord(session);
  if (!word) return session;
  const flashcard = session.phase === "flashcards";
  if (!flashcard && !session.answer) return session;
  if (isFinal(session) && session.answer?.correct && session.answer.confidence === null)
    return session;
  const correct = flashcard ? remembered : !!session.answer?.correct;
  const repeat = !isFinal(session) && !correct;
  const attemptKey = `${session.phase}:${word.id}`;
  const queue = [...session.queue.slice(1), ...(repeat ? [word.id] : [])];
  const change = isFinal(session)
    ? (session.phase === "final-meaning" ? (correct ? 20 : -50) : correct ? 40 : -30) +
      (correct ? (session.answer?.confidence ?? 0) : 0)
    : 0;
  const next = {
    ...session,
    queue,
    answer: null,
    stageCompleted: session.stageCompleted + (repeat ? 0 : 1),
    attempts: { ...session.attempts, [attemptKey]: (session.attempts[attemptKey] ?? 0) + 1 },
    scoreChanges:
      isFinal(session) && session.version === 2
        ? { ...session.scoreChanges, [word.id]: (session.scoreChanges[word.id] ?? 0) + change }
        : session.scoreChanges,
    finalCorrect: session.finalCorrect + (isFinal(session) && correct ? 1 : 0),
    finalTotal: session.finalTotal + (isFinal(session) ? 1 : 0),
  };
  if (session.version === 3 && isFinal(session) && session.answer) {
    const assessment = session.assessment[word.id] ?? emptyAssessment();
    const stage = session.phase === "final-meaning" ? "meaning" : "context";
    next.assessment = {
      ...session.assessment,
      [word.id]: { ...assessment, [stage]: { correct, confidence: session.answer.confidence } },
    };
  }
  if (queue.length) return next;
  next.stageCompleted = 0;
  if (session.phase === "flashcards") next.phase = "meaning";
  else if (session.phase === "meaning") next.phase = "context";
  else if (session.phase === "context") {
    if ((session.groupIndex + 1) * session.batchSize < session.words.length) {
      next.groupIndex += 1;
      next.phase = "flashcards";
    } else next.phase = session.version === 3 ? "final-matching" : "final-meaning";
  } else if (session.phase === "final-meaning") next.phase = "final-context";
  else next.phase = "complete";
  next.queue =
    next.phase === "complete"
      ? []
      : isFinal(next)
        ? shuffle(next.words.map((entry) => entry.id))
        : groupWords(next).map((entry) => entry.id);
  return next.phase === "final-matching" ? startMatchingBoard(next) : next;
}

export function resultScore(session: GameSession, word: WordEntry) {
  if (session.version === 3) return assessmentScore(session.assessment[word.id]);
  return Math.max(0, Math.min(100, word.score + (session.scoreChanges[word.id] ?? 0)));
}
