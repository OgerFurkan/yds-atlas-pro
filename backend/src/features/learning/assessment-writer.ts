import type { GameSession } from "@yds-atlas/shared";
import { SQL } from "bun";
import { databaseError, HttpError } from "../../shared/errors";
import { invalidAssessment } from "./assessment-scoring";

type AssessmentResult = { scores: { id: string; score: number }[]; practiceOnly: boolean };
export type AssessmentWriter = {
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
