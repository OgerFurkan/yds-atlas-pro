import {
  aiChatRequestSchema,
  aiNamedWordsRequestSchema,
  aiWordListRequestSchema,
  aiWordRequestSchema,
  gameSessionSchema,
  wordInputSchema,
} from "@yds-atlas/shared";
import { z } from "zod";
import type { ServerConfig } from "./config/env";
import { generateChatReply } from "./features/ai/chat";
import {
  generateEnrichedWord,
  generateNamedWords,
  generateNamedWordsWithDictionary,
  generateWord,
  generateWordList,
} from "./features/ai/gemini";
import { geminiPoolStatus } from "./features/ai/gemini-keys";
import { geminiCapacityStatus } from "./features/ai/gemini-request";
import { accountState, completeSession, saveSession } from "./features/learning/learning-service";
import { deleteWords, importWords, listWords, saveWord } from "./features/words/word-service";
import { inspectFeedback, assertFeedbackWordBinding, assertNoActiveAssessment, assertGameSafeDictionaryWord } from "./features/feedback/inspector-service";
import { draftWord, generateTieredSentences } from "./features/feedback/tiered-sentence-generation";
import { dictionaryWord, lookupPublicTurkish } from "./features/lexicon/public-turkish-dictionary";
import { readSharedTooltipGloss, sentencePrefetchEnabled } from "./features/lexicon/sentence-lexicon-prefetch";
import { enqueueLegacyGlosses, enqueueSentenceGlosses } from "./features/lexicon/persistent-tooltip-queue";
import { databaseError, HttpError } from "./shared/errors";
import { readJson } from "./shared/http";
import { authenticate, quotaClient, type RequestContext } from "./shared/supabase";

type Dependencies = {
  authenticate?: (request: Request) => Promise<RequestContext>;
  generate?: typeof generateWord;
  generateList?: typeof generateWordList;
  generateNamed?: typeof generateNamedWords;
  generateChat?: typeof generateChatReply;
  consumeQuota?: (userId: string) => Promise<boolean>;
  generateTiered?: typeof generateTieredSentences;
};
const uuid = z.uuid();
const bulk = z.array(wordInputSchema).min(1).max(500);
async function persistExampleTokens(config: ServerConfig, sentences: readonly string[]) {
  if (!sentencePrefetchEnabled(config)) return;
  try { await enqueueSentenceGlosses(config, sentences); }
  catch { console.error({ code: "TOOLTIP_QUEUE_ENQUEUE_FAILED" }); }
}
const sessionBody = z
  .object({ snapshot: gameSessionSchema, revision: z.number().int().min(0) })
  .strict();
