import type { WordInput } from "@yds-atlas/shared";
import { normalizeWord, parseWordList, wordKey } from "./word-normalization";

export type WordAddMode = "auto" | "manual";

/** A user's supplied Turkish meaning is authoritative personal input, not AI output. */
export function needsAiMeaning(input: WordInput): boolean {
  return !(input.meanings ?? []).some((meaning) => meaning.trim().length > 0);
}

export function splitWordInputsByMeaning(
  inputs: WordInput[], existing: readonly { word: string }[] = [],
) {
  const known = new Set(existing.map((entry) => wordKey(entry.word)));
  return {
    direct: inputs.filter((entry) => !needsAiMeaning(entry) || known.has(wordKey(entry.word))),
    needsAi: inputs.filter((entry) => needsAiMeaning(entry) && !known.has(wordKey(entry.word))),
  };
}

/**
 * Each line may be "hello = merhaba, selam" or simply "hello".
 * Legacy comma/semicolon-separated word-only lists remain supported.
 * No meaning, example, or YDS tier is ever invented.
 */
export function parseBulkWordEntries(text: string): WordInput[] {
  const entries = new Map<string, WordInput>();
  for (const row of text.split(/[\r\n;]+/)) {
    if (!row.trim()) continue;
    const equals = row.indexOf("=");
    const candidates: WordInput[] = equals >= 0
      ? [{
          word: normalizeWord(row.slice(0, equals)),
          meanings: row.slice(equals + 1).split(",").map((meaning) => meaning.trim()).filter(Boolean),
        }]
      : parseWordList(row).map((word) => ({ word }));
    for (const candidate of candidates) {
      if (!candidate.word) throw new Error("Eşittir işaretinden önce İngilizce kelime yaz.");
      if (candidate.word.length > 120) throw new Error("Bir kelime en fazla 120 karakter olabilir.");
      if ((candidate.meanings ?? []).some((meaning) => meaning.length > 200))
        throw new Error("Bir Türkçe anlam en fazla 200 karakter olabilir.");
      const key = wordKey(candidate.word);
      const original = entries.get(key);
      // A user-provided meaning wins over a bare duplicate, never the other way around.
      if (!original || (needsAiMeaning(original) && !needsAiMeaning(candidate)))
        entries.set(key, candidate);
      if (entries.size > 200)
        throw new Error("Bir seferde en fazla 200 kelime ekleyebilirsin.");
    }
  }
  return [...entries.values()];
}
