import { assessmentScore, gameSessionSchema, type GameSession } from "@yds-atlas/shared";
import type { RequestContext } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
export function completionScores(snapshot: GameSession) {
  if (snapshot.phase !== "complete" || snapshot.tutorial || snapshot.queue.length)
    throw new HttpError(400, "Görev henüz tamamlanmadı.", "UNFINISHED_SESSION");
  return snapshot.words.map((word) => {
    if (snapshot.version === 2)
      return {
        id: word.id,
        score: Math.max(0, Math.min(100, word.score + (snapshot.scoreChanges[word.id] ?? 0))),
      };
    const assessment = snapshot.assessment[word.id];
    if (
      !assessment?.matchingDone ||
      !assessment.meaning ||
      !assessment.context ||
      [assessment.meaning, assessment.context].some(
        (answer) => answer.correct && answer.confidence === null,
      )
    )
      throw new HttpError(400, "Görevin değerlendirmesi eksik.", "INCOMPLETE_ASSESSMENT");
    return { id: word.id, score: assessmentScore(assessment) };
  });
}
export async function saveSession(ctx: RequestContext, snapshot: GameSession, revision: number) {
  const { data, error } = await ctx.db.rpc("save_learning_session", {
    p_id: snapshot.id,
    p_snapshot: snapshot,
    p_expected_revision: revision,
  });
  databaseError(error);
  return { revision: data as number };
}
export async function completeSession(ctx: RequestContext, id: string) {
  const { data, error } = await ctx.db
    .from("learning_sessions")
    .select("snapshot")
    .eq("id", id)
    .maybeSingle();
  databaseError(error);
  if (!data) throw new HttpError(404, "Görev bulunamadı.", "NOT_FOUND");
  const snapshot = gameSessionSchema.parse(data.snapshot);
  const scores = completionScores(snapshot);
  const result = await ctx.db.rpc("complete_learning_session", { p_id: id, p_scores: scores });
  databaseError(result.error);
  return { scores: result.data as { id: string; score: number }[] };
}
export async function accountState(ctx: RequestContext) {
  const profile = await ctx.db
    .from("profiles")
    .upsert({ user_id: ctx.userId }, { onConflict: "user_id", ignoreDuplicates: true });
  databaseError(profile.error);
  const [settings, session, progress, days] = await Promise.all([
    ctx.db.from("profiles").select("daily_goal").single(),
    ctx.db
      .from("learning_sessions")
      .select("snapshot,revision")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    historyRows(ctx, "daily_word_completions", "day,word_id"),
    historyRows(ctx, "completed_goal_days", "day,goal"),
  ]);
  for (const result of [settings, session]) databaseError(result.error);
  return {
    dailyGoal: settings.data!.daily_goal as number,
    session: session.data
      ? {
          snapshot: gameSessionSchema.parse(session.data.snapshot),
          revision: session.data.revision as number,
        }
      : null,
    progress,
    completedDays: days,
  };
}

async function historyRows(ctx: RequestContext, table: string, columns: string) {
  const entries: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = ctx.db.from(table).select(columns).order("day", { ascending: false });
    if (table === "daily_word_completions") query = query.order("word_id");
    const { data, error } = await query.range(offset, offset + 499);
    databaseError(error);
    entries.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) return entries;
  }
}
