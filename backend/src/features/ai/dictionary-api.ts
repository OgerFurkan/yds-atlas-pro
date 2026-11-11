import type { DictionarySource } from "@yds-atlas/shared";
import { z } from "zod";

const dictionaryResponseSchema = z.array(
  z.object({
    word: z.string().optional(),
    sourceUrls: z.array(z.string().url()).optional(),
    license: z.object({ name: z.string().optional(), url: z.string().url().optional() }).optional(),
    meanings: z
      .array(
        z.object({
          definitions: z
            .array(
              z.object({
                definition: z.string().optional(),
                example: z.string().optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  }),
);

export async function lookupDictionaryWord(
  word: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<DictionarySource | undefined> {
  let response: Response;
  try {
    response = await fetcher(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
      {
        headers: { Accept: "application/json", "User-Agent": "YDSAtlasPro/1.0" },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
  if (!response.ok) return undefined;

  try {
    const entries = dictionaryResponseSchema.parse(await response.json());
    const entry = entries.find((candidate) => candidate.word?.toLowerCase() === word.toLowerCase());
    const licenseUrl = entry?.license?.url;
    const sourceUrl = entry?.sourceUrls?.find((url) => {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "en.wiktionary.org";
    });
    const licenseMatch = licenseUrl
      ? new URL(licenseUrl).origin === "https://creativecommons.org"
        ? new URL(licenseUrl).pathname.match(/^\/licenses\/by-sa\/(3\.0|4\.0)\/?$/i)
        : null
      : null;
    if (!entry || !sourceUrl || !licenseUrl || !licenseMatch) return undefined;

    const definitions = [
      ...new Set(
        entry.meanings?.flatMap(
          (meaning) =>
            meaning.definitions
              ?.map((definition) => definition.definition?.trim())
              .filter(Boolean) ?? [],
        ) ?? [],
      ),
    ].slice(0, 3) as string[];
    const examples = [
      ...new Set(
        entry.meanings?.flatMap(
          (meaning) =>
            meaning.definitions
              ?.map((definition) => definition.example?.trim())
              .filter((example): example is string => Boolean(example)) ?? [],
        ) ?? [],
      ),
    ]
      .filter((sentence) => {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return (
          sentence.length <= 1000 &&
          new RegExp(`(^|[^a-z])${escaped}(?=$|[^a-z])`, "i").test(sentence)
        );
      })
      .slice(0, 2);

    return {
      word,
      provider: "DictionaryAPI.dev",
      sourceUrl,
      licenseName: `CC BY-SA ${licenseMatch[1]}`,
      licenseUrl,
      definitions,
      examples: examples.map((sentence) => ({ sentence })),
    };
  } catch {
    return undefined;
  }
}
