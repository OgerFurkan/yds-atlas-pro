import type { AiWordFailure } from "@yds-atlas/shared";
import {
  type AiWordListResponse,
  matchesRequestedSense,
  type RequestedWordSense,
  type WordInput,
  wordInputSchema,
} from "@yds-atlas/shared";
import { ApiError } from "@/shared/api/api-client";
import { escapeRegExp } from "@/shared/lib/regexp";
import { aiSuggestionToWordInput } from "../api/ai-word-api";
import { type AiRetryNotice, withAiRecovery } from "./ai-retry";
import { hasAtlasTiers } from "./tiered-examples";
import { wordKey } from "./word-normalization";

export const wordFailureReason: Record<AiWordFailure["reason"], string> = {
  schema: "AI yanıtının biçimi doğrulanamadı.",
  wrong_sense: "İstenen Türkçe anlam, kelime türü veya CEFR doğrulanamadı.",
  examples: "2 kolay, 1 orta ve 2 YDS örneği veya çevirileri doğrulanamadı.",
  rate_limit: "Sağlayıcı limitine ulaşıldı.",
  timeout: "Sağlayıcı yanıtı zaman aşımına uğradı.",
  network: "Sağlayıcıya bağlantı kurulamadı.",
  capacity: "Sağlayıcı geçici olarak yanıt veremedi.",
  provider: "Sağlayıcı kelimeyi tamamlayamadı. Yeniden dene.",
  blocked: "Sağlayıcı içerik denetimi üretimi durdurdu.",
  missing: "AI bu kelimeyi döndürmedi.",
};
export const errorReason = (error: unknown) =>
  error instanceof Error ? error.message : "Kelime tamamlanamadı.";

export type WordFillProgress = {
  /** Words already returned by Gemini. */
  completed: number;
  /** Words that actually need AI completion, not the whole submitted list. */
  total: number;
  /** Requests are sent in groups of this size. */
  batchSize: number;
  /** Names of missing AI-generated words. */
  failedWords?: string[];
  failureReasons?: Record<string, string>;
  issue?: string;
  retry?: AiRetryNotice;
};

