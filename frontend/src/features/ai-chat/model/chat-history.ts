/**
 * Remove exactly one saved chat without mutating the others.
 * The history is intentionally session-scoped; no storage or server changes.
 */
export function deleteHistoryConversation<T>(history: readonly T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= history.length) return [...history];
  return history.filter((_, position) => position !== index);
}
