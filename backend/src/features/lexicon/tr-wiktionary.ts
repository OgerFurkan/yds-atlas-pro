import { HttpError } from "../../shared/errors";
import type { PublicTurkishResult } from "./public-turkish-dictionary";
import { normalizeTurkishMeaning } from "./turkish-meaning";

// English headwords in the TURKISH Wiktionary edition: licensed Turkish glosses.
// Wiktapi indexes Kaikki/Wiktextract data; no API key, cookies or user data.
const BASE = "https://api.wiktapi.dev";
const LICENSE = "https://creativecommons.org/licenses/by-sa/4.0/";

export function parseTurkishWiktionaryGloss(word: string, input: unknown): PublicTurkishResult {
  if (!input || typeof input !== "object")
    throw new HttpError(502, "Türkçe sözlük yanıtı geçersiz.", "DICTIONARY_INVALID_RESPONSE");
  const raw = input as Record<string, unknown>;
  if (raw.edition !== "tr" || raw.word !== word || !Array.isArray(raw.entries))
    throw new HttpError(
      502,
      "Türkçe sözlük kelime doğrulaması başarısız.",
      "DICTIONARY_WORD_MISMATCH",
    );
  const rows = new Map<string, string[]>();
  for (const entry of raw.entries.slice(0, 24)) {
    // Wiktapi's ?lang=en endpoint may omit redundant language, word and POS
    // fields in its compact response. A PRESENT mismatch is never accepted.
    if (
      !entry ||
      typeof entry !== "object" ||
      (entry.lang_code !== undefined && entry.lang_code !== "en") ||
      (entry.word !== undefined && entry.word !== word) ||
      (entry.pos !== undefined && typeof entry.pos !== "string") ||
      !Array.isArray(entry.senses)
    )
      continue;
    // A missing POS is unknown, not an invented noun or verb.
    const pos = typeof entry.pos === "string" ? entry.pos.trim().toLocaleLowerCase("en") : "word";
    if (!/^[a-z -]{1,35}$/.test(pos)) continue;
    const meanings = rows.get(pos) ?? [];
    for (const sense of entry.senses.slice(0, 20)) {
      if (!sense || typeof sense !== "object" || !Array.isArray(sense.glosses)) continue;
      for (const value of sense.glosses.slice(0, 5)) {
        if (typeof value !== "string") continue;
        const meaning = normalizeTurkishMeaning(value);
        if (!meaning) continue;
        if (!meanings.some((x) => x.toLocaleLowerCase("tr") === meaning.toLocaleLowerCase("tr")))
          meanings.push(meaning);
        if (meanings.length === 8) break;
      }
      if (meanings.length === 8) break;
    }
    if (meanings.length) rows.set(pos, meanings);
    if (rows.size === 8) break;
  }
  if (!rows.size) return { status: "missing", word, entries: [] };
  return {
    status: rows.size > 1 ? "choices" : "ready",
    word,
    entries: [...rows].map(([partOfSpeech, meanings]) => ({ partOfSpeech, meanings })),
    source: {
      provider: "Wiktapi / Turkish Wiktionary",
      url: "https://tr.wiktionary.org/wiki/" + encodeURIComponent(word),
      license: "CC BY-SA 4.0",
      licenseUrl: LICENSE,
    },
  };
}

export async function lookupTurkishWiktionaryGloss(
  word: string,
  fetcher: typeof fetch,
): Promise<PublicTurkishResult> {
  let response: Response;
  try {
    response = await fetcher(BASE + "/v1/tr/word/" + encodeURIComponent(word) + "?lang=en", {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "YDSAtlasPro/1.0" },
      signal: AbortSignal.timeout(6500),
    });
  } catch {
    throw new HttpError(503, "Türkçe sözlüğe ulaşılamıyor.", "DICTIONARY_UPSTREAM_UNAVAILABLE");
  }
  if (response.status === 404) return { status: "missing", word, entries: [] };
  if (response.status === 429)
    throw new HttpError(429, "Türkçe sözlük kullanım sınırına ulaşıldı.", "DICTIONARY_RATE_LIMIT");
  if (!response.ok)
    throw new HttpError(503, "Türkçe sözlük şu anda yanıt veremiyor.", "DICTIONARY_UPSTREAM_ERROR");
  if (Number(response.headers.get("content-length")) > 1_000_000)
    throw new HttpError(502, "Sözlük yanıtı çok büyük.", "DICTIONARY_RESPONSE_TOO_LARGE");
  const body = await response.text();
  if (body.length > 1_000_000)
    throw new HttpError(502, "Sözlük yanıtı çok büyük.", "DICTIONARY_RESPONSE_TOO_LARGE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(502, "Türkçe sözlük JSON yanıtı geçersiz.", "DICTIONARY_INVALID_RESPONSE");
  }
  return parseTurkishWiktionaryGloss(word, parsed);
}
