import type { DailyPlanCloudState, DailyPlanSaveInput } from "@yds-atlas/shared";
import { HttpError, databaseError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";

const FIELDS = "revision, payload";
const conflict = () => new HttpError(
  409,
  "Günlük plan başka bir cihazda güncellendi. Güncel planı yeniden yükle.",
  "DAILY_PLAN_CONFLICT",
);

export async function readDailyPlan(ctx: RequestContext): Promise<DailyPlanCloudState> {
  const response = await ctx.db.from("daily_plan_states")
    .select(FIELDS).eq("user_id", ctx.userId).maybeSingle();
  databaseError(response.error);
  if (!response.data) return { revision: 0, snapshot: null };
  return {
    revision: response.data.revision as number,
    snapshot: response.data.payload as DailyPlanCloudState["snapshot"],
  };
}

/** Optimistic compare-and-swap; never silently overwrite another device's changes. */
export async function saveDailyPlan(
  ctx: RequestContext,
  input: DailyPlanSaveInput,
): Promise<DailyPlanCloudState> {
  const ids = [...new Set([
    ...input.snapshot.assignments.flatMap((group) => group.words),
    ...input.snapshot.excludedWordIds,
  ])];

  // Plan JSON stores IDs only. Reject foreign/deleted word IDs even when the user
  // knows another account's UUID; all lookup requests run under the caller's JWT.
  for (let start = 0; start < ids.length; start += 250) {
    const batch = ids.slice(start, start + 250);
    const found = await ctx.db.from("words").select("id")
      .eq("user_id", ctx.userId).in("id", batch);
    databaseError(found.error);
    if (!found.data || new Set(found.data.map((row) => row.id as string)).size !== batch.length)
      throw new HttpError(409, "Plana ait kelimeler güncel değil. Kütüphaneyi yenile.", "DAILY_PLAN_STALE_WORDS");
  }

  const values = {
    payload: input.snapshot,
    revision: input.expectedRevision + 1,
    updated_at: new Date().toISOString(),
  };
  if (input.expectedRevision === 0) {
    const result = await ctx.db.from("daily_plan_states")
      .insert({ ...values, user_id: ctx.userId }).select(FIELDS).single();
    if (result.error?.code === "23505") throw conflict();
    databaseError(result.error);
    return { revision: result.data!.revision as number, snapshot: result.data!.payload as DailyPlanCloudState["snapshot"] };
  }

  const result = await ctx.db.from("daily_plan_states")
    .update(values)
    .eq("user_id", ctx.userId)
    .eq("revision", input.expectedRevision)
    .select(FIELDS)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw conflict();
  return { revision: result.data.revision as number, snapshot: result.data.payload as DailyPlanCloudState["snapshot"] };
}