export function createApp(config: ServerConfig, dependencies: Dependencies = {}) {
  const origins = new Set(
    config.APP_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
      Vary: "Origin",
    });
    if (origin && origins.has(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    try {
      if (origin && !origins.has(origin))
        throw new HttpError(403, "Bu kaynaktan erişime izin verilmiyor.", "ORIGIN_REJECTED");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      const path = new URL(request.url).pathname;
      if (path === "/api/health" && request.method === "GET")
        return Response.json(
          {
            status: "ok",
            databaseConfigured: !!(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY),
            aiConfigured: !!(config.GEMINI_KEYS.length && config.SUPABASE_SECRET_KEY),
            tooltip: { enabled: sentencePrefetchEnabled(config) },
            ai: {
              configured: !!(config.GEMINI_KEYS.length && config.SUPABASE_SECRET_KEY),
              keyCount: config.GEMINI_KEYS.length,
              projectGroupsConfigured: (config.GEMINI_KEY_GROUP_IDS?.length ?? 0) === config.GEMINI_KEYS.length && config.GEMINI_KEYS.length > 0,
              ...geminiCapacityStatus(),
              quotaConfigured: !!config.SUPABASE_SECRET_KEY,
              modelWord: config.GEMINI_MODEL_WORD,
              modelChat: config.GEMINI_MODEL_CHAT,
              word: geminiPoolStatus(config.GEMINI_KEYS, config.GEMINI_MODEL_WORD),
              chat: geminiPoolStatus(config.GEMINI_KEYS, config.GEMINI_MODEL_CHAT),
            },
          },
          { headers },
        );
      if (!path.startsWith("/api/")) throw new HttpError(404, "İstek bulunamadı.", "NOT_FOUND");
      const ctx = await (dependencies.authenticate?.(request) ?? authenticate(request, config));
      let result: unknown;
      if (path === "/api/lexicon/tooltip/backfill" && request.method === "POST") {
        await assertNoActiveAssessment(ctx);
        result = await enqueueLegacyGlosses(ctx, config);
      } else if (path === "/api/lexicon/inspect" && request.method === "GET") {
        const inspected = await inspectFeedback(ctx, config, new URL(request.url).searchParams);
        result = inspected;
        if (sentencePrefetchEnabled(config) && inspected.status === "ready")
          await persistExampleTokens(config, inspected.entry.examples.map((item) => item.sentence));
      } else if (path === "/api/dictionary/turkish" && request.method === "GET") {
        if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED)
          throw new HttpError(404, "Sözlük etkin değil.", "DICTIONARY_DISABLED");
        const parameters = new URL(request.url).searchParams;
        if ([...parameters.keys()].some((key) => key !== "word") || parameters.getAll("word").length !== 1)
          throw new HttpError(400, "Sözlük sorgusu geçersiz.", "DICTIONARY_INVALID_QUERY");
        const word = dictionaryWord(parameters.get("word") ?? "");
        await assertGameSafeDictionaryWord(ctx, word);
        let cached: Awaited<ReturnType<typeof readSharedTooltipGloss>> = null;
        try {
          // This optional, read-only shared lookup may be unavailable before a migration.
          cached = await readSharedTooltipGloss(quotaClient(config), word);
        } catch {
          // A missing shared cache does not justify unsafe or fabricated meanings.
          // The licensed provider is independently bounded and validated.
        }
        result = cached ? {
          status: "ready" as const, word,
          entries: [{ partOfSpeech: cached.partOfSpeech, meanings: cached.meanings }],
          source: { provider: "FreeDictionaryAPI.com / Wiktionary" as const,
            url: cached.url, license: "CC BY-SA 4.0" as const,
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" as const },
        } : await lookupPublicTurkish(word, ctx.userId);
        if (result && typeof result === "object" && "status" in result && result.status === "ready")
          await persistExampleTokens(config, [word]);
      } else if (path === "/api/lexicon/examples/draft" && request.method === "POST") {
        if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED)
          throw new HttpError(404, "Cümle üretimi etkin değil.", "SENTENCE_DISABLED");
        await assertNoActiveAssessment(ctx);
        const { word: inputWord } = z.object({ word: z.string().min(1).max(45) }).strict()
          .parse(await readJson(request, 2048));
        const word = draftWord(inputWord);
        if (!config.GEMINI_KEYS.length)
          throw new HttpError(503, "Cümle üretimi henüz kullanılamıyor.", "AI_NOT_CONFIGURED");
        const allowed = dependencies.consumeQuota
          ? await dependencies.consumeQuota(ctx.userId)
          : await (async () => {
              const quota = await quotaClient(config).rpc("consume_ai_quota", { p_user_id: ctx.userId });
              databaseError(quota.error);
              return quota.data === true;
            })();
        if (!allowed) throw new HttpError(429, "AI kullanım sınırına ulaşıldı.", "AI_QUOTA_EXCEEDED");
        const draft = await (dependencies.generateTiered ?? generateTieredSentences)(word, config, request.signal);
        await persistExampleTokens(config, draft.examples.map((item) => item.sentence));
        result = { status: "draft", ...draft };
      } else if (path === "/api/words" && request.method === "GET") result = await listWords(ctx);
      else if (path === "/api/words" && request.method === "POST") {
        const input = wordInputSchema.parse(await readJson(request));
        await assertFeedbackWordBinding(config, input, true);
        result = await saveWord(ctx, input);
        await persistExampleTokens(config, input.examples.map((e) => e.sentence));
      } else if (path === "/api/words/import" && request.method === "POST") {
        const inputs = bulk.parse(await readJson(request));
        for (const input of inputs) await assertFeedbackWordBinding(config, input, true);
        result = await importWords(ctx, inputs);
        await persistExampleTokens(config, inputs.flatMap((input) => input.examples.map((e) => e.sentence)));
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
        const scores = z
          .array(z.object({ id: uuid, score: z.number().int().min(0).max(100) }).strict())
          .min(1)
          .max(500)
          .refine((items) => new Set(items.map((item) => item.id)).size === items.length)
          .parse(await readJson(request));
        const update = await ctx.db.rpc("apply_word_scores", { p_scores: scores });
        databaseError(update.error);
        result = { updated: true };
      } else if (/^\/api\/words\/[^/]+$/.test(path)) {
        const id = uuid.parse(path.split("/").at(-1));
        if (request.method === "PUT") {
          const input = wordInputSchema.parse(await readJson(request));
          await assertFeedbackWordBinding(config, input);
          result = await saveWord(ctx, input, id);
          await persistExampleTokens(config, input.examples.map(e => e.sentence));
        } else if (request.method === "DELETE") result = await deleteWords(ctx, [id]);
        else throw new HttpError(405, "Bu işlem desteklenmiyor.", "METHOD_NOT_ALLOWED");
      } else if (path === "/api/account" && request.method === "GET")
        result = await accountState(ctx);
      else if (path === "/api/account/goal" && request.method === "PUT") {
        const { goal } = z
          .object({ goal: z.number().int().min(10).max(100).multipleOf(10) })
          .strict()
          .parse(await readJson(request));
        const update = await ctx.db.rpc("set_daily_goal", { p_goal: goal });
        databaseError(update.error);
        result = { goal };
      } else if (path === "/api/learning/session" && request.method === "PUT") {
        const { snapshot, revision } = sessionBody.parse(await readJson(request));
        uuid.parse(snapshot.id);
        if (
          snapshot.tutorial ||
          snapshot.words.length > 100 ||
          new Set(snapshot.words.map((word) => word.id)).size !== snapshot.words.length
        )
          throw new HttpError(400, "Görev bilgileri geçersiz.", "INVALID_SESSION");
        snapshot.words.forEach((word) => uuid.parse(word.id));
        result = await saveSession(ctx, snapshot, revision);
      } else if (
        /^\/api\/learning\/sessions\/[^/]+\/complete$/.test(path) &&
        request.method === "POST"
      )
        result = await completeSession(ctx, uuid.parse(path.split("/")[4]));
      else if (
        (path === "/api/ai/words/enrich" ||
          path === "/api/ai/words/suggest" ||
          path === "/api/ai/words/complete" ||
          path === "/api/ai/chat") &&
        request.method === "POST"
      ) {
        const body = await readJson(
          request,
          path.endsWith("/suggest") || path.endsWith("/chat") ? 32768 : 2048,
        );
        const input = path.endsWith("/suggest")
          ? aiWordListRequestSchema.parse(body)
          : path.endsWith("/complete")
            ? aiNamedWordsRequestSchema.parse(body)
            : path.endsWith("/chat")
              ? aiChatRequestSchema.parse(body)
              : aiWordRequestSchema.parse(body);
        if (!config.GEMINI_KEYS.length)
          throw new HttpError(503, "Gemini henüz yapılandırılmadı.", "AI_NOT_CONFIGURED");
        const allowed = dependencies.consumeQuota
          ? await dependencies.consumeQuota(ctx.userId)
          : await (async () => {
              const quota = await quotaClient(config).rpc("consume_ai_quota", {
                p_user_id: ctx.userId,
              });
              databaseError(quota.error);
              return quota.data === true;
            })();
        if (!allowed)
          throw new HttpError(
            429,
            "AI kullanım sınırına ulaşıldı. Hesap başına dakikada 15 AI isteği yapılabilir; bir dakika sonra tekrar dene.",
            "AI_QUOTA_EXCEEDED",
          );
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
                  )
                : await (dependencies.generateList ?? generateWordList)(
                    input.count,
                    input.exclude,
                    config,
                    request.signal,
                  );
      } else throw new HttpError(404, "İstek bulunamadı.", "NOT_FOUND");
      return Response.json(result, { headers });
    } catch (error) {
      const known =
        error instanceof HttpError
          ? error
          : error instanceof z.ZodError
            ? new HttpError(
                400,
                "Gönderilen bilgiler geçersiz. Alanları kontrol et.",
                "VALIDATION_ERROR",
              )
            : new HttpError(500, "İşlem tamamlanamadı. Yeniden deneyebilirsin.", "INTERNAL_ERROR");
      if (known.status >= 500) console.error({ requestId, code: known.code, status: known.status });
      if (known.status === 429) headers.set("Retry-After", "60");
      return Response.json(
        { error: known.message, code: known.code, requestId },
        { status: known.status, headers },
      );
    }
  };
}
