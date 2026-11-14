import { gameSessionSchema, type GameSession } from "@yds-atlas/shared";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";

/**
 * Opt-in server-only snapshot save. The REST handler authenticates the JWT and
 * validates the input, but only this trusted backend sends the verified owner.
 * The caller's JWT must never be forwarded to the privileged RPC.
 *
 * Requires the additive v5A SQL writer. Do not enable or revoke the legacy
 * save RPC until the coordinated staging cutover has been verified.
 */
export async function saveSessionWithPrivilegedWriter(
  ctx: RequestContext,
  snapshot: GameSession,
  revision: number,
  writerFactory: () => RequestContext["db"],
) {
  // Defense in depth: validate even if the service is called outside the route.
  const parsed = gameSessionSchema.safeParse(snapshot);
  if (!parsed.success || parsed.data.tutorial || parsed.data.words.length > 100 ||
      new Set(parsed.data.words.map((word) => word.id)).size !== parsed.data.words.length) {
    throw new HttpError(400, "Görev bilgileri geçersiz.", "INVALID_SESSION");
  }
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= 2147483647) {
    throw new HttpError(400, "Görev sürümü geçersiz.", "INVALID_SESSION_REVISION");
  }
  const { data, error } = await writerFactory().rpc("save_learning_session_v5", {
    p_owner_id: ctx.userId,
    p_id: parsed.data.id,
    p_snapshot: parsed.data,
    p_expected_revision: revision,
  });
  if (error?.code === "40001" || error?.code === "23505")
    throw new HttpError(409, "Görev başka bir sekmede değişti.", "SESSION_CONFLICT");
  if (error?.code === "42501")
    throw new HttpError(403, "Bu göreve erişim iznin yok.", "FORBIDDEN");
  databaseError(error);
  // Fail closed on unexpected RPC responses (including a silent no-op).
  if (!Number.isSafeInteger(data) || data !== revision + 1) {
    throw new HttpError(503, "Kaydedilen görev sürümü doğrulanamadı.", "SESSION_SAVE_RESULT_INVALID");
  }
  return { revision: data as number };
}
