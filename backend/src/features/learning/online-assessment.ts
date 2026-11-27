import {
  type GameSession,
  gameSessionSchema,
  type OnlineView,
  onlineCommandSchema,
  onlineStartSchema,
} from "@yds-atlas/shared";
import { createAssessmentSnapshot, isGameReady, shuffle } from "@yds-atlas/shared/game-engine";
import type { SQL } from "bun";
import { z } from "zod";
import { databaseError, HttpError } from "../../shared/errors";
import { readJson } from "../../shared/http";
import type { RequestContext } from "../../shared/supabase";
import { mapWord } from "../words/word-service";
import { invalidAssessment } from "./assessment-scoring";
import { onlineView, takeOnlineAction } from "./online-question";

function conflict() {
  return new HttpError(409, "Değerlendirme değişti. Güncel soruyu yükle.", "ASSESSMENT_CONFLICT");
}
type Row = { id: string; revision: number; state: GameSession; status: OnlineView["status"] };
type Score = { id: string; score: number };
async function recordedScores(
  db: Pick<SQL, "unsafe">,
  owner: string,
  id: string,
  revision: number,
) {
  const [row] = await db.unsafe(
    "select public.atlas_finish_learning_session($1::uuid,$2::uuid,$3::integer) as result",
    [owner, id, revision],
  );
  return new Map<string, number>(
    (row.result.scores as Score[]).map(({ id, score }) => [id, score]),
  );
}
async function project(row: Row, db: Pick<SQL, "unsafe">, owner: string) {
  const accepted =
    row.status === "complete" ? await recordedScores(db, owner, row.id, 1) : undefined;
  return onlineView(row.id, row.revision, row.status, gameSessionSchema.parse(row.state), accepted);
}
const root = "/api/learning/online";
export async function onlineAssessment(
  request: Request,
  path: string,
  ctx: RequestContext,
  db: SQL,
) {
  const owner = ctx.userId;
  if (path === root && request.method === "GET") {
    const [row] =
      await db`select id,revision,state,status from atlas_account.online_assessments where user_id=${owner}::uuid and status='active' and expires_at>statement_timestamp()`;
    return { current: row ? await project(row, db, owner) : null };
  }
  if (path === root && request.method === "POST") {
    const start = onlineStartSchema.parse(await readJson(request, 8192));
    const [prior] =
      await db`select *,start_request=${start}::jsonb as same, expires_at<=now() as expired from atlas_account.online_assessments where user_id=${owner}::uuid and start_command=${start.command}::uuid`;
    if (prior) {
      if (!prior.same) throw conflict();
      return project(
        {
          ...prior,
          status: prior.expired && prior.status === "active" ? "expired" : prior.status,
        },
        db,
        owner,
      );
    }
    const { data, error } = await ctx.db
      .from("words")
      .select("*")
      .eq("user_id", owner)
      .in("id", start.words);
    databaseError(error);
    if (!Array.isArray(data) || data.length !== start.words.length)
      throw new HttpError(404, "Kelime listesi değişti.", "WORD_NOT_FOUND");
    const words = data.map(mapWord);
    const versions = Object.fromEntries(data.map((row) => [row.id, row.updated_at]));
    if (!words.every(isGameReady)) throw invalidAssessment();
    const state = {
      ...createAssessmentSnapshot(shuffle(words), start.batchSize, crypto.randomUUID()),
      day: start.day,
    };
    return db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${owner}::text,901))`;
      await tx`update atlas_account.online_assessments set status='expired',revision=revision+1 where user_id=${owner}::uuid and status='active' and expires_at<=now()`;
      const [existing] =
        await tx`select *,start_request=${start}::jsonb as same from atlas_account.online_assessments where user_id=${owner}::uuid and (start_command=${start.command}::uuid or status='active') order by (start_command=${start.command}::uuid) desc limit 1`;
      if (existing) {
        if (!existing.same) throw conflict();
        return project(existing, tx, owner);
      }
      const [row] =
        await tx`insert into atlas_account.online_assessments(id,user_id,state,start_command,start_request,status,expires_at,word_versions)
        values(gen_random_uuid(),${owner}::uuid,${state}::jsonb,${start.command}::uuid,${start}::jsonb,'active',now()+interval '24 hours',${versions}::jsonb) returning id,revision,state,status`;
      return project(row, tx, owner);
    });
  }
  if (!path.startsWith(root + "/")) throw new HttpError(404, "Değerlendirme bulunamadı.");
  const id = z.uuid().parse(path.slice(root.length + 1));
  if (request.method !== "GET" && request.method !== "POST")
    throw new HttpError(405, "İşlem desteklenmiyor.");
  const cmd =
    request.method === "POST" ? onlineCommandSchema.parse(await readJson(request, 2048)) : null;
  return db.begin(async (tx) => {
    const [row] =
      await tx`select *,expires_at<=clock_timestamp() as expired,last_request=${cmd}::jsonb as same
      from atlas_account.online_assessments where user_id=${owner}::uuid and id=${id}::uuid for update`;
    if (!row) throw new HttpError(404, "Değerlendirme bulunamadı.", "NOT_FOUND");
    if (row.status === "active" && row.expired) {
      await tx`update atlas_account.online_assessments set status='expired', revision=revision+1 where id=${id}::uuid`;
      return project({ ...row, status: "expired", revision: row.revision + 1 }, tx, owner);
    }
    if (!cmd || (row.last_command === cmd.command && row.same)) return project(row, tx, owner);
    if (
      row.status !== "active" ||
      row.revision !== cmd.revision ||
      row.last_command === cmd.command
    )
      throw conflict();
    const state = gameSessionSchema.parse(row.state);
    const cancel = cmd.action.kind === "cancel";
    const next = cancel ? state : takeOnlineAction(id, row.revision, state, cmd.action);
    if (!cancel && next === state) throw invalidAssessment();
    const status = cancel ? "cancelled" : next.phase === "complete" ? "complete" : "active";
    await tx`update atlas_account.online_assessments set state=${next}::jsonb,status=${status},revision=revision+1,last_command=${cmd.command}::uuid,last_request=${cmd}::jsonb where id=${id}::uuid`;
    let accepted: Map<string, number> | undefined;
    if (status === "complete") {
      // Only a completed, server-generated transcript enters the legacy results/history transaction.
      const completed = {
        ...next,
        id,
        assessmentActions: [],
        assessmentVersions: row.word_versions ?? {},
      };
      await tx`select public.atlas_store_learning_session(${owner}::uuid,${id}::uuid,${completed}::jsonb,0,true)`;
      accepted = await recordedScores(tx, owner, id, 1);
    }
    return onlineView(id, row.revision + 1, status, next, accepted);
  });
}
