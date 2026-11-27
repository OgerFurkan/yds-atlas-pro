import {
  type AssessmentAction,
  accountStateSchema,
  DEFAULT_DAILY_GOAL,
  dailyGoalSchema,
  type GameSession,
  gameSessionSchema,
} from "@yds-atlas/shared";
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
  const parsed = gameSessionSchema.safeParse(
    row.assessment_protocol === 1
      ? row.snapshot
      : { ...row.snapshot, assessmentActions: undefined },
  );
  if (!parsed.success || (row.assessment_protocol !== null && row.assessment_protocol !== 1))
    throw new HttpError(503, "Kayıtlı çalışma oturumu doğrulanamadı.", "SESSION_NOT_AVAILABLE");
  return parsed.data;
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
  const [settings, session, progress, days] = await Promise.all([
    ctx.db.from("profiles").select("daily_goal").eq("user_id", ctx.userId),
    accountSession(ctx),
    historyRows(ctx, "daily_word_completions"),
    historyRows(ctx, "completed_goal_days"),
  ]);
  databaseError(settings.error);
  const rows = settings.data;
  const goal = dailyGoalSchema.safeParse(rows?.[0]?.daily_goal);
  if (!Array.isArray(rows) || rows.length > 1 || (rows.length === 1 && !goal.success))
    throw new HttpError(503, "Günlük hedef yüklenemedi. Yeniden dene.", "PROFILE_NOT_AVAILABLE");
  return {
    onlineProtocol: 1 as const,
    planProtocol: 1 as const,
    dailyGoal: goal.data ?? DEFAULT_DAILY_GOAL,
    session,
    progress,
    completedDays: days,
  };
}

async function accountSession(ctx: RequestContext) {
  async function latest(unfinishedOnly: boolean) {
    let query = ctx.db
      .from("learning_sessions")
      .select("snapshot,revision,assessment_protocol,completed_at")
      .eq("user_id", ctx.userId)
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(1);
    if (unfinishedOnly)
      query = query
        .is("completed_at", null)
        .or("snapshot->>discarded.is.null,snapshot->>discarded.neq.true");
    const { data, error } = await query;
    databaseError(error);
    if (!Array.isArray(data) || data.length > 1 || (data.length && !data[0]))
      throw new HttpError(503, "Çalışma oturumu okunamadı. Yeniden dene.", "SESSION_NOT_AVAILABLE");
    return data[0];
  }
  let row = await latest(false);
  if (!row) return null;
  // An earlier session started on another device may still need to be resumed or cancelled.
  if (row.completed_at || row.snapshot?.discarded) row = (await latest(true)) ?? row;
  if (!Number.isSafeInteger(row.revision) || row.revision <= 0)
    throw new HttpError(503, "Çalışma sürümü doğrulanamadı.", "SESSION_NOT_AVAILABLE");
  return { snapshot: storedSnapshot(row), revision: row.revision as number };
}

function incompleteHistory() {
  return new HttpError(
    503,
    "Çalışma geçmişi eksiksiz okunamadı. Yeniden dene.",
    "INCOMPLETE_HISTORY",
  );
}

async function historyRows(
  ctx: RequestContext,
  table: "daily_word_completions" | "completed_goal_days",
) {
  const progress = table === "daily_word_completions";
  const columns = progress ? "day,word_id" : "day,goal";
  const schema = progress
    ? accountStateSchema.shape.progress
    : accountStateSchema.shape.completedDays;
  const entries: ({ day: string; word_id: string } | { day: string; goal: number })[] = [];
  let total: number | undefined;
  let last: (typeof entries)[number] | undefined;
  for (;;) {
    let query = ctx.db
      .from(table)
      .select(columns, last ? {} : { count: "exact" })
      .eq("user_id", ctx.userId)
      .order("day", { ascending: false });
    if (progress) query = query.order("word_id");
    if (last)
      query =
        "word_id" in last
          ? query.or(`day.lt.${last.day},and(day.eq.${last.day},word_id.gt.${last.word_id})`)
          : query.lt("day", last.day);
    const { data, error, count } = await query.limit(500);
    databaseError(error);
    if (total === undefined) {
      if (count === null || !Number.isSafeInteger(count) || count < 0) throw incompleteHistory();
      total = count;
      if (total > 250_000)
        throw new HttpError(413, "Çalışma geçmişi okuma sınırını aşıyor.", "HISTORY_LIMIT");
    }
    const page = schema.safeParse(data);
    if (!page.success || page.data.length > 500 || (!page.data.length && entries.length < total))
      throw incompleteHistory();
    const continued = !!last;
    for (const row of page.data) {
      if (
        last &&
        (row.day > last.day ||
          (row.day === last.day &&
            (!("word_id" in row && "word_id" in last) || row.word_id <= last.word_id)))
      )
        throw incompleteHistory();
      entries.push(row);
      last = row;
    }
    if (entries.length > total) throw incompleteHistory();
    if (entries.length === total) {
      // Both tables are append-only for a live owner. A changed total invalidates a multi-page read.
      if (continued) {
        const check = await ctx.db
          .from(table)
          .select("day", { count: "exact", head: true })
          .eq("user_id", ctx.userId);
        databaseError(check.error);
        if (check.count !== total) throw incompleteHistory();
      }
      return entries;
    }
  }
}
