import {
  lemmaCandidates,
  lexiconPreview,
  lexiconTerms,
  type WordInput,
  wordAttributionSchema,
} from "@yds-atlas/shared";
import type { ServerConfig } from "../../config/env";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";
import { quotaClient } from "../../shared/supabase";
import {
  canonicalQuery,
  type EntryRow,
  projectEntry,
  selectEntries,
  validEntry,
} from "./inspector-validation";

async function denyOnlineAssessment(ctx: RequestContext) {
  const { data, error } = await ctx.db.rpc("atlas_online_assessment_active");
  databaseError(error);
  if (typeof data !== "boolean")
    throw new HttpError(
      503,
      "Değerlendirme durumu doğrulanamadı.",
      "INSPECTOR_SESSION_UNAVAILABLE",
    );
  if (data)
    throw new HttpError(
      409,
      "Çevrimiçi değerlendirmede öğrenme yardımı kapalı.",
      "INSPECTOR_ACTIVE_ASSESSMENT",
    );
}
/** A server-side check is required: hiding the UI never authorizes an active assessment. */
export async function assertNoActiveAssessment(ctx: RequestContext) {
  await denyOnlineAssessment(ctx);
  const { data, error } = await ctx.db
    .from("learning_sessions")
    .select("id")
    .eq("user_id", ctx.userId)
    .is("completed_at", null)
    .or("snapshot->>discarded.is.null,snapshot->>discarded.neq.true")
    .limit(1);
  databaseError(error);
  if (!Array.isArray(data)) {
    throw new HttpError(503, "Oyun oturumu doğrulanamadı.", "INSPECTOR_SESSION_UNAVAILABLE");
  }
  if (data.length > 0) {
    throw new HttpError(
      409,
      "Devam eden çalışma tamamlanana veya iptal edilene kadar öğrenme yardımı kapalı.",
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
  await denyOnlineAssessment(ctx);
  const { data, error } = await ctx.db
    .from("learning_sessions")
    .select("snapshot")
    .eq("user_id", ctx.userId)
    .is("completed_at", null)
    .or("snapshot->>discarded.is.null,snapshot->>discarded.neq.true")
    .limit(20);
  databaseError(error);
  if (!Array.isArray(data) || data.length >= 20)
    throw new HttpError(503, "Oyun sözlük güvenliği doğrulanamadı.", "DICTIONARY_GAME_UNAVAILABLE");
  const candidates = lemmaCandidates(requested);
  for (const row of data) {
    const snapshot = row?.snapshot;
    if (!snapshot || !Array.isArray(snapshot.words))
      throw new HttpError(503, "Oyun sözlüğü doğrulanamadı.", "DICTIONARY_GAME_UNAVAILABLE");
    for (const item of snapshot.words) {
      if (!item || typeof item.word !== "string" || !Array.isArray(item.alternatives))
        throw new HttpError(503, "Oyun kelimesi doğrulanamadı.", "DICTIONARY_GAME_UNAVAILABLE");
      const forms = [item.word, ...item.alternatives];
      for (const value of forms) {
        if (typeof value !== "string" || !value.trim())
          throw new HttpError(503, "Oyun kelimesi doğrulanamadı.", "DICTIONARY_GAME_UNAVAILABLE");
        const token = value.normalize("NFKC").toLocaleLowerCase("en").trim();
        const protectedForms = [token, token + "s", token + "es", token + "ed", token + "ing"];
        if (token.endsWith("e")) protectedForms.push(token + "d", token.slice(0, -1) + "ing");
        if (token.endsWith("y")) protectedForms.push(token.slice(0, -1) + "ies");
        if (candidates.includes(token) || protectedForms.includes(requested))
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
  const params = new URLSearchParams(raw);
  const withAttribution =
    params.getAll("attribution").length === 1 && params.get("attribution") === "1";
  if (withAttribution) params.delete("attribution");
  const query = validateQuery(params);
  await assertNoActiveAssessment(ctx);
  const { data, error } = await quotaClient(config)
    .from("atlas_lexicon_entries")
    .select("id,word_key,part_of_speech,sense_key,revision,status,content,provenance")
    .eq("word_key", query.word)
    .neq("part_of_speech", "Tooltip")
    .in("status", ["machine_validated", "human_reviewed"])
    .limit(31);
  databaseError(error);
  if (
    !Array.isArray(data) ||
    data.length === 31 ||
    !data.every((row) => validEntry(row as EntryRow))
  ) {
    throw new HttpError(503, "Kelime havuzu sonucu doğrulanamadı.", "INSPECTOR_POOL_UNAVAILABLE");
  }
  const rows = data as EntryRow[];
  const result = selectEntries(rows, query);
  if (result.status !== "ready") return result;
  const selected = rows.find((row) => row.id === result.entry.id);
  if (!selected)
    throw new HttpError(503, "Kelime havuzu sonucu doğrulanamadı.", "INSPECTOR_POOL_UNAVAILABLE");
  const credit = licensedCredit(selected);
  if (!credit) return result;
  if (!withAttribution)
    throw new HttpError(
      409,
      "Lisanslı içeriği görmek için uygulamayı güncelle.",
      "ATTRIBUTION_CLIENT_REQUIRED",
    );
  return { ...result, entry: { ...result.entry, attribution: credit } };
}

function licensedCredit(row: EntryRow) {
  const p = row.provenance;
  if (!p?.license || p.license === "Atlas Original") return undefined;
  const credit = wordAttributionSchema.safeParse({
    license: p.license,
    source: p.source,
    author: p.attribution,
  });
  if (!credit.success)
    throw new HttpError(503, "Kaynak ve lisans doğrulanamadı.", "ATTRIBUTION_UNAVAILABLE");
  return credit.data;
}

/** Never trust a browser-selected pool revision when importing a word. */
export async function assertFeedbackWordBinding(
  config: ServerConfig,
  input: WordInput,
  isNew = false,
) {
  return assertFeedbackWordBindings(config, [input], isNew);
}

export async function assertFeedbackWordBindings(
  config: ServerConfig,
  inputs: WordInput[],
  isNew: boolean,
) {
  const bound = inputs.flatMap((input) =>
    input.lexicon ? [{ input, binding: input.lexicon }] : [],
  );
  if (!bound.length) return;
  requireFlag(config);
  if (isNew && bound.some(({ input }) => input.score !== 0)) {
    throw new HttpError(409, "Yeni kelime puanı sıfır olmalı.", "INSPECTOR_SCORE_TAMPERED");
  }
  const ids = [...new Set(bound.map(({ binding }) => binding.entryId))];
  const rows = new Map<string, EntryRow>();
  const db = quotaClient(config);
  // Bound both the PostgREST URL and the number of complete example sets per response.
  const batchSize = 40;
  for (let start = 0; start < ids.length; start += batchSize) {
    const batch = ids.slice(start, start + batchSize);
    const { data, error, count } = await db
      .from("atlas_lexicon_entries")
      .select("id,word_key,part_of_speech,sense_key,revision,status,content,provenance", {
        count: "exact",
      })
      .in("id", batch)
      .in("status", ["machine_validated", "human_reviewed"])
      .limit(batch.length);
    databaseError(error);
    if (!Array.isArray(data) || count !== data.length)
      throw new HttpError(503, "Sözlük kayıtları eksik okundu.", "LEXICON_INCOMPLETE");
    for (const row of data) rows.set(row.id, row as EntryRow);
  }
  for (const { input, binding } of bound) {
    const row = rows.get(binding.entryId);
    if (!row || row.revision !== binding.revision)
      throw new HttpError(409, "Kelime havuz kaydı güncellendi.", "INSPECTOR_REVISION_CONFLICT");
    verifyBoundContent(input, row);
  }
}

function verifyBoundContent(input: WordInput, row: EntryRow) {
  const credit = licensedCredit(row);
  if (credit) input.attribution = credit;
  else delete input.attribution;
  let expected: ReturnType<typeof projectEntry>;
  try {
    expected = projectEntry(row);
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

/** One bounded indexed read for a sentence. Never persist submitted words or glosses. */
export async function readLexiconPreview(
  ctx: RequestContext,
  config: ServerConfig,
  input: string[],
) {
  requireFlag(config);
  await assertNoActiveAssessment(ctx);
  const terms = lexiconTerms.parse(input);
  const keys = [...new Set(terms.flatMap(lemmaCandidates))];
  const { data, error, count } = await quotaClient(config)
    .from("atlas_lexicon_entries")
    .select(
      "id,word:word_key,partOfSpeech:part_of_speech,senseKey:sense_key,revision,meanings:content->meanings,ipaUk:content->>ipaUk,ipaUs:content->>ipaUs,audioUk:content->>pronunciationUk,audioUs:content->>pronunciationUs,license:provenance->>license,source:provenance->>source,author:provenance->>attribution",
      { count: "exact" },
    )
    .in("word_key", keys)
    .in("status", ["human_reviewed", "machine_validated"])
    .neq("part_of_speech", "Tooltip")
    .limit(512);
  databaseError(error);
  if (!data || data.length !== count)
    throw new HttpError(503, "Sözlük görünümü eksik.", "LEXICON_INCOMPLETE");
  return lexiconPreview.array().parse(
    data.map((row) => ({
      ...row,
      attribution:
        row.license === "CC BY-SA 4.0"
          ? { source: row.source, license: row.license, author: row.author }
          : null,
      audioUk: /^https:\/\//i.test(row.audioUk ?? "") ? row.audioUk : null,
      audioUs: /^https:\/\//i.test(row.audioUs ?? "") ? row.audioUs : null,
    })),
  );
}
