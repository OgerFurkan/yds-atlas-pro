import { HttpError } from "../../shared/errors";
import { lookupTurkishWiktionaryGloss } from "./tr-wiktionary";
const ROOT = "https://freedictionaryapi.com";
const LICENSE = "https://creativecommons.org/licenses/by-sa/4.0/";
const cache = new Map<string, { expires: number; result: PublicTurkishResult }>();
const pending = new Map<string, Promise<PublicTurkishResult>>();
const userBudgets = new Map<string, { expires: number; count: number }>();
let sharedBudget = { expires: 0, count: 0 };
export type PublicTurkishResult = {
  status: "ready" | "choices" | "missing";
  word: string;
  entries: { partOfSpeech: string; meanings: string[] }[];
  source?: {
    provider: "FreeDictionaryAPI.com / Wiktionary" | "Wiktapi / Turkish Wiktionary";
    url: string;
    license: "CC BY-SA 4.0";
    licenseUrl: string;
  };
};
export function dictionaryWord(raw: string) {
  const word = raw.normalize("NFKC").toLocaleLowerCase("en").trim();
  if (word.length === 0 || word.length > 45 || !/^[a-z]+(?:[-'][a-z]+)?$/.test(word))
    throw new HttpError(
      400,
      "Geçerli tek bir İngilizce kelime gerekli.",
      "DICTIONARY_INVALID_WORD",
    );
  return word;
}
export function parsePublicTurkish(word: string, raw: unknown): PublicTurkishResult {
  const empty: PublicTurkishResult = { status: "missing", word, entries: [] };
  if (!raw || typeof raw !== "object") return empty;
  const body = raw as Record<string, any>;
  if (!Array.isArray(body.entries) || !body.entries.length) return empty;
  if (typeof body.word !== "string" || body.word.toLocaleLowerCase("en") !== word)
    throw new HttpError(502, "Sözlük kelime doğrulaması başarısız.", "DICTIONARY_WORD_MISMATCH");
  const origin = body.source;
  if (origin?.license?.name !== "CC BY-SA 4.0" || origin?.license?.url !== LICENSE)
    throw new HttpError(
      502,
      "Sözlük kaynağının lisansı doğrulanamadı.",
      "DICTIONARY_LICENSE_INVALID",
    );
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(origin.url);
  } catch {
    throw new HttpError(502, "Sözlük bağlantısı geçersiz.", "DICTIONARY_SOURCE_INVALID");
  }
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.hostname !== "en.wiktionary.org" ||
    sourceUrl.username ||
    sourceUrl.password ||
    !sourceUrl.pathname.startsWith("/wiki/")
  )
    throw new HttpError(502, "Sözlük kaynağı doğrulanamadı.", "DICTIONARY_SOURCE_INVALID");
  const rows = new Map<string, string[]>();
  for (const item of body.entries.slice(0, 60)) {
    if (item?.language?.code !== "en" || typeof item.partOfSpeech !== "string") continue;
    const pos = item.partOfSpeech.trim().toLocaleLowerCase("en").slice(0, 35);
    if (!/^[a-z -]+$/.test(pos)) continue;
    const meanings = rows.get(pos) ?? [];
    let seen = 0;
    const visit = (senses: unknown, depth: number): void => {
      if (!Array.isArray(senses) || depth > 2) return;
      for (const sense of senses.slice(0, 18)) {
        if (++seen > 45 || !sense || typeof sense !== "object") continue;
        for (const t of (Array.isArray(sense.translations) ? sense.translations : []).slice(
          0,
          30,
        )) {
          if (t?.language?.code !== "tr" || typeof t.word !== "string") continue;
          const meaning = t.word.normalize("NFKC").trim();
          if (!meaning || meaning.length > 85 || /[<>\u0000-\u001f]/u.test(meaning)) continue;
          if (!meanings.some((m) => m.toLocaleLowerCase("tr") === meaning.toLocaleLowerCase("tr")))
            meanings.push(meaning);
        }
        if (meanings.length < 8) visit(sense.subsenses, depth + 1);
      }
    };
    visit(item.senses, 0);
    if (meanings.length) rows.set(pos, meanings.slice(0, 8));
  }
  const entries = [...rows]
    .slice(0, 8)
    .map(([partOfSpeech, meanings]) => ({ partOfSpeech, meanings }));
  return {
    status: entries.length === 0 ? "missing" : entries.length === 1 ? "ready" : "choices",
    word,
    entries,
    source: {
      provider: "FreeDictionaryAPI.com / Wiktionary",
      url: sourceUrl.href,
      license: "CC BY-SA 4.0",
      licenseUrl: LICENSE,
    },
  };
}
/** Authenticated, bounded, cache-first GET. Browser token never forwarded to the provider. */
export async function lookupPublicTurkish(
  wordInput: string,
  userId: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicTurkishResult> {
  const word = dictionaryWord(wordInput),
    now = Date.now();
  const hit = cache.get(word);
  if (hit && hit.expires > now) return hit.result;
  const ongoing = pending.get(word);
  if (ongoing) return ongoing;
  if (sharedBudget.expires < now) sharedBudget = { expires: now + 3_600_000, count: 0 };
  if (sharedBudget.count >= 650)
    throw new HttpError(429, "Sözlük kullanım sınırı doldu.", "DICTIONARY_RATE_LIMIT");
  let budget = userBudgets.get(userId);
  if (!budget || budget.expires < now) budget = { expires: now + 3_600_000, count: 0 };
  // The backend-only worker has its own bounded allowance. Personal users keep
  // their existing 60/hour limit; the shared global 650/hour guard still applies.
  const hourlyLimit = userId === "atlas-tooltip-worker" ? 150 : 60;
  if (budget.count >= hourlyLimit)
    throw new HttpError(429, "Saatlik sözlük sınırına ulaşıldı.", "DICTIONARY_RATE_LIMIT");
  budget.count++;
  sharedBudget.count++;
  userBudgets.set(userId, budget);
  if (userBudgets.size > 1500)
    for (const [id, b] of userBudgets) if (b.expires < now) userBudgets.delete(id);
  const task = (async () => {
    // A transient failure of the primary must never be silently cached as a
    // definitive "missing" merely because the independent provider has no gloss.
    const alternateAfterFailure = async (rateLimited = false) => {
      const fallback = await lookupTurkishWiktionaryGloss(word, fetcher);
      if (fallback.status !== "missing") return fallback;
      throw rateLimited
        ? new HttpError(429, "Sözlük kullanım sınırına ulaşıldı.", "DICTIONARY_RATE_LIMIT")
        : new HttpError(
            503,
            "Sözlük kaynakları geçici olarak kullanılamıyor.",
            "DICTIONARY_UPSTREAM_ERROR",
          );
    };
    let resp: Response;
    try {
      resp = await fetcher(
        ROOT + "/api/v1/entries/en/" + encodeURIComponent(word) + "?translations=true",
        {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": "YDSAtlasPro/1.0" },
          signal: AbortSignal.timeout(6500),
        },
      );
    } catch {
      // The first public provider may time out while the independently licensed
      // Turkish Wiktionary edition remains healthy; keep the same rate guard.
      return alternateAfterFailure();
    }
    if (resp.status === 404) return lookupTurkishWiktionaryGloss(word, fetcher);
    if (resp.status === 429) return alternateAfterFailure(true);
    if ([500, 502, 503, 504].includes(resp.status)) return alternateAfterFailure();
    if (!resp.ok)
      throw new HttpError(
        503,
        "Sözlük sağlayıcısı şu anda yanıt veremiyor.",
        "DICTIONARY_UPSTREAM_ERROR",
      );
    if (Number(resp.headers.get("content-length")) > 1_000_000)
      throw new HttpError(502, "Sözlük yanıtı çok büyük.", "DICTIONARY_RESPONSE_TOO_LARGE");
    const txt = await resp.text();
    if (txt.length > 1_000_000)
      throw new HttpError(502, "Sözlük yanıtı çok büyük.", "DICTIONARY_RESPONSE_TOO_LARGE");
    let parsed: unknown;
    try {
      parsed = JSON.parse(txt);
    } catch {
      throw new HttpError(502, "Sözlük yanıtı geçersiz.", "DICTIONARY_INVALID_RESPONSE");
    }
    const primary = parsePublicTurkish(word, parsed);
    return primary.status === "missing" ? lookupTurkishWiktionaryGloss(word, fetcher) : primary;
  })();
  pending.set(word, task);
  try {
    const result = await task;
    if (cache.size >= 450) cache.delete(cache.keys().next().value!);
    cache.set(word, { expires: now + 3_600_000, result });
    return result;
  } finally {
    pending.delete(word);
  }
}
