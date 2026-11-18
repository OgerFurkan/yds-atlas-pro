import {
  aiChatRequestSchema,
  aiNamedWordsRequestSchema,
  aiWordListRequestSchema,
  aiWordRequestSchema,
  lexiconResolveRequestSchema,
  type WordInput,
} from "@yds-atlas/shared";
import type { ServerConfig } from "../../config/env";
import type { RequestContext } from "../../shared/supabase";
import { readJson } from "../../shared/http";
import { HttpError } from "../../shared/errors";
import type { generateChatReply } from "../ai/chat";
import { replyUsingLexiconOrAi } from "../lexicon/lexicon-chat";
import {
  resolveTieredLexiconRequest,
  completeTieredLexiconWords,
  listTieredLexiconCandidates,
  suggestTieredLexiconWords,
} from "../lexicon/lexicon-http";
import { recommendLexiconWords } from "../lexicon/lexicon-recommendations";
import { verifyUserWordLexiconBinding } from "../lexicon/lexicon-binding";
import { inspectTieredLexicon, rejectInspectorDuringSavedAssessment } from "../lexicon/lexicon-inspector";
import { assertAtlasAdmin, adminOverview } from "../admin/admin-service";
import { tryEditorialAdminRoute } from "../admin/admin-editorial-routes";

/** Narrow integration boundary. Existing main routes remain untouched when disabled. */
export type FeedbackDependencies = {
  generateChat: typeof generateChatReply;
  consumeQuota?: (userId: string) => Promise<boolean>;
};
export type FeedbackRouteResult = { handled: true; value: unknown } | { handled: false };

/** Always authenticate the request in createApp() BEFORE invoking this router. */
export async function tryFeedbackRoute(
  request: Request,
  ctx: RequestContext,
  config: ServerConfig,
  deps: FeedbackDependencies,
): Promise<FeedbackRouteResult> {
  if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED) return { handled: false };
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}`;
  const editorial = await tryEditorialAdminRoute(request, ctx, config);
  if (editorial.handled) return editorial;
  switch (key) {
    case "GET /api/lexicon/inspect": {
      const keys = [...url.searchParams.keys()];
      if (keys.some(k => !["word", "partOfSpeech", "meaning"].includes(k)) ||
          ["word", "partOfSpeech", "meaning"].some(k => url.searchParams.getAll(k).length > 1)) {
        throw new HttpError(400, "Kelime inceleme parametreleri geçersiz.", "INSPECTOR_INVALID_QUERY");
      }
      await rejectInspectorDuringSavedAssessment(ctx);
      return { handled: true, value: await inspectTieredLexicon(config, {
        word: url.searchParams.get("word") ?? "",
        partOfSpeech: url.searchParams.get("partOfSpeech") ?? undefined,
        meaning: url.searchParams.get("meaning") ?? undefined,
      }) };
    }
    case "GET /api/lexicon/candidates":
      return { handled: true, value: await listTieredLexiconCandidates(config, url.searchParams.get("word") ?? "") };
    case "POST /api/lexicon/resolve":
      return { handled: true, value: await resolveTieredLexiconRequest(ctx, config,
        lexiconResolveRequestSchema.parse(await readJson(request, 4096)), request.signal) };
    case "POST /api/lexicon/complete":
      return { handled: true, value: await completeTieredLexiconWords(ctx, config,
        aiNamedWordsRequestSchema.parse(await readJson(request, 4096)).words, request.signal) };
    case "POST /api/lexicon/suggest": {
      const input = aiWordListRequestSchema.parse(await readJson(request, 4096));
      return { handled: true, value: await recommendLexiconWords(ctx, config, input.count, input.exclude) };
    }
    case "GET /api/admin/me":
      assertAtlasAdmin(ctx, config);
      return { handled: true, value: { admin: true } };
    case "GET /api/admin/overview":
      return { handled: true, value: await adminOverview(ctx, config) };
    case "POST /api/ai/chat":
      return { handled: true, value: await replyUsingLexiconOrAi(ctx, config,
        aiChatRequestSchema.parse(await readJson(request, 32768)), request.signal,
        deps.generateChat, deps.consumeQuota) };
    case "POST /api/ai/words/enrich": {
      const input = aiWordRequestSchema.parse(await readJson(request, 4096));
      const resolved = await resolveTieredLexiconRequest(ctx, config, input, request.signal);
      const { entry } = resolved;
      return { handled: true, value: {
        suggestion: { ...entry.content, lexicon: { entryId: entry.id, revision: entry.revision, contractVersion: 1 } },
        provider: "Lexicon", model: resolved.source === "pool" ? "atlas-lexicon-v1" : config.GEMINI_MODEL_WORD,
        lexicon: { source: resolved.source, entryId: entry.id, revision: entry.revision },
      } };
    }
    case "POST /api/ai/words/complete":
      return { handled: true, value: await completeTieredLexiconWords(ctx, config,
        aiNamedWordsRequestSchema.parse(await readJson(request, 4096)).words, request.signal) };
    case "POST /api/ai/words/suggest": {
      const input = aiWordListRequestSchema.parse(await readJson(request, 32768));
      try {
        return { handled: true, value: await recommendLexiconWords(ctx, config, input.count, input.exclude) };
      } catch (error) {
        if (!(error instanceof HttpError) || error.code !== "LEXICON_POOL_EMPTY") throw error;
        // During a cold start only: generate named candidates and resolve each via the pool/lease.
        // This is quota-metered; never silently use a different user's private word data.
        return { handled: true, value: await suggestTieredLexiconWords(ctx, config,
          input.count, input.exclude, request.signal) };
      }
    }
    default:
      return { handled: false };
  }
}

/** The browser may reference a public pool revision, but never select its own approval state. */
export async function assertFeedbackWordBinding(config: ServerConfig, input: WordInput): Promise<void> {
  if (!input.lexicon) return;
  if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED)
    throw new HttpError(409, "Feedback henüz etkin değil.", "LEXICON_DISABLED");
  await verifyUserWordLexiconBinding(config, input);
}
