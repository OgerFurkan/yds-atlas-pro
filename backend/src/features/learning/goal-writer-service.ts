import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";

/** Opt-in service-only goal writer: owner always comes from verified JWT context. */
export async function setDailyGoalWithPrivilegedWriter(
  ctx: RequestContext,
  goal: number,
  writerFactory: () => RequestContext["db"],
) {
  if (!Number.isSafeInteger(goal) || goal < 10 || goal > 100 || goal % 10 !== 0)
    throw new HttpError(400, "Günlük hedef geçersiz.", "INVALID_DAILY_GOAL");
  const { data, error } = await writerFactory().rpc("set_daily_goal_v6", {
    p_owner_id: ctx.userId,
    p_goal: goal,
  });
  if (error?.code === "42501")
    throw new HttpError(403, "Bu hesaba erişim iznin yok.", "FORBIDDEN");
  databaseError(error);
  if (!Number.isSafeInteger(data) || data !== goal)
    throw new HttpError(503, "Hedef kaydı doğrulanamadı.", "GOAL_WRITE_RESULT_INVALID");
  return { goal: data as number };
}
