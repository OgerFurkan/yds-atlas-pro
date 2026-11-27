import { z } from "zod";
import {
  assertGameSafeDictionaryWord,
  assertNoActiveAssessment,
  inspectFeedback,
  readLexiconPreview,
} from "../features/feedback/inspector-service";
import {
  draftWord,
  generateTieredSentences,
} from "../features/feedback/tiered-sentence-generation";
import { dictionaryWord, lookupPublicTurkish } from "../features/lexicon/public-turkish-dictionary";
import { HttpError } from "../shared/errors";
import { readJson } from "../shared/http";
import { type RouteContext, unmatchedRoute } from "./route-context";

export async function lexiconRoutes({
  request,
  path,
  ctx,
  config,
  dependencies,
  beginAi,
}: RouteContext) {
  let result: unknown;
  if (path === "/api/lexicon/tooltip/backfill" && request.method === "POST") {
    throw new HttpError(
      410,
      "Kişisel içerikten ortak sözlük üretimi kapalı.",
      "TOOLTIP_BACKFILL_RETIRED",
    );
  } else if (path === "/api/lexicon/preview" && request.method === "GET") {
    result = await readLexiconPreview(
      ctx,
      config,
      new URL(request.url).searchParams.getAll("word"),
    );
  } else if (path === "/api/lexicon/inspect" && request.method === "GET") {
    result = await inspectFeedback(ctx, config, new URL(request.url).searchParams);
  } else if (path === "/api/dictionary/turkish" && request.method === "GET") {
    if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED)
      throw new HttpError(404, "Sözlük etkin değil.", "DICTIONARY_DISABLED");
    const parameters = new URL(request.url).searchParams;
    if (
      [...parameters.keys()].some((key) => key !== "word") ||
      parameters.getAll("word").length !== 1
    )
      throw new HttpError(400, "Sözlük sorgusu geçersiz.", "DICTIONARY_INVALID_QUERY");
    const word = dictionaryWord(parameters.get("word") ?? "");
    await assertGameSafeDictionaryWord(ctx, word);
    result = await lookupPublicTurkish(word, ctx.userId);
    await assertGameSafeDictionaryWord(ctx, word);
  } else if (path === "/api/lexicon/examples/draft" && request.method === "POST") {
    if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED)
      throw new HttpError(404, "Cümle üretimi etkin değil.", "SENTENCE_DISABLED");
    await assertNoActiveAssessment(ctx);
    const { word: inputWord } = z
      .object({ word: z.string().min(1).max(45) })
      .strict()
      .parse(await readJson(request, 2048));
    const word = draftWord(inputWord);
    if (!config.GEMINI_KEYS.length)
      throw new HttpError(503, "Cümle üretimi henüz kullanılamıyor.", "AI_NOT_CONFIGURED");
    await beginAi(ctx.userId);
    const draft = await (dependencies.generateTiered ?? generateTieredSentences)(
      word,
      config,
      request.signal,
    );

    await assertNoActiveAssessment(ctx);
    result = { status: "draft", ...draft };
  } else return unmatchedRoute;
  return result;
}
