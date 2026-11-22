import { expect, test } from "bun:test";
import {
  parseTurkishWiktionaryGloss,
  lookupTurkishWiktionaryGloss,
} from "../src/features/lexicon/tr-wiktionary";
import { lookupPublicTurkish } from "../src/features/lexicon/public-turkish-dictionary";
import {
  buildTooltipRecord,
  readSharedTooltipGloss,
} from "../src/features/lexicon/sentence-lexicon-prefetch";

function turkish(word: string, entries: unknown[]) {
  return { edition: "tr", word, entries };
}
const nouns = (word: string, ...glosses: string[]) => ({
  word,
  lang_code: "en",
  pos: "noun",
  senses: [{ glosses }],
});
const primary = (word: string) => ({
  word,
  entries: [{ language: { code: "en" }, partOfSpeech: "noun", senses: [{ translations: [] }] }],
  source: {
    url: "https://en.wiktionary.org/wiki/" + word,
    license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  },
});
test("Turkish Wiktionary emits source-backed Turkish noun gloss", () => {
  const r = parseTurkishWiktionaryGloss(
    "climate",
    turkish("climate", [nouns("climate", "iklim", "hava durumu")]),
  );
  expect(r.status).toBe("ready");
  expect(r.entries[0].meanings).toEqual(["iklim", "hava durumu"]);
  expect(r.source?.url).toBe("https://tr.wiktionary.org/wiki/climate");
  const record = buildTooltipRecord("climate", r)!;
  expect(record.part_of_speech).toBe("Tooltip");
  expect(record.provenance.provider).toBe("Wiktapi / Turkish Wiktionary");
  expect(record.provenance.validation).toBe("dictionary_verified_not_context_certified");
});
test("multiple Turkish Wiktionary parts of speech remain distinct", () => {
  const r = parseTurkishWiktionaryGloss(
    "approach",
    turkish("approach", [
      nouns("approach", "yaklaşım"),
      { word: "approach", lang_code: "en", pos: "verb", senses: [{ glosses: ["yaklaşmak"] }] },
    ]),
  );
  expect(r.status).toBe("choices");
  expect(buildTooltipRecord("approach", r)?.content.meanings).toEqual([
    "noun: yaklaşım",
    "verb: yaklaşmak",
  ]);
});
test("wrong edition/word cannot impersonate a Turkish lexicon source", () => {
  expect(() =>
    parseTurkishWiktionaryGloss(
      "climate",
      turkish("deteriorate", [nouns("deteriorate", "kötüleşmek")]),
    ),
  ).toThrow();
  expect(() =>
    parseTurkishWiktionaryGloss("climate", {
      ...turkish("climate", [nouns("climate", "iklim")]),
      edition: "en",
    }),
  ).toThrow();
  expect(
    parseTurkishWiktionaryGloss(
      "climate",
      turkish("climate", [
        { word: "climate", lang_code: "de", pos: "noun", senses: [{ glosses: ["falsch"] }] },
      ]),
    ).status,
  ).toBe("missing");
});
test("missing English translations use Turkish edition through the same bounded fetcher", async () => {
  const visited: string[] = [];
  const fetcher = async (input: unknown) => {
    const uri = String(input);
    visited.push(uri);
    return new Response(
      JSON.stringify(
        uri.includes("freedictionaryapi.com")
          ? primary("climate")
          : turkish("climate", [nouns("climate", "iklim")]),
      ),
      { status: 200 },
    );
  };
  const r = await lookupPublicTurkish(
    "climate",
    "test-two-sources-unique",
    fetcher as typeof fetch,
  );
  expect(r.status).toBe("ready");
  expect(r.entries[0].meanings).toEqual(["iklim"]);
  expect(visited).toHaveLength(2);
  expect(visited[1]).toBe("https://api.wiktapi.dev/v1/tr/word/climate?lang=en");
});
test("Turkish edition 429 remains a real error, never cached as a missing sense", async () => {
  await expect(
    lookupTurkishWiktionaryGloss("climate", (async () => {
      return new Response(JSON.stringify({}), { status: 429 });
    }) as unknown as typeof fetch),
  ).rejects.toMatchObject({ status: 429, code: "DICTIONARY_RATE_LIMIT" });
});
test("cached Turkish Wiktionary gloss requires correct source domain and licensing", async () => {
  const source = parseTurkishWiktionaryGloss(
    "climate",
    turkish("climate", [nouns("climate", "iklim")]),
  );
  const record = buildTooltipRecord("climate", source)!;
  function fakeDatabase(provenance: typeof record.provenance) {
    const row = {
      word_key: "climate",
      part_of_speech: "Tooltip",
      status: "machine_validated",
      content: record.content,
      provenance,
    };
    const chain = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      limit() {
        return Promise.resolve({
          data: [row],
          error: null,
        });
      },
    };
    return {
      from() {
        return chain;
      },
    };
  }
  const good = await readSharedTooltipGloss(fakeDatabase(record.provenance) as never, "climate");
  expect(good?.meanings).toEqual(["iklim"]);
  expect(good?.provider).toBe("Wiktapi / Turkish Wiktionary");
  const hostile = { ...record.provenance, url: "https://evil.example/wiki/climate" };
  const rejected = await readSharedTooltipGloss(fakeDatabase(hostile) as never, "climate");
  expect(rejected).toBeNull();
});

