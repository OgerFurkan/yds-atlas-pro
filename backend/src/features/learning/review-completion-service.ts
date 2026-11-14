import { gameSessionSchema, rateCompletedGame } from "@yds-atlas/shared";
import { completionScores } from "./learning-service";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";

/**
 * Opt-in backend-only path: the user-JWT client reads the session, while a
 * separate server-secret client calls one transactional, service_role-only RPC.
 * No browser-supplied owner, scores or ratings are accepted.
 *
 * A DB revision compare prevents a modified snapshot between read and commit;
 * the transaction's learning_results row is the idempotency key.
 */
export async function completeSessionWithReviewWriter(
  ctx: RequestContext,
  id: string,
  writerFactory: () => RequestContext["db"],
) {
  const read = await ctx.db.from("learning_sessions")
    .select("snapshot,revision")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  databaseError(read.error);
  if (!read.data) throw new HttpError(404, "Görev bulunamadı.", "NOT_FOUND");

  const snapshot = gameSessionSchema.parse(read.data.snapshot);
  const revision = read.data.revision;
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new HttpError(503, "Görev sürümü doğrulanamadı.", "REVIEW_INVALID_REVISION");
  if (snapshot.id !== id)
    throw new HttpError(409, "Görev kimliği değişti.", "REVIEW_SESSION_MISMATCH");

  // For v2 snapshots the previous scoring remains available, with no invented SRS evidence.
  const scores = completionScores(snapshot);
  const ratings = snapshot.version === 3 ? rateCompletedGame(snapshot).map(
    ({ wordId, rating }) => ({ id: wordId, rating }),
  ) : [];
  if (scores.length === 0 || scores.length > 100 ||
      scores.some((item) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) ||
      new Set(scores.map((item) => item.id)).size !== scores.length) {
    throw new HttpError(400, "Görev kelimeleri geçersiz.", "INVALID_SESSION");
  }

  const response = await writerFactory().rpc("complete_learning_session_v3", {
    p_owner_id: ctx.userId,
    p_id: id,
    p_expected_revision: revision,
    p_scores: scores,
    p_ratings: ratings,
  });
  if (response.error?.code === "40001")
    throw new HttpError(409, "Görev başka bir sekmede değişti.", "SESSION_CONFLICT");
  if (response.error?.code === "42501")
    throw new HttpError(403, "Bu göreve erişim iznin yok.", "FORBIDDEN");
  databaseError(response.error);
  if (!Array.isArray(response.data) || !response.data.every((item: unknown) =>
    !!item && typeof item === "object" &&
    typeof (item as { id?: unknown }).id === "string" &&
    Number.isInteger((item as { score?: unknown }).score) &&
    (item as { score: number }).score >= 0 && (item as { score: number }).score <= 100
  )) throw new HttpError(503, "Görev sonucu doğrulanamadı.", "REVIEW_RESULT_INVALID");
  return { scores: response.data as { id: string; score: number }[] };
}
