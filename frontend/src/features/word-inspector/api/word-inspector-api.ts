import { z } from "zod";
import type { WordInput } from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";

/** Explicit user opt-in. Server independently enforces ATLAS_FEEDBACK_LEXICON_ENABLED. */
export const INSPECTOR_UI_ENABLED = import.meta.env.VITE_FEEDBACK_INSPECTOR_UI_ENABLED === "true";

const partOfSpeechSchema = z.enum([
  "Noun", "Verb", "Adjective", "Adverb", "Preposition", "Conjunction", "Pronoun", "Phrase",
]);
const statusSchema = z.enum(["machine_validated", "human_reviewed"]);
const difficultySchema = z.enum(["easy", "medium", "yds"]);
const baseSchema = z.object({
  id: z.uuid(),
  word: z.string().min(1).max(120),
  partOfSpeech: partOfSpeechSchema,
  meaning: z.string().min(1).max(200),
  revision: z.number().int().min(1),
  status: statusSchema,
}).strict();
const choiceSchema = baseSchema;
const exampleSchema = z.object({
  sentence: z.string().trim().min(1).max(2000),
  translation: z.string().trim().min(1).max(2000),
  difficulty: difficultySchema,
  translationFocus: z.array(z.string().trim().min(1)).min(1).max(4),
}).strict();
const detailSchema = baseSchema.extend({
  senseKey: z.string().min(1).max(128),
  meanings: z.array(z.string().min(1).max(200)).min(1).max(4),
  alternatives: z.array(z.string().max(120)).max(20),
  usageNote: z.string().max(2000),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "Belirtilmedi"]),
  examples: z.array(exampleSchema).length(5),
  pronunciationUk: z.string().max(200).nullable(),
  pronunciationUs: z.string().max(200).nullable(),
}).strict().superRefine((entry, context) => {
  const count = { easy: 0, medium: 0, yds: 0 };
  const seen = new Set<string>();
  for (const item of entry.examples) {
    count[item.difficulty]++;
    const key = item.sentence.toLocaleLowerCase("en");
    if (seen.has(key)) context.addIssue({ code: "custom", message: "Tekrarlanan örnek cümle." });
    seen.add(key);
    if (item.translationFocus.some((focus) => !item.translation.includes(focus)))
      context.addIssue({ code: "custom", message: "Örnek çeviri vurgusu geçersiz." });
  }
  if (count.easy !== 2 || count.medium !== 1 || count.yds !== 2)
    context.addIssue({ code: "custom", message: "Beş örneğin 2/1/2 sırası geçersiz." });
});
export const inspectorResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("missing"), word: z.string().min(1).max(120) }).strict(),
  z.object({ status: z.literal("choices"), word: z.string().min(1).max(120),
    choices: z.array(choiceSchema).min(2).max(30) }).strict(),
  z.object({ status: z.literal("ready"), word: z.string().min(1).max(120),
    entry: detailSchema }).strict(),
]);
export type InspectorResult = z.infer<typeof inspectorResponseSchema>;
export type InspectorEntry = Extract<InspectorResult, { status: "ready" }>["entry"];
export type InspectorChoice = Extract<InspectorResult, { status: "choices" }>["choices"][number];
export type InspectorQuery = { word: string; partOfSpeech?: string; meaning?: string };

/** Cache-only URL. Never call /api/lexicon/resolve, POST, Gemini or quota endpoints. */
export function inspectorPath(query: InspectorQuery) {
  const word = query.word.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
  if (word.length > 120 || !/^[a-z]+(?:[ '-][a-z]+)*$/.test(word))
    throw new Error("Geçerli bir İngilizce kelime veya ifade gir.");
  if (query.partOfSpeech !== undefined && !partOfSpeechSchema.safeParse(query.partOfSpeech).success)
    throw new Error("Kelime türü geçersiz.");
  if (query.meaning !== undefined && !query.partOfSpeech)
    throw new Error("Anlam seçimi için kelime türünü belirt.");
  const meaning = query.meaning?.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (meaning !== undefined && (meaning.length === 0 || meaning.length > 200))
    throw new Error("Anlam seçimi geçersiz.");
  const params = new URLSearchParams({ word });
  if (query.partOfSpeech) params.set("partOfSpeech", query.partOfSpeech);
  if (meaning !== undefined) params.set("meaning", meaning);
  return `/api/lexicon/inspect?${params.toString()}`;
}

export async function inspectFromPool(query: InspectorQuery, userId: string, signal?: AbortSignal) {
  if (!userId) throw new Error("Kelime incelemek için oturum aç.");
  return inspectorResponseSchema.parse(await apiRequest<unknown>(inspectorPath(query),
    { method: "GET", signal }, userId));
}

/** Explicit personal-library write only. No AI; never merge or overwrite an existing user word. */
export function inspectorToWordInput(entry: InspectorEntry): WordInput {
  return {
    word: entry.word,
    partOfSpeech: entry.partOfSpeech,
    meanings: [...entry.meanings],
    alternatives: [...entry.alternatives],
    usageNote: entry.usageNote,
    cefr: entry.cefr,
    score: 0,
    examples: entry.examples.map((item) => ({ ...item, translationFocus: [...item.translationFocus] })),
    pronunciationUk: entry.pronunciationUk ?? "",
    pronunciationUs: entry.pronunciationUs ?? "",
    sourceUrl: "",
    lexicon: { entryId: entry.id, revision: entry.revision, contractVersion: 1 },
  };
}

/** Open licensed Wiktionary fallback; no AI, quota or database mutations. */
export const openTurkishDictionarySchema=z.object({
 status:z.enum(["ready","choices","missing"]),word:z.string().min(1).max(45),
 entries:z.array(z.object({partOfSpeech:z.string().min(1).max(35),meanings:z.array(z.string().min(1).max(85)).min(1).max(8)}).strict()).max(8),
 source:z.object({provider:z.literal("FreeDictionaryAPI.com / Wiktionary"),url:z.string().url(),license:z.literal("CC BY-SA 4.0"),licenseUrl:z.literal("https://creativecommons.org/licenses/by-sa/4.0/")}).strict().optional(),
}).strict();
export type OpenTurkishDictionary=z.infer<typeof openTurkishDictionarySchema>;
export async function lookupOpenTurkishDictionary(word:string,userId:string,signal?:AbortSignal){
 const query=new URLSearchParams({word});
 return openTurkishDictionarySchema.parse(await apiRequest<unknown>("/api/dictionary/turkish?"+query.toString(),{method:"GET",signal},userId));
}