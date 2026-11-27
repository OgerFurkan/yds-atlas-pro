import {
  aiChatRequestSchema,
  aiNamedWordsRequestSchema,
  aiWordListRequestSchema,
  aiWordRequestSchema,
} from "@yds-atlas/shared";
import { generateChatReply } from "../features/ai/chat";
import {
  generateEnrichedWord,
  generateNamedWordsWithDictionary,
  generateWordList,
} from "../features/ai/gemini";
import { assertNoActiveAssessment } from "../features/feedback/inspector-service";
import { HttpError } from "../shared/errors";
import { readJson } from "../shared/http";
import { type RouteContext, unmatchedRoute } from "./route-context";

export async function aiRoutes({
  request,
  path,
  ctx,
  config,
  dependencies,
  beginAi,
}: RouteContext) {
  let result: unknown;
  if (
    (path === "/api/ai/words/enrich" ||
      path === "/api/ai/words/suggest" ||
      path === "/api/ai/words/complete" ||
      path === "/api/ai/chat") &&
    request.method === "POST"
  ) {
    const body = await readJson(request, path.endsWith("/enrich") ? 2048 : 32768);
    const input = path.endsWith("/suggest")
      ? aiWordListRequestSchema.parse(body)
      : path.endsWith("/complete")
        ? aiNamedWordsRequestSchema.parse(body)
        : path.endsWith("/chat")
          ? aiChatRequestSchema.parse(body)
          : aiWordRequestSchema.parse(body);
    if (!config.GEMINI_KEYS.length)
      throw new HttpError(503, "Gemini henüz yapılandırılmadı.", "AI_NOT_CONFIGURED");
    await assertNoActiveAssessment(ctx);
    await beginAi(ctx.userId);
    result =
      "messages" in input
        ? await (dependencies.generateChat ?? generateChatReply)(input, config, request.signal)
        : "word" in input
          ? await (dependencies.generate ?? generateEnrichedWord)(
              input.word,
              config,
              request.signal,
            )
          : "words" in input
            ? await (dependencies.generateNamed ?? generateNamedWordsWithDictionary)(
                input.words,
                config,
                request.signal,
                undefined,
                undefined,
                input.senses,
              )
            : await (dependencies.generateList ?? generateWordList)(
                input.count,
                input.exclude,
                config,
                request.signal,
              );
    // Another device may start a study while the provider is generating.
    await assertNoActiveAssessment(ctx);
  } else return unmatchedRoute;
  return result;
}
