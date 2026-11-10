import { emptyAssessment } from "./assessment";
import type { GameSession } from "./game-session";

function ordered(ids: string[], seed: string) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    const j = hash % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function startMatchingBoard(session: GameSession): GameSession {
  const meanings = new Set<string>();
  const ids: string[] = [];
  for (const id of session.queue) {
    const word = session.words.find((entry) => entry.id === id);
    if (!word) continue;
    const meaning = word.meanings[0].trim().toLocaleLowerCase("tr");
    // Identical translations belong on separate boards so every pair is unambiguous.
    if (meanings.has(meaning)) continue;
    meanings.add(meaning);
    ids.push(id);
    if (ids.length === 5) break;
  }
  if (!ids.length) return session;
  return {
    ...session,
    matching: {
      left: ordered(ids, `${session.id}:${session.stageCompleted}:left`),
      right: ordered(ids, `${session.id}:${session.stageCompleted}:right`),
      matched: [],
      selectedLeft: null,
      selectedRight: null,
      feedback: null,
    },
  };
}

export function selectMatching(
  session: GameSession,
  side: "left" | "right",
  id: string,
): GameSession {
  const board = session.matching;
  if (session.phase !== "final-matching" || !board || board.feedback?.correct === false)
    return session;
  if (!board[side].includes(id) || board.matched.includes(id)) return session;
  const key = side === "left" ? "selectedLeft" : "selectedRight";
  const nextBoard: NonNullable<GameSession["matching"]> = {
    ...board,
    [key]: board[key] === id ? null : id,
    feedback: null,
  };
  const leftId = nextBoard.selectedLeft;
  const rightId = nextBoard.selectedRight;
  if (!leftId || !rightId) return { ...session, matching: nextBoard };
  const correct = leftId === rightId;
  nextBoard.feedback = { leftId, rightId, correct };
  const assessment = { ...session.assessment };
  if (!correct) {
    for (const wordId of [leftId, rightId]) {
      const current = assessment[wordId] ?? emptyAssessment();
      assessment[wordId] = { ...current, matchingErrors: current.matchingErrors + 1 };
    }
    return { ...session, assessment, matching: nextBoard };
  }
  const current = assessment[leftId] ?? emptyAssessment();
  assessment[leftId] = { ...current, matchingDone: true };
  return {
    ...session,
    assessment,
    matching: {
      ...nextBoard,
      matched: [...board.matched, leftId],
      selectedLeft: null,
      selectedRight: null,
    },
    queue: session.queue.filter((wordId) => wordId !== leftId),
    stageCompleted: session.stageCompleted + 1,
    finalTotal: session.finalTotal + 1,
    finalCorrect: session.finalCorrect + (current.matchingErrors === 0 ? 1 : 0),
  };
}

export function retryMatching(session: GameSession): GameSession {
  if (session.phase !== "final-matching" || !session.matching?.feedback) return session;
  return {
    ...session,
    matching: { ...session.matching, selectedLeft: null, selectedRight: null, feedback: null },
  };
}

export function continueMatching(session: GameSession): GameSession {
  const board = session.matching;
  if (session.phase !== "final-matching" || !board || board.matched.length !== board.left.length)
    return session;
  if (session.queue.length) return startMatchingBoard(session);
  return {
    ...session,
    phase: "final-meaning",
    queue: ordered(
      session.words.map((word) => word.id),
      `${session.id}:meaning`,
    ),
    stageCompleted: 0,
    matching: null,
  };
}
