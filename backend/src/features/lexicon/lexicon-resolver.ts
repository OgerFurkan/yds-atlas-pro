import { randomUUID } from "node:crypto";
import { hasCompleteTierSet, canonicalExampleOrder, type LeveledExample } from "@yds-atlas/shared";
import { lexicalIdentity, type LexicalIdentity } from "./lexicon-identity";
import { validateLexicalCandidate } from "./lexicon-content-validator";

export type LexicalContent = {
  word: string;
  partOfSpeech: string;
  meanings: string[];
  alternatives: string[];
  usageNote: string;
  cefr: string;
  examples: LeveledExample[];
  pronunciationUk?: string;
  pronunciationUs?: string;
  sourceUrl?: string;
  lexicon?: {entryId:string;revision:number;contractVersion:1};
};

export type LexiconEntry = LexicalIdentity & {
  id: string;
  revision: number;
  status: "machine_validated" | "human_reviewed" | "quarantined";
  content: LexicalContent;
  provenance: Record<string, unknown>;
};

export type ResolveWordRequest = { word: string; partOfSpeech?: string; meaning?: string };
export type LexiconResponse = {
  source: "pool" | "generated";
  entry: LexiconEntry;
};
export type Lease = { wordKey: string; partOfSpeech: string; senseKey: string; token: string };

export interface LexiconStore {
  findCandidates(wordKey: string): Promise<LexiconEntry[]>;
  claim(lease: Lease): Promise<boolean>;
  publish(lease: Lease, identity: LexicalIdentity, content: LexicalContent,
    provenance: Record<string, unknown>): Promise<LexiconEntry | null>;
  fail(lease: Lease, code: string): Promise<void>;
}

/** Quota must be consumed only by the lease owner on a real cache miss. */
export type Generator = (input: ResolveWordRequest) => Promise<{
  content: LexicalContent;
  provenance: Record<string, unknown>;
}>;

export class LexiconProblem extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "LexiconProblem";
  }
}

const normalizedWord = (x: string) => x.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const normalizedSense = (x: string) => x.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");
const validPartOfSpeech = new Set(["Noun","Verb","Adjective","Adverb","Preposition","Conjunction","Pronoun","Phrase"]);
function usable(entry: LexiconEntry): boolean {
  if ((entry.status !== "machine_validated" && entry.status !== "human_reviewed") ||
      !hasCompleteTierSet(entry.content.examples)) return false;
  try {
    const identity = lexicalIdentity(entry.content.word, entry.content.partOfSpeech,
      entry.content.meanings?.[0] ?? "");
    return identity.wordKey === entry.wordKey &&
      identity.partOfSpeech === entry.partOfSpeech && identity.senseKey === entry.senseKey;
  } catch { return false; }
}

/**
 * Strict cache-first resolve. No arbitrary homograph/sense matching.
 * An atomic backend-only lease prevents duplicated Gemini generations.
 * Store.publish must reject expired/fake tokens and never overwrite a newer version.
 */
