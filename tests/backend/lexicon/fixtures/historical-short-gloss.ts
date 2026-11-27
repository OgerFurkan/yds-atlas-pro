import { createHash, randomUUID } from "node:crypto";
import type { quotaClient } from "../../../../backend/src/shared/supabase";

type SupabaseClient = ReturnType<typeof quotaClient>;

import {
  dictionaryWord,
  type PublicTurkishResult,
} from "../../../../backend/src/features/lexicon/public-turkish-dictionary";

// Historical publisher contract for migration compatibility. Only synthetic tests use this helper.
const KIND = "atlas_tooltip_gloss_v1";

type GlossRow = {
  word_key: string;
  part_of_speech: string;
  status: string;
  content: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

function verifyShortGloss(row: GlossRow, word: string) {
  if (
    row.word_key !== word ||
    row.part_of_speech !== "Tooltip" ||
    row.status !== "machine_validated" ||
    row.content?.kind !== KIND ||
    row.provenance?.kind !== KIND ||
    row.provenance?.license !== "CC BY-SA 4.0" ||
    !["FreeDictionaryAPI.com / Wiktionary", "Wiktapi / Turkish Wiktionary"].includes(
      String(row.provenance?.provider),
    )
  )
    return null;
  const meanings = row.content.meanings;
  const originalPart = row.content.originalPartOfSpeech;
  if (
    !Array.isArray(meanings) ||
    meanings.length < 1 ||
    meanings.length > 4 ||
    !meanings.every(
      (value) => typeof value === "string" && value.length > 0 && value.length <= 85,
    ) ||
    typeof originalPart !== "string" ||
    originalPart.length > 35
  )
    return null;
  try {
    const url = new URL(String(row.provenance.url));
    const host =
      row.provenance.provider === "Wiktapi / Turkish Wiktionary"
        ? "tr.wiktionary.org"
        : "en.wiktionary.org";
    if (
      url.protocol !== "https:" ||
      url.hostname !== host ||
      !url.pathname.startsWith("/wiki/") ||
      url.username ||
      url.password
    )
      return null;
    return {
      word,
      partOfSpeech: originalPart,
      meanings: meanings as string[],
      url: url.href,
      provider: row.provenance.provider as NonNullable<PublicTurkishResult["source"]>["provider"],
    };
  } catch {
    return null;
  }
}

export async function readSharedTooltipGloss(db: Pick<SupabaseClient, "from">, input: string) {
  const word = dictionaryWord(input);
  const { data, error } = await db
    .from("atlas_lexicon_entries")
    .select("word_key,part_of_speech,status,content,provenance")
    .eq("word_key", word)
    .eq("part_of_speech", "Tooltip")
    .eq("status", "machine_validated")
    .limit(10);
  if (error) throw error;
  const rows = ((data ?? []) as GlossRow[])
    .map((row) => verifyShortGloss(row, word))
    .filter(Boolean);
  return rows.length === 1 ? rows[0] : null;
}

export function buildTooltipRecord(word: string, dictionary: PublicTurkishResult) {
  if (
    !["ready", "choices"].includes(dictionary.status) ||
    dictionary.entries.length < 1 ||
    dictionary.entries.length > 8 ||
    dictionary.word !== word ||
    dictionary.source?.license !== "CC BY-SA 4.0" ||
    !["FreeDictionaryAPI.com / Wiktionary", "Wiktapi / Turkish Wiktionary"].includes(
      String(dictionary.source?.provider),
    ) ||
    dictionary.source?.licenseUrl !== "https://creativecommons.org/licenses/by-sa/4.0/"
  )
    return null;
  const source = dictionary.source;
  if (!source || dictionary.entries.some((e) => !e.meanings.length || e.meanings.length > 8))
    return null;
  const ambiguous = dictionary.entries.length > 1;
  // Retain each licensed POS label. Do not pretend an ambiguous token has one
  // context-verified translation (e.g. "approach" as verb vs noun).
  const glosses = ambiguous
    ? dictionary.entries.flatMap((entry) =>
        entry.meanings.slice(0, 2).map((meaning) => entry.partOfSpeech + ": " + meaning),
      )
    : dictionary.entries[0].meanings;
  const meanings = glosses.filter((item) => item.length > 0 && item.length <= 85).slice(0, 4);
  if (!meanings.length) return null;
  const sourceUrl = new URL(source.url);
  const host =
    source.provider === "Wiktapi / Turkish Wiktionary" ? "tr.wiktionary.org" : "en.wiktionary.org";
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.hostname !== host ||
    sourceUrl.username ||
    sourceUrl.password ||
    !sourceUrl.pathname.startsWith("/wiki/")
  )
    return null;
  // Match PR #17's canonical short-gloss shape. A tooltip-only entry is NEVER a
  // verified five-example YDS entry; it must remain excluded from editorial use.
  const content = {
    kind: KIND,
    word,
    partOfSpeech: "Tooltip",
    originalPartOfSpeech: ambiguous
      ? "Multiple licensed senses"
      : dictionary.entries[0].partOfSpeech,
    meanings,
    alternatives: [],
    usageNote: "",
    cefr: "Belirtilmedi",
    examples: [],
  };
  const provenance = {
    kind: KIND,
    provider: source.provider,
    url: sourceUrl.href,
    license: source.license,
    licenseUrl: source.licenseUrl,
    validation: "dictionary_verified_not_context_certified",
  };
  return {
    word_key: word,
    part_of_speech: "Tooltip",
    sense_key: createHash("sha256")
      .update(KIND + ":" + word)
      .digest("hex"),
    revision: 1,
    status: "machine_validated" as const,
    content,
    provenance,
    digest: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  };
}

/**
 * Use ONLY the pre-existing, audited lease/publish RPC. If absent, abort and
 * leave the queue pending. Never directly insert or upsert a Lexicon row.
 */
export async function publishShortGloss(
  db: SupabaseClient,
  record: NonNullable<ReturnType<typeof buildTooltipRecord>>,
) {
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
      ...identity,
      p_token,
      p_entry_word: record.word_key,
      p_entry_pos: "Tooltip",
      p_entry_sense: record.sense_key,
      p_content: record.content,
      p_provenance: record.provenance,
      p_digest: record.digest,
    });
    if (published.error) throw published.error;
    const row = Array.isArray(published.data) ? published.data[0] : published.data;
    if (
      !row ||
      row.word_key !== record.word_key ||
      row.part_of_speech !== "Tooltip" ||
      row.sense_key !== record.sense_key ||
      row.status !== "machine_validated" ||
      row.content?.kind !== KIND ||
      row.provenance?.kind !== KIND ||
      row.provenance?.license !== "CC BY-SA 4.0" ||
      row.digest !== record.digest
    ) {
      throw new Error("Lexicon audit ledger did not confirm short glossary publication");
    }
    return true;
  } finally {
    // PR #17 failure handling: release ONLY our own still-generating lease.
    // A successful publish is already marked ready, so this conditional update
    // must not undo it. Missing job/RPC infrastructure stays a HARD blocker.
    try {
      await db
        .from("atlas_lexicon_jobs")
        .update({
          status: "failed",
          last_error_code: "GLOSS_PUBLISH_REJECTED",
          lease_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("word_key", record.word_key)
        .eq("part_of_speech", "Tooltip")
        .eq("sense_key", record.sense_key)
        .eq("lease_token", p_token)
        .eq("status", "generating");
    } catch {
      /* Never hide the original publication result or failure. */
    }
  }
}
