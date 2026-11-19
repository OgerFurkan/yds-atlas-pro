import { hasCompleteTierSet } from "@yds-atlas/shared";
import type { ServerConfig } from "../../config/env";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";
import { quotaClient } from "../../shared/supabase";
import { validateLexicalCandidate } from "./lexicon-content-validator";
import { lexicalIdentity } from "./lexicon-identity";
import type { LexiconEntry, LexiconStore } from "./lexicon-resolver";
import { lexiconStore } from "./lexicon-store";

/** Explicit read action only; never called by hover or an active assessment. */
export type InspectorQuery = { word: string; partOfSpeech?: string; meaning?: string };
type InspectorStore = Pick<LexiconStore, "findCandidates">;
const VALID_POS = new Set(["Noun", "Verb", "Adjective", "Adverb", "Preposition", "Conjunction", "Pronoun", "Phrase"]);
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ");

export function validateInspectorQuery(query: InspectorQuery) {
  const word = normalize(query.word).toLocaleLowerCase("en");
  if (word.length > 120 || !/^[a-z]+(?:[ '-][a-z]+)*$/.test(word)) {
    throw new HttpError(400, "Geçerli bir İngilizce kelime gerekli.", "INSPECTOR_INVALID_WORD");
  }
  const partOfSpeech = query.partOfSpeech;
  if (partOfSpeech !== undefined && !VALID_POS.has(partOfSpeech)) {
    throw new HttpError(400, "Kelime türü geçersiz.", "INSPECTOR_INVALID_POS");
  }
  const meaning = query.meaning === undefined ? undefined : normalize(query.meaning);
  if (meaning !== undefined && (!partOfSpeech || meaning.length < 1 || meaning.length > 200)) {
    throw new HttpError(400, "Anlam seçimi için kelime türü gerekli.", "INSPECTOR_INVALID_SENSE");
  }
  return { word, partOfSpeech, meaning };
}

/** A canonical entry is usable only with matching POS/sense and complete 2/1/2 examples. */
function eligible(entry: LexiconEntry): boolean {
  if (!entry || (entry.status !== "machine_validated" && entry.status !== "human_reviewed") ||
    !entry.content || !Number.isSafeInteger(entry.revision) || entry.revision < 1 ||
    !hasCompleteTierSet(entry.content.examples)) return false;
  try {
    const content = entry.content;
    const expected = lexicalIdentity(content.word, content.partOfSpeech, content.meanings?.[0] ?? "");
    if (expected.wordKey !== entry.wordKey || expected.partOfSpeech !== entry.partOfSpeech ||
        expected.senseKey !== entry.senseKey) return false;
    validateLexicalCandidate(content);
    return true;
  } catch { return false; }
}

/** Never return provenance, admin review ledger, service-role metadata or raw DB rows. */
function choice(entry: LexiconEntry) {
  return { id: entry.id, word: entry.wordKey, partOfSpeech: entry.partOfSpeech,
    meaning: entry.content.meanings[0] ?? "", revision: entry.revision,
    status: entry.status };
}
function publicDetail(entry: LexiconEntry) {
  const c = entry.content;
  return { ...choice(entry), senseKey: entry.senseKey,
    meanings: [...c.meanings], alternatives: [...c.alternatives],
    usageNote: c.usageNote, cefr: c.cefr,
    examples: c.examples.map(x => ({ sentence: x.sentence, translation: x.translation,
      difficulty: x.difficulty, translationFocus: [...(x.translationFocus ?? [])] })),
    pronunciationUk: c.pronunciationUk ?? null,
    pronunciationUs: c.pronunciationUs ?? null };
}

/** Cache-only. No claim/publish/fail RPC; no Gemini; no AI quota consumption. */
export async function inspectCachedLexicon(query: InspectorQuery, store: InspectorStore) {
  const input = validateInspectorQuery(query);
  const rows = await store.findCandidates(input.word);
  const entries = rows.filter(eligible).filter(entry =>
    (!input.partOfSpeech || input.partOfSpeech === entry.partOfSpeech) &&
    (!input.meaning || lexicalIdentity(input.word, entry.partOfSpeech, input.meaning).senseKey === entry.senseKey));
  if (!entries.length) return { status: "missing" as const, word: input.word };
  if (entries.length > 1) return { status: "choices" as const, word: input.word,
    choices: entries.map(choice) };
  return { status: "ready" as const, word: input.word, entry: publicDetail(entries[0]) };
}

/** Elevated client remains backend-only; invoked after createApp authenticates user and feature gate. */
export async function inspectTieredLexicon(config: ServerConfig, query: InspectorQuery) {
  const valid = validateInspectorQuery(query); // Reject invalid data BEFORE privileged client creation.
  return inspectCachedLexicon(valid, lexiconStore(quotaClient(config)));
}

/** Refuse Inspector while any unfinished cloud game exists for this authenticated user. */
export async function rejectInspectorDuringSavedAssessment(ctx: RequestContext): Promise<void> {
  const result = await ctx.db.from("learning_sessions").select("id")
    .eq("user_id", ctx.userId).is("completed_at", null).limit(1);
  databaseError(result.error);
  if (!Array.isArray(result.data))
    throw new HttpError(503, "Oturum durumu doğrulanamadı.", "INSPECTOR_SESSION_UNAVAILABLE");
  if (result.data.length > 0)
    throw new HttpError(409, "Aktif öğrenme oturumunu tamamladıktan sonra kelimeyi inceleyebilirsin.",
      "INSPECTOR_ACTIVE_ASSESSMENT");
}
