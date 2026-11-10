import { readStorage, writeStorage, removeStorage } from "@/shared/lib/storage";
import { type GameSession, gameSessionSchema, gameStorageKey } from "./game-session";

export function readSession(): GameSession | null {
  const parsed = gameSessionSchema.safeParse(readStorage(gameStorageKey, null));
  if (!parsed.success) return null;
  const session = parsed.data;
  const ids = new Set(session.words.map((word) => word.id));
  if (
    session.queue.some((id) => !ids.has(id)) ||
    session.groupIndex * session.batchSize >= session.words.length ||
    (session.phase !== "complete" && session.phase !== "final-matching" && !session.queue.length)
  )
    return null;
  if (session.phase === "final-matching") {
    const board = session.matching;
    if (!board || session.version !== 3) return null;
    const left = new Set(board.left);
    const right = new Set(board.right);
    const matched = new Set(board.matched);
    if (
      left.size !== board.left.length ||
      right.size !== left.size ||
      board.left.some((id) => !ids.has(id) || !right.has(id)) ||
      matched.size !== board.matched.length ||
      board.matched.some((id) => !left.has(id)) ||
      board.left.some((id) => matched.has(id) === session.queue.includes(id)) ||
      (board.selectedLeft !== null &&
        (!left.has(board.selectedLeft) || matched.has(board.selectedLeft))) ||
      (board.selectedRight !== null &&
        (!right.has(board.selectedRight) || matched.has(board.selectedRight))) ||
      (board.feedback !== null &&
        (!left.has(board.feedback.leftId) || !right.has(board.feedback.rightId)))
    )
      return null;
  }
  return session;
}

export function persistSession(session: GameSession | null) {
  if (session) writeStorage(gameStorageKey, session);
  else removeStorage(gameStorageKey);
}