test("real Wiktapi compact Turkish edition response gives a sourced tooltip", () => {
  // Confirmed directly against the public provider during branch QA.
  const compact = {
    word: "climate",
    edition: "tr",
    entries: [
      {
        senses: [{ glosses: ["iklim, abuhava"] }],
        sounds: [],
        translations: [],
        forms: [],
      },
    ],
  };
  const r = parseTurkishWiktionaryGloss("climate", compact);
  expect(r.status).toBe("ready");
  expect(r.entries[0].partOfSpeech).toBe("word"); // Unknown, never guessed
  expect(r.entries[0].meanings).toEqual(["iklim, abuhava"]);
  expect(buildTooltipRecord("climate", r)?.provenance.url).toBe(
    "https://tr.wiktionary.org/wiki/climate",
  );
});
test("explicit wrong-language compact entry is excluded", () => {
  const compact = {
    word: "house",
    edition: "tr",
    entries: [
      {
        lang_code: "de",
        senses: [{ glosses: ["falsch"] }],
      },
    ],
  };
  expect(parseTurkishWiktionaryGloss("house", compact).status).toBe("missing");
});

test.each([
  [429, "initial"],
  [502, "subsequent"],
  [503, "resilient"],
  [504, "consequence"],
] as const)(
  "primary HTTP %i uses Turkish Wiktionary for %s without inventing a gloss",
  async (status, word) => {
    const visited: string[] = [];
    const fetcher = async (input: unknown) => {
      const url = String(input);
      visited.push(url);
      return url.includes("freedictionaryapi.com")
        ? new Response("{}", { status })
        : Response.json(turkish(word, [nouns(word, "sınama anlamı")]));
    };
    const gloss = await lookupPublicTurkish(word, "fallback-" + word, fetcher as typeof fetch);
    expect(gloss.status).toBe("ready");
    expect(gloss.source?.provider).toBe("Wiktapi / Turkish Wiktionary");
    expect(gloss.source?.url).toBe("https://tr.wiktionary.org/wiki/" + word);
    expect(visited).toHaveLength(2);
    expect(visited[1]).toContain("/v1/tr/word/" + word + "?lang=en");
  },
);

test("a transient primary network failure independently retries the licensed Turkish provider", async () => {
  const visited: string[] = [];
  const word = "mitigate";
  const fetcher = async (input: unknown) => {
    const url = String(input);
    visited.push(url);
    if (url.includes("freedictionaryapi.com")) throw new Error("synthetic connection reset");
    return Response.json(turkish(word, [nouns(word, "azaltma")]));
  };
  const gloss = await lookupPublicTurkish(
    word,
    "fallback-network-synthetic",
    fetcher as typeof fetch,
  );
  expect(gloss.status).toBe("ready");
  expect(gloss.entries[0].meanings).toEqual(["azaltma"]);
  expect(visited).toHaveLength(2);
});

test("both providers failing returns a real error, never a fabricated Turkish meaning", async () => {
  const visited: string[] = [];
  const fetcher = async (input: unknown) => {
    visited.push(String(input));
    return new Response("{}", { status: 503 });
  };
  await expect(
    lookupPublicTurkish("deteriorate", "fallback-both-down", fetcher as typeof fetch),
  ).rejects.toMatchObject({ status: 503, code: "DICTIONARY_UPSTREAM_ERROR" });
  expect(visited).toHaveLength(2);
});

test("a primary input rejection is not bypassed through another provider", async () => {
  const visited: string[] = [];
  const fetcher = async (input: unknown) => {
    visited.push(String(input));
    return new Response("{}", { status: 400 });
  };
  await expect(
    lookupPublicTurkish("transient", "fallback-validation-guard", fetcher as typeof fetch),
  ).rejects.toMatchObject({ status: 503, code: "DICTIONARY_UPSTREAM_ERROR" });
  expect(visited).toHaveLength(1);
});

test("transient primary outage plus absent secondary gloss is not cached as missing", async () => {
  const word = "origin";
  const visited: string[] = [];
  const fetcher = async (input: unknown) => {
    const url = String(input);
    visited.push(url);
    if (visited.length === 1) return new Response("{}", { status: 503 });
    if (visited.length <= 3) return new Response("{}", { status: 404 });
    return Response.json(turkish(word, [nouns(word, "kaynak")]));
  };
  await expect(
    lookupPublicTurkish(word, "transient-outage-safe", fetcher as typeof fetch),
  ).rejects.toMatchObject({ status: 503, code: "DICTIONARY_UPSTREAM_ERROR" });
  const next = await lookupPublicTurkish(word, "transient-outage-safe", fetcher as typeof fetch);
  expect(next.status).toBe("ready");
  expect(next.source?.provider).toBe("Wiktapi / Turkish Wiktionary");
  expect(visited).toHaveLength(4);
});

test("primary rate limit plus missing secondary remains a rate-limit error", async () => {
  const word = "precede";
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response("{}", { status: calls === 1 ? 429 : 404 });
  };
  await expect(
    lookupPublicTurkish(word, "transient-quota-guard", fetcher as unknown as typeof fetch),
  ).rejects.toMatchObject({ status: 429, code: "DICTIONARY_RATE_LIMIT" });
  expect(calls).toBe(2);
});
