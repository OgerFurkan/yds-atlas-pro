import {
  wordInputSchema,
  wordEntrySchema,
  type WordEntry,
  type WordInput,
} from "@yds-atlas/shared";
import type { RequestContext } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
type WordRow = {
  id: string;
  word: string;
  score: number;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
export function normalizeInput(input: WordInput) {
  const parsed = wordInputSchema.parse(input);
  const word = parsed.word.replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
  return { ...parsed, word: word.charAt(0).toLocaleUpperCase("en") + word.slice(1) };
}
export function mapWord(row: WordRow): WordEntry {
  return wordEntrySchema.parse({
    ...row.content,
    id: row.id,
    word: row.word,
    score: row.score,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}
export async function listWords({ db }: RequestContext) {
  const words: WordEntry[] = [];
  // Explicit pages avoid Supabase's default 1000-row truncation.
  for (let start = 0; ; start += 500) {
    const { data, error } = await db
      .from("words")
      .select("*")
      .order("updated_at", { ascending: false })
      .order("id")
      .range(start, start + 499);
    databaseError(error);
    words.push(...(data ?? []).map(mapWord));
    if ((data?.length ?? 0) < 500) return words;
  }
}
/**
 * Existing records can be written with an optional optimistic concurrency guard.
 * The guard reads the exact PostgreSQL timestamp, then conditions the UPDATE on
 * that raw value and observed score/word. This uses the current schema and
 * avoids rounding away PostgreSQL microseconds in public WordEntry timestamps.
 */
export async function saveWord(
  ctx: RequestContext, input: WordInput, id?: string, expectedUpdatedAt?: string,
) {
  if (expectedUpdatedAt && !id)
    throw new HttpError(400, "Sürüm kontrolü için kelime kimliği gerekli.", "INVALID_WORD_VERSION");
  const content = normalizeInput(input);
  let observed: { updated_at: string; score: number; word: string } | null = null;
  if (id) {
    const existing = await ctx.db
      .from("words").select("updated_at,score,word").eq("id", id).maybeSingle();
    databaseError(existing.error);
    if (!existing.data) throw new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
    observed = existing.data;
    // WordEntry exposes millisecond ISO timestamps; the database retains full
    // microsecond precision, which is used unchanged in the atomic UPDATE.
    if (expectedUpdatedAt && new Date(observed.updated_at).toISOString() !== expectedUpdatedAt)
      throw new HttpError(409, "Kelime başka bir oturumda değişti. Önce yenile.", "WORD_VERSION_CONFLICT");
  }
  const updatedAt = observed
    ? new Date(Math.max(Date.now(), Date.parse(observed.updated_at) + 1)).toISOString()
    : new Date().toISOString();
  const fields = {
    word: content.word,
    score: content.score,
    content,
    updated_at: updatedAt,
  };
  const response = id
    ? await (expectedUpdatedAt && observed
      ? ctx.db.from("words").update(fields).eq("id", id)
          .eq("updated_at", observed.updated_at).eq("score", observed.score)
          .eq("word", observed.word)
      : ctx.db.from("words").update(fields).eq("id", id)
      ).select("*").maybeSingle()
    : await ctx.db.from("words").insert({ ...fields, user_id: ctx.userId })
        .select("*").maybeSingle();
  const { data, error } = response;
  databaseError(error);
  if (!data) throw expectedUpdatedAt
    ? new HttpError(409, "Kelime eşzamanlı olarak değişti. Önce yenile.", "WORD_VERSION_CONFLICT")
    : new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
  return mapWord(data);
}
export async function importWords(ctx: RequestContext, inputs: WordInput[]) {
  const { data, error } = await ctx.db.rpc("import_words", { p_words: inputs.map(normalizeInput) });
  databaseError(error);
  return data as { added: number; duplicates: number };
}
export async function deleteWords(ctx: RequestContext, ids: string[]) {
  const { error } = await ctx.db.from("words").delete().in("id", ids);
  databaseError(error);
  return { deleted: true };
}
