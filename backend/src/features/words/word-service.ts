import {
  mergeWordEdit,
  type WordCursor,
  type WordEdit,
  type WordEntry,
  type WordInput,
  wordEntrySchema,
  wordInputSchema,
} from "@yds-atlas/shared";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";

type WordRow = {
  id: string;
  word: string;
  score: number;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
export function normalizeInput(input: WordInput) {
  const { score: _score, ...content } = wordInputSchema.parse(input);
  return { ...content, word: normalizeHeadword(content.word) };
}

function normalizeHeadword(value: string) {
  const word = value.replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
  return word.charAt(0).toLocaleUpperCase("en") + word.slice(1);
}

function wordVersionConflict() {
  return new HttpError(
    409,
    "Kelime başka bir sekmede veya oturumda değişti.",
    "WORD_VERSION_CONFLICT",
  );
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
const MAX_LIST_ROWS = 20_000;
const MAX_LIST_BYTES = 24 * 1024 * 1024;

function incompleteList() {
  return new HttpError(503, "Kelime listesi doğrulanamadı. Yeniden dene.", "INCOMPLETE_WORD_LIST");
}

export async function readWordPage({ db, userId }: RequestContext, cursor: WordCursor | null) {
  if (cursor && cursor.owner !== userId)
    throw new HttpError(403, "Kütüphane sahibi değişti.", "OWNER_CHANGED");
  const { data, error } = await db.rpc("atlas_word_page", {
    p_revision: cursor?.revision ?? null,
    p_time: cursor?.time ?? null,
    p_id: cursor?.id ?? null,
  });
  if (error?.code === "40001")
    throw new HttpError(409, "Kütüphane değişti. Yeniden dene.", "WORD_LIST_CHANGED");
  if (error?.code === "54000")
    throw new HttpError(413, "Tek kelime sayfa boyutunu aşıyor.", "WORD_PAGE_LIMIT");
  databaseError(error);
  if (
    !data ||
    data.owner !== userId ||
    typeof data.revision !== "string" ||
    !/^\d+$/.test(data.revision) ||
    (cursor
      ? data.revision !== cursor.revision || data.total !== null
      : !Number.isSafeInteger(data.total) || data.total < 0) ||
    !Array.isArray(data.rows) ||
    data.rows.length > 128
  )
    throw incompleteList();
  const words: WordEntry[] = [];
  let next = cursor;
  for (const row of data.rows as WordRow[]) {
    if (!row) throw incompleteList();
    const word = mapWord(row);
    if (
      next &&
      (rawTime(row.updated_at) > rawTime(next.time) ||
        (rawTime(row.updated_at) === rawTime(next.time) && row.id <= next.id))
    )
      throw incompleteList();
    words.push(word);
    next = { owner: userId, revision: data.revision, time: row.updated_at, id: row.id };
  }
  return {
    owner: userId,
    revision: data.revision as string,
    total: data.total as number | null,
    words,
    cursor: words.length ? next : null,
  };
}
async function pagedWords(ctx: RequestContext) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let cursor: WordCursor | null = null;
    let total = 0,
      bytes = 0;
    const words: WordEntry[] = [];
    const ids = new Set<string>();
    try {
      do {
        const page = await readWordPage(ctx, cursor);
        if (!cursor) {
          if (page.total === null) throw incompleteList();
          total = page.total;
        }
        if (total > MAX_LIST_ROWS) throw listLimit();
        bytes += new TextEncoder().encode(JSON.stringify(page.words)).length;
        if (bytes > MAX_LIST_BYTES) throw listLimit();
        for (const word of page.words) {
          if (ids.has(word.id)) throw incompleteList();
          ids.add(word.id);
          words.push(word);
        }
        if (words.length === total) return words;
        if (words.length > total || !page.words.length) throw incompleteList();
        cursor = page.cursor;
      } while (cursor);
      throw incompleteList();
    } catch (error) {
      if (attempt || !(error instanceof HttpError) || error.code !== "WORD_LIST_CHANGED")
        throw error;
    }
  }
  throw incompleteList();
}
function rawTime(time: string) {
  const micros = (time.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
  return BigInt(Date.parse(time)) * 1000n + BigInt(micros.slice(3, 6) || 0);
}
function listLimit() {
  return new HttpError(413, "Kütüphane bu istemcinin liste sınırını aşıyor.", "WORD_LIST_LIMIT");
}
export async function listWords(ctx: RequestContext) {
  const { db } = ctx;
  // One PostgREST statement. A configured row cap is an incomplete response.
  const { data, error, count } = await db
    .from("words")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .order("id")
    .limit(1000);
  databaseError(error);
  if (Array.isArray(data) && data.length === 1000 && count !== null && count > 1000)
    return pagedWords(ctx);
  if (!Array.isArray(data) || data.length !== count) {
    const received =
      Array.isArray(data) && Number.isSafeInteger(count) ? ` (${data.length}/${count})` : "";
    throw new HttpError(
      503,
      `Kelime listesi eksik geldi${received}. Yeniden dene.`,
      "INCOMPLETE_WORD_LIST",
    );
  }
  if (
    count > MAX_LIST_ROWS ||
    new TextEncoder().encode(JSON.stringify(data)).length > MAX_LIST_BYTES
  )
    throw listLimit();
  const words = data.map(mapWord);
  if (new Set(words.map((word) => word.id)).size !== count)
    throw new HttpError(409, "Kelime listesi doğrulanamadı.", "WORD_LIST_CHANGED");
  return words;
}
/**
 * Existing records can be written with an optional optimistic concurrency guard.
 * The guard reads the exact PostgreSQL timestamp, then conditions the UPDATE on
 * that raw value and observed score/word. This uses the current schema and
 * avoids rounding away PostgreSQL microseconds in public WordEntry timestamps.
 */
export async function saveWord(
  ctx: RequestContext,
  input: WordInput,
  id?: string,
  expectedUpdatedAt?: string,
) {
  if (expectedUpdatedAt && !id)
    throw new HttpError(400, "Sürüm kontrolü için kelime kimliği gerekli.", "INVALID_WORD_VERSION");
  const content = normalizeInput(input);
  let observed: WordRow | null = null;
  if (id) {
    const existing = await ctx.db.from("words").select("*").eq("id", id).maybeSingle();
    databaseError(existing.error);
    const row: WordRow | null = existing.data;
    if (!row) throw new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
    observed = row;
    // WordEntry exposes millisecond ISO timestamps; the database retains full
    // microsecond precision, which is used unchanged in the atomic UPDATE.
    if (expectedUpdatedAt && new Date(observed.updated_at).toISOString() !== expectedUpdatedAt)
      throw wordVersionConflict();
  }
  const nextContent = observed ? mergeWordEdit(observed.content, content) : content;
  if (content.lexicon) nextContent.lexicon = content.lexicon;
  const fields = {
    word: content.word,
    content: nextContent,
  };
  const response = id
    ? await (expectedUpdatedAt && observed
        ? ctx.db
            .from("words")
            .update(fields)
            .eq("id", id)
            .eq("updated_at", observed.updated_at)
            .eq("score", observed.score)
            .eq("word", observed.word)
        : ctx.db.from("words").update(fields).eq("id", id)
      )
        .select("*")
        .maybeSingle()
    : await ctx.db
        .from("words")
        .insert({ ...fields, user_id: ctx.userId })
        .select("*")
        .maybeSingle();
  const { data, error } = response;
  databaseError(error);
  if (!data)
    throw expectedUpdatedAt
      ? new HttpError(409, "Kelime eşzamanlı olarak değişti. Önce yenile.", "WORD_VERSION_CONFLICT")
      : new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
  return mapWord(data);
}
export async function editWord(
  { db }: RequestContext,
  id: string,
  patch: WordEdit,
  expectedUpdatedAt: string,
) {
  const existing = await db.from("words").select("*").eq("id", id).maybeSingle();
  databaseError(existing.error);
  const current: WordRow | null = existing.data;
  if (!current) throw new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
  if (new Date(current.updated_at).toISOString() !== expectedUpdatedAt) throw wordVersionConflict();
  const normalized =
    patch.word === undefined ? patch : { ...patch, word: normalizeHeadword(patch.word) };
  const { data, error } = await db
    .from("words")
    .update({
      ...(normalized.word === undefined ? {} : { word: normalized.word }),
      content: mergeWordEdit(current.content, normalized),
    })
    .eq("id", id)
    .eq("updated_at", current.updated_at)
    .eq("score", current.score)
    .eq("word", current.word)
    .select("*")
    .maybeSingle();
  databaseError(error);
  if (!data) throw wordVersionConflict();
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
