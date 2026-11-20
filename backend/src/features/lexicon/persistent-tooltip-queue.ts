import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../../config/env";
import { HttpError } from "../../shared/errors";
import { quotaClient, type RequestContext } from "../../shared/supabase";
import { listWords } from "../words/word-service";
import { dictionaryWord, lookupPublicTurkish } from "./public-turkish-dictionary";
import {
  buildTooltipRecord, publishShortGloss, readSharedTooltipGloss,
  sentencePrefetchEnabled, sentenceTokens,
} from "./sentence-lexicon-prefetch";

/** Only verified English headword tokens enter this table: no sentences, user IDs, or translations. */
const MAX_DISTINCT_PER_CALL = 7500;
const CHUNK = 100;
let draining = false;
export type DurableQueueResult = {
  queued: number; distinct: number; capped: boolean; disabled?: boolean;
};
type ServiceDb = Pick<SupabaseClient, "from" | "rpc">;

/** Case-sensitive PII precaution; never forward full examples or account identifiers. */
export function extractGlossKeys(sentences: readonly string[]): string[] {
  const unique = new Set<string>();
  for (let i = 0; i < sentences.length; i += 100) {
    for (const candidate of sentenceTokens(sentences.slice(i, i + 100))) {
      try {
        const key = dictionaryWord(candidate);
        if (key.length < 2) continue;
        unique.add(key);
      } catch { /* Strict dictionary spelling only. */ }
      if (unique.size >= MAX_DISTINCT_PER_CALL) return [...unique];
    }
  }
  return [...unique];
}

/** Insert-only dedup: never rewrite a leased/verified/terminal entry on duplicate. */
export async function persistGlossKeys(
  config: ServerConfig,
  keys: readonly string[],
  client?: ServiceDb,
): Promise<DurableQueueResult> {
  if (!sentencePrefetchEnabled(config))
    return { queued: 0, distinct: 0, capped: false, disabled: true };
  const normalized = [...new Set(keys.filter(key =>
    /^[a-z]+(?:[-'][a-z]+)?$/.test(key) && key.length >= 2 && key.length <= 45))];
  const safe = normalized.slice(0, MAX_DISTINCT_PER_CALL);
  const db = client ?? quotaClient(config);
  for (let offset = 0; offset < safe.length; offset += CHUNK) {
    const { error } = await db.from("atlas_tooltip_queue")
      .upsert(safe.slice(offset, offset + CHUNK).map(word_key => ({word_key})),
        { onConflict: "word_key", ignoreDuplicates: true });
    if (error) throw new Error("TOOLTIP_QUEUE_PERSIST_FAILED");
  }
  return { queued: safe.length, distinct: safe.length, capped: normalized.length > safe.length };
}

export async function enqueueSentenceGlosses(
  config: ServerConfig,
  sentences: readonly string[],
  client?: ServiceDb,
): Promise<DurableQueueResult> {
  return persistGlossKeys(config, extractGlossKeys(sentences), client);
}

/**
 * Explicit user-initiated history scan. User-scoped Supabase RLS is the only source;
 * only derived lowercase English tokens go to a shared service-role queue.
 * Never mutate personal words, scores, or learning sessions.
 */
export async function enqueueLegacyGlosses(
  ctx: RequestContext,
  config: ServerConfig,
  client?: ServiceDb,
) {
  if (!sentencePrefetchEnabled(config))
    throw new HttpError(503, "Kalıcı sözlük kuyruğu henüz etkin değil.", "TOOLTIP_QUEUE_DISABLED");
  const words = await listWords(ctx); // Existing RLS and pagination.
  if (words.length > 2000)
    throw new HttpError(413, "Kütüphane taraması için hesap sınırı aşıldı.", "TOOLTIP_BACKFILL_TOO_LARGE");
  const sentences = words.flatMap(word => word.examples.map(e => e.sentence));
  const tokens = extractGlossKeys(sentences);
  const result = await persistGlossKeys(config, tokens, client);
  if (result.disabled) throw new HttpError(503, "Kalıcı sözlük kuyruğu kapalı.", "TOOLTIP_QUEUE_DISABLED");
  return { status: "queued" as const, scannedWords: words.length, scannedSentences: sentences.length,
    distinctCandidates: tokens.length, queuedCandidates: result.queued,
    deduplicatedGlobally: true, mayBeIncomplete: result.capped };
}

/** Run at most one worker per process and use database leases across processes. */
export async function processGlossQueue(
  config: ServerConfig,
  options: { db?: ServiceDb; dictionary?: typeof lookupPublicTurkish; maxBatch?: number } = {},
) {
  if (!sentencePrefetchEnabled(config)) return { status: "disabled" as const, scanned: 0, published: 0 };
  if (draining) return { status: "busy" as const, scanned: 0, published: 0 };
  draining = true;
  let scanned = 0, published = 0;
  try {
    const db = options.db ?? quotaClient(config);
    const token = randomUUID();
    const { data, error } = await db.rpc("atlas_tooltip_claim_v1", {
      p_limit: Math.min(5, Math.max(1, options.maxBatch ?? 5)), p_token: token,
    });
    if (error) throw new Error("TOOLTIP_QUEUE_CLAIM_FAILED");
    if (!Array.isArray(data)) throw new Error("TOOLTIP_QUEUE_CLAIM_INVALID");
    for (const row of data as { word_key: string; lease_token: string }[]) {
      const word = row?.word_key;
      if (typeof word !== "string" || row.lease_token !== token)
        throw new Error("TOOLTIP_QUEUE_LEASE_INVALID");
      scanned++;
      let outcome: "ready" | "missing" | "retry" = "retry";
      let reason: string | null = null;
      try {
        if (await readSharedTooltipGloss(db as SupabaseClient, word)) {
          outcome = "ready"; published++;
        } else {
          const dictionary = await (options.dictionary ?? lookupPublicTurkish)(word, "atlas-tooltip-worker");
          const record = buildTooltipRecord(word, dictionary);
          if (record) {
            if (!(await publishShortGloss(db as SupabaseClient, record)))
              throw new Error("TOOLTIP_PUBLISH_LEASE_BUSY");
            outcome = "ready"; published++;
          } else {
            // No single licensed Turkish sense: remain explicitly NOT ready.
            outcome = "missing";
          }
        }
      } catch {
        reason = "LOOKUP_OR_PUBLISH_FAILED"; // Never log source/user/word.
      }
      const { data: finished, error: finishError } = await db.rpc("atlas_tooltip_finish_v1", {
        p_word_key: word, p_token: token, p_outcome: outcome, p_error_code: reason,
      });
      if (finishError || finished !== true) throw new Error("TOOLTIP_QUEUE_FINISH_FAILED");
    }
  } finally { draining = false; }
  return { status: "processed" as const, scanned, published };
}

export function startPersistentTooltipWorker(config: ServerConfig) {
  if (!sentencePrefetchEnabled(config)) return () => {};
  const run = () => {
    void processGlossQueue(config).catch(() =>
      console.error({ code: "TOOLTIP_QUEUE_WORKER_FAILED" }));
  };
  // A sleeping free Render instance resumes from the durable DB queue on wake.
  run();
  const timer = setInterval(run, 60_000); // <= 300 provider lookups per awake hour.
  timer.unref?.();
  return () => clearInterval(timer);
}
