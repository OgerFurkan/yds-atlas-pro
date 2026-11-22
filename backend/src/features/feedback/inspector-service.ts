import type { ServerConfig } from "../../config/env";
import type { RequestContext } from "../../shared/supabase";
import { quotaClient } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
import type { WordInput } from "@yds-atlas/shared";
import { canonicalQuery, projectEntry, selectEntries, type EntryRow } from "./inspector-validation";

/** A server-side check is required: hiding the UI never authorizes an active assessment. */
export async function assertNoActiveAssessment(ctx: RequestContext) {
  const { data, error } = await ctx.db
    .from("learning_sessions")
    .select("id")
    .eq("user_id", ctx.userId)
    .is("completed_at", null)
    .limit(1);
  databaseError(error);
  if (!Array.isArray(data)) {
    throw new HttpError(503, "Oyun oturumu doğrulanamadı.", "INSPECTOR_SESSION_UNAVAILABLE");
  }
  if (data.length > 0) {
    throw new HttpError(
      409,
      "Devam eden oyun tamamlanmadan kelime inceleme kapalı.",
      "INSPECTOR_ACTIVE_ASSESSMENT",
    );
  }
}

/**
 * A cloze may expose unrelated vocabulary, but never any word assigned to an
 * unfinished assessment. Only this account's sessions are queried through RLS.
 * Malformed snapshots and unavailable sessions fail closed.
 */
export async function assertGameSafeDictionaryWord(ctx: RequestContext, requested: string) {
  const { data, error } = await ctx.db
    .from("learning_sessions")
    .select("snapshot")
    .eq("user_id", ctx.userId)
    .is("completed_at", null)
    .limit(20);
  databaseError(error);
  if (!Array.isArray(data) || data.length >= 20)
    throw new HttpError(503, "Oyun sözlük güvenliği doğrulanamadı.", "DICTIONARY_GAME_UNAVAILABLE");
  for (const row of data) {
    const snapshot = row?.snapshot;
    if (!snapshot || !Array.isArray(snapshot.words))
      throw new HttpError(503, "Oyun sözlüğü doğrulanamadı.", "DICTIONARY_GAME_UNAVAILABLE");
    for (const item of snapshot.words) {
      if (!item || typeof item.word !== "string" || !Array.isArray(item.alternatives))
        throw new HttpError(503, "Oyun kelimesi doğrulanamadı.", "DICTIONARY_GAME_UNAVAILABLE");
      const forms = [item.word, ...item.alternatives];
      for (const value of forms) {
        if (typeof value !== "string") continue;
        const token = value.normalize("NFKC").toLocaleLowerCase("en").trim();
        const protectedForms = [token, token + "s", token + "es", token + "ed", token + "ing"];
        if (token.endsWith("e")) protectedForms.push(token + "d", token.slice(0, -1) + "ing");
        if (token.endsWith("y")) protectedForms.push(token.slice(0, -1) + "ies");
        if (protectedForms.includes(requested))
          throw new HttpError(
            409,
            "Çalışılan kelimenin anlamı soru sırasında kapalı.",
            "DICTIONARY_ANSWER_PROTECTED",
          );
      }
    }
  }
}

function requireFlag(config: ServerConfig) {
  if (!config.ATLAS_FEEDBACK_LEXICON_ENABLED) {
    throw new HttpError(404, "Word Inspector etkin değil.", "INSPECTOR_DISABLED");
  }
}

function validateQuery(raw: URLSearchParams) {
  if (
    [...raw.keys()].some((key) => !["word", "partOfSpeech", "meaning"].includes(key)) ||
    ["word", "partOfSpeech", "meaning"].some((key) => raw.getAll(key).length > 1)
  ) {
    throw new HttpError(400, "Kelime araması geçersiz.", "INSPECTOR_INVALID_QUERY");
  }
  try {
    return canonicalQuery({
      word: raw.get("word") ?? "",
      partOfSpeech: raw.get("partOfSpeech") ?? undefined,
      meaning: raw.get("meaning") ?? undefined,
    });
  } catch {
    throw new HttpError(400, "Kelime veya anlam geçersiz.", "INSPECTOR_INVALID_QUERY");
  }
}

/** Read-only pool lookup; no Gemini, external dictionary, lease, quota or DB writes. */
export async function inspectFeedback(
  ctx: RequestContext,
  config: ServerConfig,
  raw: URLSearchParams,
) {
  requireFlag(config);
  const query = validateQuery(raw);
  await assertNoActiveAssessment(ctx);
  const { data, error } = await quotaClient(config)
    .from("atlas_lexicon_entries")
    .select("id,word_key,part_of_speech,sense_key,revision,status,content")
    .eq("word_key", query.word)
    .neq("part_of_speech", "Tooltip")
    .in("status", ["machine_validated", "human_reviewed"])
    .limit(31);
  databaseError(error);
  if (!Array.isArray(data) || data.length === 31) {
    throw new HttpError(503, "Kelime havuzu sonucu doğrulanamadı.", "INSPECTOR_POOL_UNAVAILABLE");
  }
  return selectEntries(data as EntryRow[], query);
}

/** Never trust a browser-selected pool revision when importing a word. */
export async function assertFeedbackWordBinding(
  config: ServerConfig,
  input: WordInput,
  isNew = false,
) {
  if (!input.lexicon) return;
  requireFlag(config);
  if (isNew && input.score !== 0) {
    throw new HttpError(409, "Yeni kelime puanı sıfır olmalı.", "INSPECTOR_SCORE_TAMPERED");
  }
  const { data, error } = await quotaClient(config)
    .from("atlas_lexicon_entries")
    .select("id,word_key,part_of_speech,sense_key,revision,status,content")
    .eq("id", input.lexicon.entryId)
    .eq("revision", input.lexicon.revision)
    .in("status", ["machine_validated", "human_reviewed"])
    .maybeSingle();
  databaseError(error);
  if (!data) {
    throw new HttpError(409, "Kelime havuz kaydı güncellendi.", "INSPECTOR_REVISION_CONFLICT");
  }
  let expected: ReturnType<typeof projectEntry>;
  try {
    expected = projectEntry(data as EntryRow);
  } catch {
    throw new HttpError(409, "Kelime havuz kaydı geçersiz.", "INSPECTOR_BINDING_INVALID");
  }
  // The rest of the user's word remains under the existing user-owned words table and RLS.
  const text = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en");
  const matching =
    text(input.word) === text(expected.word) &&
    input.partOfSpeech === expected.partOfSpeech &&
    JSON.stringify(input.meanings) === JSON.stringify(expected.meanings) &&
    JSON.stringify(
      (input.examples ?? []).map((example) => ({
        sentence: example.sentence,
        translation: example.translation,
        difficulty: example.difficulty,
        translationFocus: example.translationFocus,
      })),
    ) ===
      JSON.stringify(
        expected.examples.map((example) => ({
          sentence: example.sentence,
          translation: example.translation,
          difficulty: example.difficulty,
          translationFocus: example.translationFocus,
        })),
      );
  if (!matching) {
    throw new HttpError(
      409,
      "Seçilen anlam ve örnekler havuzla eşleşmiyor.",
      "INSPECTOR_BINDING_INVALID",
    );
  }
}
