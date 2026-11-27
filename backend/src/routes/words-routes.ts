import { wordCursorSchema, wordEditSchema, wordInputSchema } from "@yds-atlas/shared";
import { z } from "zod";
import {
  assertFeedbackWordBinding,
  assertFeedbackWordBindings,
} from "../features/feedback/inspector-service";
import {
  deleteWords,
  editWord,
  importWords,
  listWords,
  readWordPage,
  saveWord,
} from "../features/words/word-service";
import { HttpError } from "../shared/errors";
import { readJson } from "../shared/http";
import { type RouteContext, unmatchedRoute } from "./route-context";

const uuid = z.uuid();
const bulk = z.array(wordInputSchema).min(1).max(500);

function wordEditRevision(request: Request) {
  const version = request.headers.get("X-Atlas-Expected-Updated-At");
  if (!version)
    throw new HttpError(400, "Kelime sürümü gerekli. Sayfayı yenile.", "INVALID_WORD_VERSION");
  return z.string().datetime().parse(version);
}
export async function wordsRoutes({ request, path, ctx, config }: RouteContext) {
  let result: unknown;
  if (path === "/api/words" && request.method === "GET") result = await listWords(ctx);
  else if (path === "/api/words/page" && request.method === "POST") {
    const { cursor } = z
      .object({ cursor: wordCursorSchema.nullable() })
      .strict()
      .parse(await readJson(request, 2048));
    result = await readWordPage(ctx, cursor);
  } else if (path === "/api/words" && request.method === "POST") {
    const input = wordInputSchema.parse(await readJson(request));
    await assertFeedbackWordBinding(config, input, true);
    result = await saveWord(ctx, input);
  } else if (path === "/api/words/import" && request.method === "POST") {
    const inputs = bulk.parse(await readJson(request));
    await assertFeedbackWordBindings(config, inputs, true);
    result = await importWords(ctx, inputs);
  } else if (path === "/api/words/bulk" && request.method === "DELETE")
    result = await deleteWords(
      ctx,
      z
        .array(uuid)
        .min(1)
        .max(500)
        .parse(await readJson(request)),
    );
  else if (path === "/api/words/scores" && request.method === "PUT") {
    throw new HttpError(
      410,
      "Puanlar yalnızca tamamlanan değerlendirmeden kaydedilir.",
      "SCORE_WRITE_REMOVED",
    );
  } else if (/^\/api\/words\/[^/]+$/.test(path)) {
    const id = uuid.parse(path.split("/").at(-1));
    if (request.method === "PUT") {
      const expectedUpdatedAt = wordEditRevision(request);
      const input = wordInputSchema.parse(await readJson(request));
      await assertFeedbackWordBinding(config, input);
      result = await saveWord(ctx, input, id, expectedUpdatedAt);
    } else if (request.method === "PATCH") {
      const expectedUpdatedAt = wordEditRevision(request);
      const patch = wordEditSchema.parse(await readJson(request));
      result = await editWord(ctx, id, patch, expectedUpdatedAt);
    } else if (request.method === "DELETE") result = await deleteWords(ctx, [id]);
    else throw new HttpError(405, "Bu işlem desteklenmiyor.", "METHOD_NOT_ALLOWED");
  } else return unmatchedRoute;
  return result;
}
