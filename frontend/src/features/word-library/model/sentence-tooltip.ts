/** Read-only public vocabulary projection: canonical library and Inspector/Admin shapes differ. */
export type TooltipVocabulary = {
  word: string;
  meanings: string[];
  partOfSpeech: string;
  alternatives?: readonly string[];
  senses?: ReadonlyArray<{ meanings: readonly string[] }>;
  cefr?: string | null;
  pronunciationUk?: string | null;
  pronunciationUs?: string | null;
};

export type SentencePiece = { text: string; kind: "word" | "separator"; offset: number };
export type VocabularyIndex = Map<string, TooltipVocabulary[]>;

const TOKEN = /[A-Za-z]+(?:[’'][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const ENGLISH_COMMON = new Set([
  "a", "an", "the", "in", "on", "at", "of", "to", "for", "from", "with", "and", "or", "but",
  "is", "are", "was", "were", "be", "been", "have", "has", "had", "will", "would", "could", "should",
  "that", "this", "these", "those", "they", "their", "there", "we", "our", "you", "your", "it", "its",
  "not", "by", "as", "if", "when", "because", "which", "who", "what", "can", "may", "must", "than",
]);

export function splitSentenceWords(text: string): SentencePiece[] {
  const parts: SentencePiece[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index;
    if (at > last) parts.push({ text: text.slice(last, at), kind: "separator", offset: last });
    parts.push({ text: match[0], kind: "word", offset: at });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: "separator", offset: last });
  return parts;
}

export function normalizeTooltipWord(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[’‘]/g, "'").trim();
}

export function buildVocabularyIndex(words: readonly TooltipVocabulary[]): VocabularyIndex {
  const index: VocabularyIndex = new Map();
  for (const word of words) {
    for (const form of [word.word, ...(word.alternatives ?? [])]) {
      const key = normalizeTooltipWord(form);
      if (!key) continue;
      const existing = index.get(key) ?? [];
      if (!existing.includes(word)) index.set(key, [...existing, word]);
    }
  }
  return index;
}

/** Try only conservative inflections that actually exist in the user library. */
export function matchVocabulary(token: string, index: VocabularyIndex): TooltipVocabulary[] {
  const value = normalizeTooltipWord(token);
  if (index.has(value)) return index.get(value) ?? [];
  if (value.length < 5 || !/^[a-z]+$/.test(value)) return [];
  const candidates: string[] = [];
  if (value.endsWith("ies")) candidates.push(value.slice(0, -3) + "y");
  if (value.endsWith("ing")) {
    const stem = value.slice(0, -3);
    candidates.push(stem, stem + "e");
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) candidates.push(stem.slice(0, -1));
  }
  if (value.endsWith("ed")) candidates.push(value.slice(0, -2), value.slice(0, -1));
  if (value.endsWith("es")) candidates.push(value.slice(0, -2));
  if (value.endsWith("s")) candidates.push(value.slice(0, -1));
  const matches = [...new Set(candidates)].flatMap((candidate) => index.get(candidate) ?? []);
  return [...new Set(matches)];
}

export function isLikelyEnglishSentence(value: string): boolean {
  if (/[ğüşöçıİĞÜŞÖÇ]/u.test(value)) return false;
  const words = splitSentenceWords(value).filter((part) => part.kind === "word");
  if (words.length < 3) return false;
  return words.some((part) => ENGLISH_COMMON.has(normalizeTooltipWord(part.text)));
}

/** Preserve punctuation/line breaks while opting into chat tooltips only for English sentences. */
export function splitChatSentenceSegments(text: string): Array<{ text: string; english: boolean }> {
  const pieces = text.match(/[^.!?\n]+[.!?]?|\n/g) ?? [text];
  return pieces.map((part) => ({ text: part, english: isLikelyEnglishSentence(part) }));
}

export function tooltipMeanings(word: TooltipVocabulary): string[] {
  return [...new Set([...(word.meanings ?? []), ...(word.senses ?? []).flatMap((sense) => sense.meanings)])]
    .filter(Boolean).slice(0, 4);
}