export async function prepareWordInputs(
  inputs: WordInput[],
  existing: { word: string }[],
  complete: (words: string[], senses: RequestedWordSense[]) => Promise<AiWordListResponse>,
  onProgress?: (progress: WordFillProgress) => void,
  lookup?: (input: WordInput) => Promise<WordInput | null>,
) {
  const known = new Set(existing.map((word) => wordKey(word.word)));
  const prepared = inputs.map((input) => wordInputSchema.parse(input));
  const byKey = new Map<string, (typeof prepared)[number]>();
  const missing = new Map<string, string>();
  for (const word of prepared) {
    const key = wordKey(word.word);
    const other = byKey.get(key);
    if (other?.meanings.length && word.meanings.length && !matchesRequestedSense(other, word))
      throw new Error("Aynı kelime için farklı anlamlar girildi. Tek bir anlam grubu seç.");
    if (other && (!word.meanings.length || other.meanings.length)) continue;
    byKey.set(key, word);
    const forms = [word.word, ...word.alternatives].map(escapeRegExp);
    const pattern = new RegExp(`(^|[^a-z])(${forms.join("|")})(?=$|[^a-z])`, "i");
    if (
      !known.has(key) &&
      (!word.meanings.length ||
        !word.partOfSpeech ||
        word.cefr === "Belirtilmedi" ||
        !word.usageNote ||
        !hasAtlasTiers(word.examples) ||
        word.examples.some((example) => !pattern.test(example.sentence)))
    )
      missing.set(key, word.word);
  }
  const names = [...missing.values()];
  const batchSize = 5;
  const results = new Map<string, ReturnType<typeof aiSuggestionToWordInput>>();
  if (names.length) onProgress?.({ completed: 0, total: names.length, batchSize });
  let firstFailure: unknown;
  const reasons: Record<string, string> = Object.create(null);
  const mark = (word: string, reason: string) => {
    reasons[word] = reason;
  };
  for (let index = 0; index < names.length; index += batchSize) {
    const group: string[] = [];
    for (const name of names.slice(index, index + batchSize)) {
      const original = byKey.get(wordKey(name));
      if (!original) continue;
      try {
        const cached = await lookup?.(original);
        if (
          cached?.cefr &&
          cached.cefr !== "Belirtilmedi" &&
          cached.usageNote?.trim() &&
          cached.partOfSpeech?.trim() &&
          cached.meanings?.length &&
          hasAtlasTiers(cached.examples ?? []) &&
          matchesRequestedSense(original, cached)
        ) {
          results.set(wordKey(name), wordInputSchema.parse(cached));
        } else group.push(name);
      } catch (error) {
        firstFailure ??= error;
        mark(name, errorReason(error));
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          [401, 403, 409].includes(Number(error.status))
        )
          throw error;
      }
    }
    if (!group.length) {
      onProgress?.({ completed: results.size, total: names.length, batchSize });
      continue;
    }
    const senses = group
      .flatMap((name) => {
        const entry = byKey.get(wordKey(name));
        return entry && (entry.meanings.length || entry.partOfSpeech) ? [entry] : [];
      })
      .map(({ word, meanings, partOfSpeech }) => ({
        word,
        meanings,
        partOfSpeech: partOfSpeech || undefined,
      }));
    let response: AiWordListResponse;
    try {
      // The server validates each entry and retries missing headwords once.
      response = await withAiRecovery(
        () => complete(group, senses),
        (retry) => onProgress?.({ completed: results.size, total: names.length, batchSize, retry }),
      );
    } catch (error) {
      firstFailure ??= error;
      const listed = error instanceof ApiError ? error.wordFailures : undefined;
      for (const name of group) {
        const reason = listed?.find((failure) => wordKey(name) === wordKey(failure.word))?.reason;
        mark(name, reason ? wordFailureReason[reason] : errorReason(error));
      }
      // A malformed Gemini response for one five-word group must not prevent
      // independently validated later groups from being saved. These failed
      // words stay absent from the returned safe subset and can be retried.
      // Quota, network, auth and timeout failures still stop immediately.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "AI_INVALID_RESPONSE"
      ) {
        onProgress?.({
          completed: results.size,
          total: names.length,
          batchSize,
          failedWords: names
            .slice(0, index + group.length)
            .filter((name) => !results.has(wordKey(name))),
        });
        continue;
      }
      for (const name of names.slice(index + batchSize))
        mark(name, "Önceki istek durduğu için bu kelime gönderilmedi.");
      break;
    }
    for (const name of group) {
      const reason = response.failures?.find(
        (failure) => wordKey(name) === wordKey(failure.word),
      )?.reason;
      mark(name, wordFailureReason[reason ?? "missing"]);
    }
    const sources = new Map(
      (response.dictionarySources ?? []).map((source) => [wordKey(source.word), source]),
    );
    const expected = new Set(group.map(wordKey));
    for (const suggestion of response.suggestions) {
      const key = wordKey(suggestion.word);
      // A response containing a foreign/duplicate word must never overwrite
      // user data or add the word to the current study batch.
      if (!expected.delete(key)) continue;
      const original = byKey.get(key);
      const name = missing.get(key);
      if (!original || !name) continue;
      if (!matchesRequestedSense(original, suggestion) || suggestion.cefr === "Belirtilmedi") {
        mark(name, wordFailureReason.wrong_sense);
        continue;
      }
      try {
        results.set(key, aiSuggestionToWordInput(suggestion, response.model, sources.get(key)));
      } catch {
        mark(name, wordFailureReason.examples);
      }
    }
    onProgress?.({
      completed: results.size,
      total: names.length,
      batchSize,
      ...(names.slice(0, index + group.length).some((name) => !results.has(wordKey(name)))
        ? {
            failedWords: names
              .slice(0, index + group.length)
              .filter((name) => !results.has(wordKey(name))),
          }
        : {}),
    });
  }

  const failedWords = names.filter((name) => !results.has(wordKey(name)));
  if (failedWords.length) {
    onProgress?.({
      completed: results.size,
      total: names.length,
      batchSize,
      failedWords,
      failureReasons: reasons,
      issue:
        firstFailure instanceof Error ? firstFailure.message : "İçerik veya anlam doğrulanamadı.",
    });
  }
  // Keep already-complete entries and the AI-validated subset. Never persist
  // an incomplete new word merely because Gemini could not enrich it.
  const safePrepared = [...byKey.values()].filter((input) => {
    const key = wordKey(input.word);
    return !missing.has(key) || results.has(key);
  });
  if (!safePrepared.length && firstFailure) throw firstFailure;
  if (!safePrepared.length && missing.size)
    throw new Error("AI hiçbir kelimeyi güvenle tamamlayamadı. Tekrar dene.");

  return safePrepared.map((input) => {
    const generated = results.get(wordKey(input.word));
    if (!generated) return input;
    const meanings = input.meanings.length ? input.meanings : generated.meanings;
    const exactCanonical =
      generated.lexicon &&
      !input.examples.length &&
      JSON.stringify(meanings) === JSON.stringify(generated.meanings);
    return {
      ...input,
      lexicon: exactCanonical ? generated.lexicon : undefined,
      attribution: input.attribution ?? generated.attribution,
      pronunciationUk: input.pronunciationUk || generated.pronunciationUk,
      pronunciationUs: input.pronunciationUs || generated.pronunciationUs,
      sourceUrl: input.sourceUrl || generated.sourceUrl,
      meanings,
      usageNote: input.usageNote || generated.usageNote,
      partOfSpeech: input.partOfSpeech || generated.partOfSpeech,
      cefr: input.cefr === "Belirtilmedi" ? generated.cefr : input.cefr,
      alternatives: [...new Set([...input.alternatives, ...generated.alternatives])],
      // A newly added word gets one auditable, canonical 2/1/2 set. Existing user
      // entries are untouched (they bypass this preparation path).
      examples: [
        ...generated.examples,
        // Preserve the user's original examples; the first five form the canonical
        // ordered 2/1/2 set and hand-authored material remains available afterward.
        ...input.examples.filter(
          (example) =>
            !generated.examples.some((next) => JSON.stringify(next) === JSON.stringify(example)),
        ),
      ],
    };
  });
}
