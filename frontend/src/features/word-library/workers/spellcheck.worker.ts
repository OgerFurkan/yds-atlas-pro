import nspell from "nspell";
import { normalizeWord } from "../model/word-normalization";

const dictionary = Promise.all(
  ["aff", "dic"].map(async (extension) => {
    const response = await fetch(`/dictionaries/en.${extension}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Yazım sözlüğü yüklenemedi.");
    return response.text();
  }),
).then(([aff, dic]) => nspell({ aff, dic }));

self.onmessage = async (event: MessageEvent<{ id: number; word: string }>) => {
  const { id, word } = event.data;
  try {
    const spelling = await dictionary;
    const normalized = normalizeWord(word);
    const tokens = normalized.split(/[\s-]+/).filter(Boolean);
    const isCorrect =
      tokens.length > 0 &&
      tokens.every((token) => spelling.correct(token) || spelling.correct(token.toLowerCase()));
    self.postMessage({
      id,
      result: {
        normalized,
        casingChanged: normalized !== word,
        isCorrect,
        suggestions:
          isCorrect || tokens.length !== 1
            ? []
            : [
                ...new Set(
                  spelling.suggest(normalized.toLowerCase()).slice(0, 5).map(normalizeWord),
                ),
              ],
      },
    });
  } catch {
    self.postMessage({ id, error: "Yazım denetimi yüklenemedi. Sayfayı yenileyip tekrar dene." });
  }
};
