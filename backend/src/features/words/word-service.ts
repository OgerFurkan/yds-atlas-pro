import {
  wordInputSchema,
  wordEntrySchema,
  type WordEntry,
  type WordInput,
  type WordGroup,
} from "@yds-atlas/shared";
import type { RequestContext } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
type WordRow = {
  id: string;
  word: string;
  score: number;
  manual_group?: WordGroup | null;
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
    // Never trust content.manualGroup: only the constrained DB column is authoritative.
    manualGroup: row.manual_group ?? null,
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
export async function saveWord(ctx: RequestContext, input: WordInput, id?: string) {
  const content = normalizeInput(input);
  // An old set can have an operator-owned, server-only historical backup.
  // The public WordInput schema deliberately strips unknown fields, so never trust
  // the browser to return or preserve this recovery copy when saving an edit.
  let legacyBackup: unknown;
  let expectedUpdatedAt: string | null = null;
  if (id) {
    const previous = await ctx.db.from("words").select("content,updated_at")
      .eq("id", id).eq("user_id", ctx.userId).maybeSingle();
    databaseError(previous.error);
    if (!previous.data) throw new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
    const value = (previous.data.content as Record<string, unknown> | null)?.legacyExamplesBackup;
    if (value !== undefined) {
      if (!Array.isArray(value) || value.length !== 5 || value.some(item =>
        !item || typeof item !== "object" || typeof item.sentence !== "string" ||
        typeof item.translation !== "string") || JSON.stringify(value).length > 64_000)
        throw new HttpError(409, "Eski cümle yedeği doğrulanamadı; veri değiştirilmedi.", "LEGACY_BACKUP_INVALID");
      legacyBackup = value;
      expectedUpdatedAt = previous.data.updated_at as string;
    }
  }
  const fields = {
    word: content.word,
    score: content.score,
    content: legacyBackup ? { ...content, legacyExamplesBackup: legacyBackup } : content,
    updated_at: new Date().toISOString(),
  };
  const update = id ? ctx.db.from("words").update(fields).eq("id", id).eq("user_id", ctx.userId) : null;
  const query = update
    ? expectedUpdatedAt ? update.eq("updated_at", expectedUpdatedAt) : update
    : ctx.db.from("words").insert({ ...fields, user_id: ctx.userId });
  const { data, error } = await query.select("*").maybeSingle();
  databaseError(error);
  if (!data) throw new HttpError(404, "Kelime bulunamadı.", "NOT_FOUND");
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
