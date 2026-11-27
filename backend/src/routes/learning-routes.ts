import { gameSessionSchema } from "@yds-atlas/shared";
import { z } from "zod";
import { saveSession } from "../features/learning/learning-service";
import { HttpError } from "../shared/errors";
import { readJson } from "../shared/http";
import { type RouteContext, unmatchedRoute } from "./route-context";

const uuid = z.uuid();
const sessionBody = z
  .object({ snapshot: gameSessionSchema, revision: z.number().int().min(0) })
  .strict();
export async function learningRoutes({ request, path, ctx, assessmentWriter }: RouteContext) {
  let result: unknown;
  if (path === "/api/learning/online" || path.startsWith("/api/learning/online/")) {
    if (!assessmentWriter.online)
      throw new HttpError(503, "Değerlendirme servisi kullanılamıyor.", "ASSESSMENT_UNAVAILABLE");
    result = await assessmentWriter.online(request, path, ctx);
  } else if (path === "/api/learning/session" && request.method === "PUT") {
    const { snapshot, revision } = sessionBody.parse(await readJson(request));
    uuid.parse(snapshot.id);
    if (
      snapshot.tutorial ||
      snapshot.words.length > 100 ||
      new Set(snapshot.words.map((word) => word.id)).size !== snapshot.words.length
    )
      throw new HttpError(400, "Görev bilgileri geçersiz.", "INVALID_SESSION");
    for (const word of snapshot.words) uuid.parse(word.id);
    result = await saveSession(ctx, assessmentWriter, snapshot, revision);
  } else if (
    /^\/api\/learning\/sessions\/[^/]+\/complete$/.test(path) &&
    request.method === "POST"
  ) {
    const id = uuid.parse(path.split("/")[4]);
    const { revision } = z
      .strictObject({ revision: z.number().int().positive().optional() })
      .parse(await readJson(request, 2_048));
    if (!revision)
      throw new HttpError(
        409,
        "Görevi kaydetmek için sayfayı yenile.",
        "ASSESSMENT_UPGRADE_REQUIRED",
      );
    result = await assessmentWriter.complete(ctx.userId, id, revision);
  } else return unmatchedRoute;
  return result;
}
