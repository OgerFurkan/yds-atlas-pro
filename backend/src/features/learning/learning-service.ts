import { type AssessmentAction, type GameSession, gameSessionSchema } from "@yds-atlas/shared";
import { createAssessmentSnapshot, isGameReady } from "@yds-atlas/shared/game-engine";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";
import { mapWord } from "../words/word-service";
import { invalidAssessment, replayAssessment } from "./assessment-scoring";
import type { AssessmentWriter } from "./assessment-writer";

function sessionConflict() {
  return new HttpError(
    409,
    "Görev başka bir sekmede değişti. Sayfayı yenileyip devam et.",
    "SESSION_CONFLICT",
  );
}

function storedSnapshot(row: { snapshot: GameSession; assessment_protocol: number | null }) {
  return gameSessionSchema.parse(
    row.assessment_protocol === 1
      ? row.snapshot
      : { ...row.snapshot, assessmentActions: undefined },
  );
}

async function initialAssessment(
  ctx: RequestContext,
  requested: GameSession,
): Promise<GameSession> {
  const ids = requested.words.map((word) => word.id);
  const { data, error } = await ctx.db.from("words").select("*").in("id", ids);
  databaseError(error);
  if (data?.length !== ids.length) throw new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
  const stored = new Map(data.map((row) => [row.id, mapWord(row)] as const));
  const words = requested.words.map((requestedWord) => {
    const word = stored.get(requestedWord.id);
    if (!word) throw invalidAssessment();
    if (word.updatedAt !== requestedWord.updatedAt)
      throw new HttpError(
        409,
        "Kelime listen değişti. Görevi güncel kelimelerle yeniden başlat.",
        "ASSESSMENT_WORD_CHANGED",
      );
    if (!isGameReady(word)) throw invalidAssessment();
    return word;
  });
  return {
    ...createAssessmentSnapshot(words, requested.batchSize, requested.id),
    day: requested.day,
    assessmentActions: [],
  };
}

function matchesPrefix(previous: AssessmentAction[], incoming: AssessmentAction[]) {
  return (
    previous.length <= incoming.length &&
    previous.every((entry, index) => JSON.stringify(entry) === JSON.stringify(incoming[index]))
  );
}

export async function saveSession(
  ctx: RequestContext,
  writer: AssessmentWriter,
  requested: GameSession,
  revision: number,
) {
  const { data, error } = await ctx.db
    .from("learning_sessions")
    .select("snapshot,assessment_protocol,revision,completed_at")
    .eq("id", requested.id)
    .maybeSingle();
  databaseError(error);

  const incoming = requested.assessmentActions;
  const ranked = incoming !== undefined;
  if (!data && revision !== 0) throw sessionConflict();
  if (!data && requested.discarded) return { revision: 0 };
  if (data && (data.assessment_protocol === 1) !== ranked) throw sessionConflict();
  if (!ranked) {
    if (data && (data.revision !== revision || data.completed_at)) throw sessionConflict();
    return {
      revision: await writer.save(ctx.userId, { ...requested, saved: false }, revision, false),
    };
  }

  if (requested.version !== 3) throw invalidAssessment();
  if (!data && incoming.length) throw invalidAssessment();
  const snapshot = data ? storedSnapshot(data) : await initialAssessment(ctx, requested);
  const previous = snapshot.assessmentActions ?? [];
  if (!matchesPrefix(previous, incoming)) throw sessionConflict();
  const same = incoming.length === previous.length && snapshot.discarded === requested.discarded;
  if (data) {
    if (same && (revision === data.revision || revision === data.revision - 1))
      return { revision: data.revision as number };
    if (data.completed_at || data.revision !== revision || snapshot.discarded)
      throw sessionConflict();
  }
  const replayed = replayAssessment(snapshot, incoming.slice(previous.length));
  if (requested.discarded && replayed.phase === "complete") throw invalidAssessment();
  const canonical = { ...replayed, assessmentActions: incoming, discarded: requested.discarded };
  return { revision: await writer.save(ctx.userId, canonical, revision, true) };
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
      .select("snapshot,revision,assessment_protocol")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    historyRows(ctx, "daily_word_completions", "day,word_id"),
    historyRows(ctx, "completed_goal_days", "day,goal"),
  ]);
  for (const result of [settings, session]) databaseError(result.error);
  const dailyGoal = settings.data?.daily_goal;
  if (typeof dailyGoal !== "number")
    throw new HttpError(503, "Günlük hedef yüklenemedi. Yeniden dene.", "PROFILE_NOT_AVAILABLE");
  return {
    dailyGoal,
    session: session.data
      ? {
          snapshot: storedSnapshot(session.data),
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
