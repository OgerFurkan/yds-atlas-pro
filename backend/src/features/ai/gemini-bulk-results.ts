import {
  type AiWordListResponse,
  aiWordSchema,
  matchesRequestedSense,
  type RequestedWordSense,
} from "@yds-atlas/shared";
import { z } from "zod";
import { HttpError } from "../../shared/errors";
import { containsHeadword, validExamples } from "./gemini-example-validation";

export const keyOf = (word: string) => word.trim().toLocaleLowerCase("en");

export function createBulkResults({
  count,
  exclude,
  requested,
  senses,
}: {
  count: number;
  exclude: string[];
  requested?: string[];
  senses: RequestedWordSense[];
}) {
  const excluded = new Set(exclude.map(keyOf));
  const expected = requested ? new Set(requested.map(keyOf)) : undefined;
  const accepted = new Map<string, AiWordListResponse["suggestions"][number]>();
  const failuresByWord = new Map<string, "schema" | "wrong_sense" | "examples">();
  // Integer counters only. Never log headwords, translations, prompts or Gemini bodies.
  const rejected = {
    schema: 0,
    headword_format: 0,
    excluded: 0,
    duplicate: 0,
    unexpected: 0,
    wrong_sense: 0,
    invalid_tiers: 0,
    missing_headword_in_example: 0,
    invalid_translation_focus: 0,
    repeated_example: 0,
    invalid_example: 0,
    incomplete_response: 0,
    malformed_envelope: 0,
  };
  const classifyExamples = (item: z.infer<typeof aiWordSchema>) => {
    const tiers = ["easy", "easy", "medium", "yds", "yds"];
    if (
      item.examples.some(
        (example, index) => example.difficulty !== undefined && example.difficulty !== tiers[index],
      )
    )
      return "invalid_tiers" as const;
    if (
      item.examples.some(
        (example) => !containsHeadword(example.sentence, [item.word, ...item.alternatives]),
      )
    )
      return "missing_headword_in_example" as const;
    if (
      item.examples.some((example) =>
        example.translationFocus.some((part) => !example.translation.includes(part)),
      )
    )
      return "invalid_translation_focus" as const;
    if (
      new Set(item.examples.map((example) => example.sentence.trim().toLocaleLowerCase("en")))
        .size !== item.examples.length
    )
      return "repeated_example" as const;
    return "invalid_example" as const;
  };

  function accept(proposed: unknown[]) {
    for (const value of proposed) {
      if (accepted.size >= count) break;
      const parsed = aiWordSchema.safeParse(value);
      if (!parsed.success) {
        rejected.schema++;
        const headword = z.object({ word: z.string() }).safeParse(value);
        if (headword.success) {
          const key = keyOf(headword.data.word);
          if (expected?.has(key) && !failuresByWord.has(key)) failuresByWord.set(key, "schema");
        }
        continue;
      }
      const suggestion = parsed.data;
      const key = keyOf(suggestion.word);
      if (!/^[a-z]+(?:[ '-][a-z]+)*$/i.test(suggestion.word)) {
        rejected.headword_format++;
        continue;
      }
      if (excluded.has(key)) {
        rejected.excluded++;
        continue;
      }
      if (accepted.has(key)) {
        rejected.duplicate++;
        continue;
      }
      if (expected && !expected.has(key)) {
        rejected.unexpected++;
        continue;
      }
      const sense = senses.find((item) => keyOf(item.word) === key);
      if (
        suggestion.cefr === "Belirtilmedi" ||
        (sense && !matchesRequestedSense(sense, suggestion))
      ) {
        rejected.wrong_sense++;
        failuresByWord.set(key, "wrong_sense");
        continue;
      }
      if (!validExamples(suggestion)) {
        rejected[classifyExamples(suggestion)]++;
        failuresByWord.set(key, "examples");
        continue;
      }
      accepted.set(key, suggestion);
    }
  }
  function finish(providerFailure: unknown, contentBlocked: boolean) {
    const providerReasons: Partial<
      Record<string, NonNullable<AiWordListResponse["failures"]>[number]["reason"]>
    > = {
      AI_QUOTA_EXCEEDED: "rate_limit",
      AI_TIMEOUT: "timeout",
      AI_NETWORK_ERROR: "network",
      AI_UPSTREAM_ERROR: "capacity",
    };
    const providerReason =
      providerFailure instanceof HttpError
        ? (providerReasons[providerFailure.code] ?? "provider")
        : "provider";
    const failures: NonNullable<AiWordListResponse["failures"]> = (requested ?? [])
      .filter((word) => !accepted.has(keyOf(word)))
      .map((word) => ({
        word,
        reason:
          failuresByWord.get(keyOf(word)) ??
          (contentBlocked
            ? "blocked"
            : providerFailure
              ? providerReason
              : rejected.incomplete_response || rejected.malformed_envelope
                ? "schema"
                : "missing"),
      }));
    if (!accepted.size) {
      // Preserve existing invalid-response behavior when no usable word exists.
      throw new HttpError(
        502,
        contentBlocked
          ? "Sağlayıcı liste üretimini içerik denetimi nedeniyle durdurdu."
          : rejected.wrong_sense
            ? "Türkçe anlam, kelime türü veya CEFR doğrulanamadı. Anlamı gözden geçir."
            : rejected.unexpected || rejected.headword_format
              ? "AI istenen kelimeyi döndürmedi."
              : rejected.malformed_envelope || rejected.incomplete_response
                ? "AI liste yanıtı eksik veya JSON biçimi geçersiz."
                : "AI içeriği için gerekli alanlar, 2/1/2 örnekler veya çeviriler doğrulanamadı.",
        "AI_INVALID_RESPONSE",
        undefined,
        failures,
      );
    }
    const suggestions = requested
      ? requested.flatMap((word) => {
          const suggestion = accepted.get(keyOf(word));
          return suggestion ? [suggestion] : [];
        })
      : [...accepted.values()];
    return { suggestions, failures };
  }
  return { accepted, rejected, accept, finish };
}
