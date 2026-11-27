import type { GameSession } from "@yds-atlas/shared";
import { SQL } from "bun";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";
import { invalidAssessment } from "./assessment-scoring";
import { onlineAssessment } from "./online-assessment";

type AssessmentResult = { scores: { id: string; score: number }[]; practiceOnly: boolean };
export type AssessmentWriter = {
  ping?(): Promise<boolean>;
  online?(request: Request, path: string, ctx: RequestContext): Promise<unknown>;
  save(userId: string, snapshot: GameSession, revision: number, ranked: boolean): Promise<number>;
  complete(userId: string, id: string, revision: number): Promise<AssessmentResult>;
};

function assessmentDatabaseError(reason: unknown): never {
  const code =
    typeof reason === "object" && reason !== null && "errno" in reason ? String(reason.errno) : "";
  if (code === "P0002") throw new HttpError(404, "Görev bulunamadı.", "NOT_FOUND");
  if (code === "22023") throw invalidAssessment();
  throw databaseError({ code });
}

export function createAssessmentWriter(
  url: string | undefined,
): AssessmentWriter & { close(): Promise<void> } {
  let sql: SQL | undefined;
  function connection() {
    if (!url)
      throw new HttpError(503, "Değerlendirme servisi yapılandırılmadı.", "ASSESSMENT_UNAVAILABLE");
    sql ??= new SQL(url, { max: 5, connectionTimeout: 5 });
    return sql;
  }
  return {
    async ping() {
      if (!url) return false;
      const query = connection()`select 1`;
      const timer = setTimeout(() => query.cancel(), 2500);
      try {
        await query;
        return true;
      } finally {
        clearTimeout(timer);
      }
    },
    async online(request, path, ctx) {
      const db = connection();
      try {
        return await onlineAssessment(request, path, ctx, db);
      } catch (error) {
        if (error instanceof Error && "errno" in error) assessmentDatabaseError(error);
        throw error;
      }
    },
    async close() {
      await sql?.close({ timeout: 2 });
    },
    async save(userId, snapshot, revision, ranked) {
      const db = connection();
      try {
        const [row] = await db`
          select public.atlas_store_learning_session(
            ${userId}::uuid, ${snapshot.id}::uuid, ${snapshot}::jsonb,
            ${revision}::integer, ${ranked}::boolean
          ) as revision`;
        return row.revision;
      } catch (error) {
        assessmentDatabaseError(error);
      }
    },
    async complete(userId, id, revision) {
      const db = connection();
      try {
        const [row] = await db`
          select public.atlas_finish_learning_session(${userId}::uuid, ${id}::uuid, ${revision}::integer)
          as result`;
        return row.result;
      } catch (error) {
        assessmentDatabaseError(error);
      }
    },
  };
}
