import {
  aiChatRequestSchema,
  aiNamedWordsRequestSchema,
  aiWordListRequestSchema,
  aiWordRequestSchema,
  lexiconResolveRequestSchema,
  dailyPlanSaveSchema,
  gameSessionSchema,
  wordGroupSchema,
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
import { accountState, completeSession, saveSession } from "./features/learning/learning-service";
import { completeSessionWithReviewWriter } from "./features/learning/review-completion-service";
import { saveSessionWithPrivilegedWriter } from "./features/learning/session-save-writer-service";
import { setDailyGoalWithPrivilegedWriter } from "./features/learning/goal-writer-service";
import { readDailyPlan, saveDailyPlan } from "./features/learning/daily-plan-service";
import { readReviewSchedules } from "./features/learning/review-schedule-service";
import { deleteWords, importWords, listWords, saveWord } from "./features/words/word-service";
import {enqueueWordExamples,lookupSharedGloss,tooltipWriteEnabled,drainSharedLexiconQueue} from "./features/lexicon/sentence-lexicon-prefetch";
import { recommendLexiconWords } from "./features/lexicon/lexicon-recommendations";
import { replyUsingLexiconOrAi } from "./features/lexicon/lexicon-chat";
import { assertAtlasAdmin, adminOverview } from "./features/admin/admin-service";
import { resolveTieredLexiconRequest, completeTieredLexiconWords, listTieredLexiconCandidates } from "./features/lexicon/lexicon-http";
import { verifyUserWordLexiconBinding } from "./features/lexicon/lexicon-binding";
import { tryFeedbackRoute } from "./features/feedback/feedback-routes";
import { lookupPublicTurkish } from "./features/lexicon/public-turkish-dictionary";
import { rejectInspectorDuringSavedAssessment } from "./features/lexicon/lexicon-inspector";
import { databaseError, HttpError } from "./shared/errors";
import { readJson } from "./shared/http";
import { authenticate, dailyPlanWriterClient, goalWriterClient, quotaClient, reviewWriterClient, sessionSaveWriterClient, type RequestContext } from "./shared/supabase";

type Dependencies = {
  authenticate?: (request: Request) => Promise<RequestContext>;
  // Testing seam: production instantiates a private server-only writer.
  dailyPlanWriter?: () => RequestContext["db"];
  reviewWriter?: () => RequestContext["db"];
  sessionSaveWriter?: () => RequestContext["db"];
  goalWriter?: () => RequestContext["db"];
  generate?: typeof generateWord;
  generateList?: typeof generateWordList;
  generateNamed?: typeof generateNamedWords;
  generateChat?: typeof generateChatReply;
  consumeQuota?: (userId: string) => Promise<boolean>;
};
const uuid = z.uuid();
const bulk = z.array(wordInputSchema).min(1).max(500);
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
            ai: {
              configured: !!(config.GEMINI_KEYS.length && config.SUPABASE_SECRET_KEY),
              keyCount: config.GEMINI_KEYS.length,
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
      // Authenticate first; the Feedback router is a strict no-op while the flag is OFF.
      // Existing v4 learning, SRS, writer and Lexicon routes remain the fallback.
      const feedback = await tryFeedbackRoute(request, ctx, config, {
        generateChat: dependencies.generateChat ?? generateChatReply,
        consumeQuota: dependencies.consumeQuota,
      });
      if (feedback.handled) result = feedback.value;
      else if (path === "/api/dictionary/turkish" && request.method === "GET") {
        if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED) throw new HttpError(404,"Sözlük etkin değil.","DICTIONARY_DISABLED");
        await rejectInspectorDuringSavedAssessment(ctx);
        const term=new URL(request.url).searchParams.get("word")??"";
        const cached=await lookupSharedGloss(quotaClient(config),term);
        result=cached?{status:"ready" as const,word:term,
         entries:[{partOfSpeech:cached.partOfSpeech,meanings:cached.meanings}],
         source:{provider:"FreeDictionaryAPI.com / Wiktionary" as const,url:cached.url,
          license:"CC BY-SA 4.0" as const,licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/"}}:
          await lookupPublicTurkish(term,ctx.userId);
      }
      else if (path === "/api/lexicon/candidates" && request.method === "GET") {
        result=await listTieredLexiconCandidates(config,new URL(request.url).searchParams.get("word")??"");
      } else if (path === "/api/lexicon/resolve" && request.method === "POST")
        result = await resolveTieredLexiconRequest(ctx,config,
          lexiconResolveRequestSchema.parse(await readJson(request,4096)),request.signal);
      else if(path === "/api/lexicon/complete" && request.method === "POST") {
        const words = aiNamedWordsRequestSchema.parse(await readJson(request,4096)).words;
        result = await completeTieredLexiconWords(ctx,config,words,request.signal);
      } else if(path === "/api/lexicon/suggest" && request.method === "POST") {
        const input=aiWordListRequestSchema.parse(await readJson(request,4096));
        result=await recommendLexiconWords(ctx,config,input.count,input.exclude);
      } else if(path === "/api/ai/chat" && request.method === "POST") {
        result=await replyUsingLexiconOrAi(ctx,config,
          aiChatRequestSchema.parse(await readJson(request,32768)),request.signal,
          dependencies.generateChat ?? generateChatReply, dependencies.consumeQuota);
      } else if(path === "/api/admin/me" && request.method === "GET") {
        assertAtlasAdmin(ctx,config);
        result={admin:true};
      } else if(path === "/api/admin/overview" && request.method === "GET") {
        result=await adminOverview(ctx,config);
      } else if (path === "/api/words" && request.method === "GET") result = await listWords(ctx);
      else if (path === "/api/words" && request.method === "POST") {
        const input=wordInputSchema.parse(await readJson(request));
        await verifyUserWordLexiconBinding(config,input);
        result=await saveWord(ctx,input);
        if(tooltipWriteEnabled(config)){enqueueWordExamples([input]);void drainSharedLexiconQueue(config).catch(()=>{});}
      }
      else if (path === "/api/words/import" && request.method === "POST") {
        const inputs=bulk.parse(await readJson(request));
        for(const input of inputs)if(input.lexicon)await verifyUserWordLexiconBinding(config,input);
        result = await importWords(ctx,inputs);
        if(tooltipWriteEnabled(config)){enqueueWordExamples(inputs);void drainSharedLexiconQueue(config).catch(()=>{});}
      }
      else if (path === "/api/words/bulk" && request.method === "DELETE")
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
      } else if (path === "/api/words/groups" && request.method === "PUT") {
        // A manual library label is NOT a learning score or completed game.
        const groups = z.array(z.object({ id: uuid, group: wordGroupSchema }).strict())
          .min(1).max(500)
          .refine((items) => new Set(items.map((item) => item.id)).size === items.length)
          .parse(await readJson(request));
        const response = await ctx.db.rpc("set_word_groups_v7", {
          p_groups: groups.map(({ id, group }) => ({ id, group_name: group })),
        });
        if (response.error?.code === "42501")
          throw new HttpError(403, "Bu kelimeleri değiştirme iznin yok.", "FORBIDDEN");
        databaseError(response.error);
        if (!Number.isSafeInteger(response.data) || response.data !== groups.length)
          throw new HttpError(503, "Kelime grupları doğrulanamadı.", "WORD_GROUP_RESULT_INVALID");
        result = { updated: true };
      } else if (/^\/api\/words\/[^/]+$/.test(path)) {
        const id = uuid.parse(path.split("/").at(-1));
        if (request.method === "PUT") {
          const input=wordInputSchema.parse(await readJson(request));
          await verifyUserWordLexiconBinding(config,input);
          result=await saveWord(ctx,input,id);
          if(tooltipWriteEnabled(config)){enqueueWordExamples([input]);void drainSharedLexiconQueue(config).catch(()=>{});}
        }
        else if (request.method === "DELETE") result = await deleteWords(ctx, [id]);
        else throw new HttpError(405, "Bu işlem desteklenmiyor.", "METHOD_NOT_ALLOWED");
      } else if (path === "/api/account" && request.method === "GET")
        result = await accountState(ctx);
      else if (path === "/api/account/daily-plan" && request.method === "GET")
        result = await readDailyPlan(ctx);
      else if (path === "/api/account/review-schedules" && request.method === "GET")
        result = await readReviewSchedules(ctx);
      else if (path === "/api/account/daily-plan" && request.method === "PUT") {
        const input = dailyPlanSaveSchema.parse(await readJson(request, 128_000));
        const writer = dependencies.dailyPlanWriter?.() ?? dailyPlanWriterClient(config);
        result = await saveDailyPlan(ctx, input, writer);
      }
      else if (path === "/api/account/goal" && request.method === "PUT") {
        const { goal } = z
          .object({ goal: z.number().int().min(10).max(100).multipleOf(10) })
          .strict()
          .parse(await readJson(request));
        if (config.GOAL_WRITE_V6_ENABLED) {
          result = await setDailyGoalWithPrivilegedWriter(
            ctx, goal,
            () => dependencies.goalWriter?.() ?? goalWriterClient(config),
          );
        } else {
          const update = await ctx.db.rpc("set_daily_goal", { p_goal: goal });
          databaseError(update.error);
          result = { goal };
        }
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
        result = config.SESSION_SAVE_V5_ENABLED
          ? await saveSessionWithPrivilegedWriter(
              ctx, snapshot, revision,
              () => dependencies.sessionSaveWriter?.() ?? sessionSaveWriterClient(config),
            )
          : await saveSession(ctx, snapshot, revision);
      } else if (
        /^\/api\/learning\/sessions\/[^/]+\/complete$/.test(path) &&
        request.method === "POST"
      )
        result = config.REVIEW_WRITE_V3_ENABLED
          ? await completeSessionWithReviewWriter(
              ctx, uuid.parse(path.split("/")[4]),
              () => dependencies.reviewWriter?.() ?? reviewWriterClient(config),
            )
          : await completeSession(ctx, uuid.parse(path.split("/")[4]));
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
              ? input.partOfSpeech
                ? await generateEnrichedWord(input.word, config, request.signal, undefined, undefined, input.partOfSpeech)
                : await (dependencies.generate ?? generateEnrichedWord)(
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