export async function resolveLexiconWord(
  input: ResolveWordRequest,
  store: LexiconStore,
  generate: Generator,
  consumeQuota: () => Promise<boolean>,
): Promise<LexiconResponse> {
  const wordKey = normalizedWord(input.word);
  if (!/^[a-z]+(?:[ '-][a-z]+)*$/.test(wordKey) || wordKey.length > 120)
    throw new LexiconProblem("INVALID_WORD", 400, "Geçerli İngilizce kelime veya ifade gerekli.");
  if (input.partOfSpeech && !validPartOfSpeech.has(input.partOfSpeech))
    throw new LexiconProblem("INVALID_POS", 400, "Kelime türü geçersiz.");
  if (input.meaning && !input.partOfSpeech)
    throw new LexiconProblem("POS_REQUIRED", 400, "Anlam seçimi için kelime türü de belirtilmeli.");

  const identity = input.partOfSpeech && input.meaning
    ? lexicalIdentity(input.word, input.partOfSpeech, input.meaning) : undefined;
  const candidates = (await store.findCandidates(wordKey)).filter(usable).filter(entry =>
    (!input.partOfSpeech || entry.partOfSpeech === input.partOfSpeech) &&
    (!identity || entry.senseKey === identity.senseKey)
  );
  if (candidates.length > 1)
    throw new LexiconProblem("LEXICON_AMBIGUOUS", 409, "Birden fazla anlam var. Kelime türü ve anlamını seç.");
  if (candidates.length === 1) return {source:"pool",entry:candidates[0]};

  const lease: Lease = {
    wordKey,
    partOfSpeech: identity?.partOfSpeech ?? input.partOfSpeech ?? "Unspecified",
    senseKey: identity?.senseKey ?? "unresolved",
    token: randomUUID(),
  };
  const acquired = await store.claim(lease);
  if (!acquired) {
    // A different process owns generation. Recheck once; never spend AI quota.
    const existing = (await store.findCandidates(wordKey)).filter(usable).filter(entry =>
      (!input.partOfSpeech || entry.partOfSpeech === input.partOfSpeech) &&
      (!identity || entry.senseKey === identity.senseKey));
    if (existing.length === 1) return {source:"pool",entry:existing[0]};
    if (existing.length > 1)
      throw new LexiconProblem("LEXICON_AMBIGUOUS", 409, "Kelime anlamı seçilmeli.");
    throw new LexiconProblem("LEXICON_GENERATING", 503, "İçerik oluşturuluyor; kısa süre sonra tekrar dene.");
  }

  let failedCode = "LEXICON_GENERATION_FAILED";
  try {
    // Cache may have been populated by a request using a different lease key.
    const afterClaim = (await store.findCandidates(wordKey)).filter(usable).filter(entry =>
      (!input.partOfSpeech || entry.partOfSpeech === input.partOfSpeech) &&
      (!identity || entry.senseKey === identity.senseKey));
    if (afterClaim.length === 1) return {source:"pool",entry:afterClaim[0]};
    if (afterClaim.length > 1)
      throw new LexiconProblem("LEXICON_AMBIGUOUS", 409, "Kelime anlamı seçilmeli.");
    if (!(await consumeQuota())) {
      failedCode="AI_QUOTA_EXCEEDED";
      throw new LexiconProblem("AI_QUOTA_EXCEEDED", 429, "AI kullanım sınırına ulaşıldı.");
    }
    const generated = await generate(input);
    const content = generated.content;
    const contentIdentity = lexicalIdentity(content.word, content.partOfSpeech, content.meanings[0] ?? "");
    if (contentIdentity.wordKey !== wordKey ||
      (input.partOfSpeech && contentIdentity.partOfSpeech !== input.partOfSpeech) ||
      (input.meaning && normalizedSense(content.meanings[0] ?? "") !== normalizedSense(input.meaning))) {
      failedCode="LEXICON_WRONG_SENSE";
      throw new LexiconProblem("LEXICON_WRONG_SENSE", 502, "Yapay zekâ istenen kelime türü veya anlamı üretmedi.");
    }
    validateLexicalCandidate(content);
    const stored = await store.publish(lease, contentIdentity, {
      ...content,
      examples: canonicalExampleOrder(content.examples),
    }, generated.provenance);
    if (!stored || !usable(stored)) {
      failedCode="LEXICON_PUBLISH_REJECTED";
      throw new LexiconProblem("LEXICON_PUBLISH_REJECTED", 503, "İçeriğin havuza kaydı doğrulanamadı.");
    }
    return {source:"generated",entry:stored};
  } catch (error) {
    failedCode=error instanceof LexiconProblem?error.code:failedCode;
    throw error;
  } finally {
    // Must be token-conditional; cannot release or overwrite another process' lease.
    await store.fail(lease, failedCode).catch(()=>undefined);
  }
}
