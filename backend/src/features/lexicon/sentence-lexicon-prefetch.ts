import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../../config/env";
import { quotaClient } from "../../shared/supabase";
import {
  dictionaryWord,
  lookupPublicTurkish,
  type PublicTurkishResult,
} from "./public-turkish-dictionary";

/**
 * A derivative of PR #17's one-pool, revision-ledger design. Tokens only: never
 * send full sentences, user identities or personal-library rows to a dictionary.
 * Default OFF, and no second shared dictionary table.
 */
const KIND = "atlas_tooltip_gloss_v1";
const COMMON = new Set(
  "a an the and or but of to in on at for from with by as is are was were be been have has had can may must will would should could this that these those they their we our you your it its which who what when where although while because if than not after before between into during through such more most also both each only other some any all one two".split(" "),
);
const TOKEN = /[A-Za-z]+(?:[’'][A-Za-z]+)?(?:-[A-Za-z]+)*/g;
const due = new Map<string, number>();
const MAX_QUEUE = 1500;
let active = false;

export function sentenceTokens(sentences: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const sentence of sentences.slice(0, 100)) {
    if (!sentence || sentence.length > 1200) continue;
    // Never discover names, addresses, URLs or other user-provided identifiers.
    const safe = sentence
      .replace(/(?:https?:\/\/|www\.)\S+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
      .replace(/(?:^|\s)[@#][\w.-]+/g, " ");
    for (const item of safe.matchAll(TOKEN)) {
      // Possible proper names, including sentence-initial ones, are not exported.
      // Lowercase vocabulary (including ordinary function words) is queued.
      if (/[A-Z]/.test(item[0])) continue; // Conservative PII / proper-name protection.
      const token = item[0].normalize("NFKC").toLocaleLowerCase("en").replaceAll("’", "'");
      if (token.length > 45 || !/^[a-z]+(?:'[a-z]+)?(?:-[a-z]+)?$/.test(token)) continue;
      unique.add(token);
    }
  }
  // Meaningful vocabulary is indexed first; articles and short function words
  // remain eligible, but do not starve content words in the bounded worker.
  return [...unique].sort((a, b) => Number(COMMON.has(a)) - Number(COMMON.has(b)));
}

export function queueSentenceWords(sentences: readonly string[]): number {
  let queued = 0;
  for (const word of sentenceTokens(sentences)) {
    if (due.size >= MAX_QUEUE) break;
    if (due.has(word)) continue;
    due.set(word, 0);
    queued++;
  }
  return queued;
}

export function sentencePrefetchEnabled(config: ServerConfig): boolean {
  return config.ATLAS_FEEDBACK_LEXICON_ENABLED &&
    process.env.ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED === "true" &&
    !!config.SUPABASE_SECRET_KEY;
}

type GlossRow = {
  word_key: string;
  part_of_speech: string;
  status: string;
  content: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

function verifyShortGloss(row: GlossRow, word: string) {
  if (row.word_key !== word || row.part_of_speech !== "Tooltip" ||
      row.status !== "machine_validated" || row.content?.kind !== KIND ||
      row.provenance?.kind !== KIND || row.provenance?.license !== "CC BY-SA 4.0" ||
      !["FreeDictionaryAPI.com / Wiktionary","Wiktapi / Turkish Wiktionary"].includes(
        String(row.provenance?.provider))) return null;
  const meanings = row.content.meanings;
  const originalPart = row.content.originalPartOfSpeech;
  if (!Array.isArray(meanings) || meanings.length < 1 || meanings.length > 4 ||
      !meanings.every((value) => typeof value === "string" && value.length > 0 && value.length <= 85) ||
      typeof originalPart !== "string" || originalPart.length > 35) return null;
  try {
    const url = new URL(String(row.provenance.url));
    const host=row.provenance.provider==="Wiktapi / Turkish Wiktionary"
      ? "tr.wiktionary.org" : "en.wiktionary.org";
    if (url.protocol !== "https:" || url.hostname !== host ||
        !url.pathname.startsWith("/wiki/") || url.username || url.password) return null;
    return { word, partOfSpeech: originalPart, meanings: meanings as string[],
      url: url.href, provider:row.provenance.provider as NonNullable<PublicTurkishResult["source"]>["provider"] };
  } catch { return null; }
}

export async function readSharedTooltipGloss(db: Pick<SupabaseClient, "from">, input: string) {
  const word = dictionaryWord(input);
  const { data, error } = await db.from("atlas_lexicon_entries")
    .select("word_key,part_of_speech,status,content,provenance")
    .eq("word_key", word).eq("part_of_speech", "Tooltip")
    .eq("status", "machine_validated").limit(10);
  if (error) throw error;
  const rows = ((data ?? []) as GlossRow[]).map((row) => verifyShortGloss(row, word)).filter(Boolean);
  return rows.length === 1 ? rows[0] : null;
}

export function buildTooltipRecord(word: string, dictionary: PublicTurkishResult) {
  if (!["ready", "choices"].includes(dictionary.status) ||
      dictionary.entries.length < 1 || dictionary.entries.length > 8 ||
      dictionary.word !== word || dictionary.source?.license !== "CC BY-SA 4.0" ||
      !["FreeDictionaryAPI.com / Wiktionary","Wiktapi / Turkish Wiktionary"].includes(
        String(dictionary.source?.provider)) ||
      dictionary.source?.licenseUrl !== "https://creativecommons.org/licenses/by-sa/4.0/") return null;
  const source = dictionary.source;
  if (!source || dictionary.entries.some(e => !e.meanings.length || e.meanings.length > 8)) return null;
  const ambiguous = dictionary.entries.length > 1;
  // Retain each licensed POS label. Do not pretend an ambiguous token has one
  // context-verified translation (e.g. "approach" as verb vs noun).
  const glosses = ambiguous
    ? dictionary.entries.flatMap(entry =>
        entry.meanings.slice(0, 2).map(meaning => entry.partOfSpeech + ": " + meaning))
    : dictionary.entries[0].meanings;
  const meanings = glosses.filter(item => item.length > 0 && item.length <= 85).slice(0, 4);
  if (!meanings.length) return null;
  const sourceUrl = new URL(source.url);
  const host=source.provider==="Wiktapi / Turkish Wiktionary"
    ? "tr.wiktionary.org" : "en.wiktionary.org";
  if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== host ||
      sourceUrl.username || sourceUrl.password || !sourceUrl.pathname.startsWith("/wiki/")) return null;
  // Match PR #17's canonical short-gloss shape. A tooltip-only entry is NEVER a
  // verified five-example YDS entry; it must remain excluded from editorial use.
  const content = { kind: KIND, word, partOfSpeech: "Tooltip",
    originalPartOfSpeech: ambiguous ? "Multiple licensed senses" : dictionary.entries[0].partOfSpeech,
    meanings, alternatives: [],
    usageNote: "", cefr: "Belirtilmedi", examples: [] };
  const provenance = { kind: KIND, provider: source.provider, url: sourceUrl.href,
    license: source.license, licenseUrl: source.licenseUrl,
    validation: "dictionary_verified_not_context_certified" };
  return { word_key: word, part_of_speech: "Tooltip",
    sense_key: createHash("sha256").update(KIND + ":" + word).digest("hex"),
    revision: 1, status: "machine_validated" as const,
    content, provenance, digest: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
}

/**
 * Use ONLY the pre-existing, audited lease/publish RPC. If absent, abort and
 * leave the queue pending. Never directly insert or upsert a Lexicon row.
 */
export async function publishShortGloss(db: SupabaseClient, record: NonNullable<ReturnType<typeof buildTooltipRecord>>) {
  // PR #17 contract: claim and publish are separate, token-bound RPC operations.
  // The production read-only Lexicon migration contains NEITHER RPC nor their
  // job/revision dependencies. Never attempt a direct table-write fallback.
  const p_token = randomUUID();
  const identity = { p_word_key: record.word_key, p_pos: "Tooltip", p_sense_key: record.sense_key };
  const claim = await db.rpc("atlas_lexicon_claim_v1", { ...identity, p_token });
  if (claim.error) throw claim.error;
  if (claim.data !== true) return false; // Another worker owns the lease: retry later.
  try {
    const published = await db.rpc("atlas_lexicon_publish_v1", {
      ...identity, p_token, p_entry_word: record.word_key, p_entry_pos: "Tooltip",
      p_entry_sense: record.sense_key, p_content: record.content,
      p_provenance: record.provenance, p_digest: record.digest,
    });
    if (published.error) throw published.error;
    const row = Array.isArray(published.data) ? published.data[0] : published.data;
    if (!row || row.word_key !== record.word_key || row.part_of_speech !== "Tooltip" ||
        row.sense_key !== record.sense_key || row.status !== "machine_validated" ||
        row.content?.kind !== KIND || row.provenance?.kind !== KIND ||
        row.provenance?.license !== "CC BY-SA 4.0" || row.digest !== record.digest) {
      throw new Error("Lexicon audit ledger did not confirm short glossary publication");
    }
    return true;
  } finally {
    // PR #17 failure handling: release ONLY our own still-generating lease.
    // A successful publish is already marked ready, so this conditional update
    // must not undo it. Missing job/RPC infrastructure stays a HARD blocker.
    try {
      await db.from("atlas_lexicon_jobs")
        .update({ status: "failed", last_error_code: "GLOSS_PUBLISH_REJECTED",
          lease_token: null, lease_expires_at: null, updated_at: new Date().toISOString() })
        .eq("word_key", record.word_key).eq("part_of_speech", "Tooltip")
        .eq("sense_key", record.sense_key).eq("lease_token", p_token)
        .eq("status", "generating");
    } catch { /* Never hide the original publication result or failure. */ }
  }
}

export async function drainSentenceQueue(config: ServerConfig, options: {
  db?: SupabaseClient; dictionary?: typeof lookupPublicTurkish;
} = {}) {
  if (!sentencePrefetchEnabled(config) || active) return { disabled: true, processed: 0 };
  const batch = [...due].filter(([, when]) => when <= Date.now()).slice(0, 5);
  if (!batch.length) return { disabled: false, processed: 0 };
  active = true;
  let processed = 0;
  try {
    const db = options.db ?? quotaClient(config);
    for (const [word] of batch) {
      try {
        const { data: full, error: fullError } = await db.from("atlas_lexicon_entries")
          .select("part_of_speech,content")
          .eq("word_key", word).neq("part_of_speech", "Tooltip")
          .in("status", ["machine_validated", "human_reviewed"]).limit(30);
        if (fullError) throw fullError;
        const completed = (full ?? []).some((row: { content?: { examples?: unknown[] } }) => {
          const examples = row.content?.examples;
          if (!Array.isArray(examples) || examples.length !== 5) return false;
          const count = (difficulty: string) => examples.filter(
            (example) => typeof example === "object" && example !== null &&
              "difficulty" in example && example.difficulty === difficulty,
          ).length;
          return count("easy") === 2 && count("medium") === 1 && count("yds") === 2;
        });
        if (!completed && !(await readSharedTooltipGloss(db, word))) {
          const dictionary = await (options.dictionary ?? lookupPublicTurkish)(word, "atlas-tooltip-worker");
          const record = buildTooltipRecord(word, dictionary);
          if (record && !(await publishShortGloss(db, record))) {
            // An occupied lease is not success. Preserve the token in the bounded
            // retry queue instead of silently discarding an unpublished word.
            throw new Error("Lexicon publication lease busy; retry later");
          }
        }
        due.delete(word);
        processed++;
      } catch {
        // Source/DB failures cannot be interpreted as success. Retry later.
        due.set(word, Date.now() + 3600_000);
      }
    }
  } finally { active = false; }
  return { disabled: false, processed };
}

/** No scanning of personal historical rows. No process side effects when OFF. */
export function startSentencePrefetch(config: ServerConfig) {
  if (!sentencePrefetchEnabled(config)) return () => {};
  const timer = setInterval(() => { void drainSentenceQueue(config); }, 360_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
