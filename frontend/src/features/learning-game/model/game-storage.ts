import { readStorage, readStoredJson, removeStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { type GameSession, gameSessionSchema, gameStorageKey } from "./game-session";

export function readSession(): GameSession | null {
  return playableSession(readStorage(gameStorageKey, null));
}

function playableSession(value: unknown): GameSession | null {
  const parsed = gameSessionSchema.safeParse(value);
  if (!parsed.success) return null;
  const session = parsed.data;
  if (session.discarded) return null;
  const ids = new Set(session.words.map((word) => word.id));
  if (
    session.queue.some((id) => !ids.has(id)) ||
    session.groupIndex * session.batchSize >= session.words.length ||
    (session.phase !== "complete" && !session.phase.endsWith("matching") && !session.queue.length)
  )
    return null;
  if (session.phase.endsWith("matching")) {
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

export function hasActiveLocalGame() {
  try {
    const raw = readStoredJson(gameStorageKey);
    if (raw === undefined) return false;
    const session = playableSession(raw);
    if (!session) return !gameSessionSchema.safeParse(raw).data?.discarded;
    return !session.tutorial && (!session.saved || session.phase !== "complete");
  } catch {
    return true;
  }
}

const gameChangeEvent = "atlas-learning-session-changed";
export function subscribeGameChanges(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(gameChangeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(gameChangeEvent, listener);
  };
}

// Compare schema-normalized snapshots under the profile lock, including the action log.
export function sameSession(left: GameSession | null, right: GameSession | null) {
  return (
    JSON.stringify(left && gameSessionSchema.parse(left)) ===
    JSON.stringify(right && gameSessionSchema.parse(right))
  );
}
export function persistSessionChange(next: GameSession | null, expected: GameSession | null) {
  const raw = readStoredJson(gameStorageKey);
  const current = readSession();
  if (
    (raw !== undefined && !current && !gameSessionSchema.safeParse(raw).data?.discarded) ||
    !sameSession(current, expected)
  )
    throw new Error("Oyun kaydı değişti veya okunamadı. Güncel oturumu yeniden aç.");
  if (getStorageScope() && next && !next.localPractice)
    writeStorage(storageKeys.pendingSession, next.saved ? null : next.id);
  persistSession(next);
}

export function persistSession(session: GameSession | null) {
  if (session) writeStorage(gameStorageKey, session);
  else removeStorage(gameStorageKey);
  // The profile lock commits its synchronous journal before observers read the session.
  if (typeof window !== "undefined")
    queueMicrotask(() => window.dispatchEvent(new Event(gameChangeEvent)));
}
