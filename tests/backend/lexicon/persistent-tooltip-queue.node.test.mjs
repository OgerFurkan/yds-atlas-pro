import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

function source(path, bindings) {
  const raw = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const names = [...raw.matchAll(/\bexport\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(
    (item) => item[1],
  );
  const cleaned = raw
    .replace(/^import\b[\s\S]*?;\s*/gm, "")
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const)\b)/g, "");
  const js =
    typeof Bun === "undefined"
      ? nodeModule.stripTypeScriptTypes(cleaned, { mode: "transform" })
      : new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(cleaned);
  return new Function(...Object.keys(bindings), js + "\nreturn {" + names.join(",") + "};")(
    ...Object.values(bindings),
  );
}
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const config = { ATLAS_FEEDBACK_LEXICON_ENABLED: true, SUPABASE_SECRET_KEY: "not-real" };
const calls = [];
const db = {
  from(table) {
    assert.equal(table, "atlas_tooltip_queue");
    return {
      upsert(rows, options) {
        calls.push({ rows, options });
        return Promise.resolve({ error: null });
      },
    };
  },
};
const exported = source("../../../backend/src/features/lexicon/persistent-tooltip-queue.ts", {
  randomUUID: () => "00000000-0000-4000-8000-000000000021",
  quotaClient: () => {
    throw Error("Production DB is forbidden during tests");
  },
  HttpError,
  listWords: async (ctx) => {
    assert.equal(ctx.userId, "test-user");
    return [
      {
        word: "obtain",
        examples: [{ sentence: "Trees mitigate flooding." }, { sentence: "The evidence changes." }],
      },
    ];
  },
  sentencePrefetchEnabled: () => true,
  sentenceTokens: (sentences) =>
    sentences.flatMap((s) => s.split(/\s+/).map((x) => x.replace(/[.!?,]/g, "").toLowerCase())),
  dictionaryWord: (raw) => {
    if (!/^[a-z]+$/.test(raw)) throw Error("invalid");
    return raw;
  },
  lookupPublicTurkish: async (word) => ({
    status: "ready",
    word,
    entries: [{ partOfSpeech: "verb", meanings: ["karşılık"] }],
  }),
  buildTooltipRecord: (word, result) => (result.status === "ready" ? { word_key: word } : null),
  publishShortGloss: async () => true,
  readSharedTooltipGloss: async () => null,
});
test("new sentences persist deduplicated single tokens to service queue, no personal rows", async () => {
  calls.length = 0;
  const r = await exported.enqueueSentenceGlosses(
    config,
    ["obtain clear evidence.", "obtain useful results."],
    db,
  );
  assert.equal(r.queued, 5);
  assert.deepEqual(
    calls[0].rows.map((x) => x.word_key),
    ["obtain", "clear", "evidence", "useful", "results"],
  );
  assert.deepEqual(calls[0].options, { onConflict: "word_key", ignoreDuplicates: true });
  assert.equal(
    calls[0].rows.every((x) => Object.keys(x).join() === "word_key"),
    true,
  );
});
test("legacy scan is scoped, read-only, and never passes sentences to shared queue", async () => {
  calls.length = 0;
  const r = await exported.enqueueLegacyGlosses({ userId: "test-user", db: {} }, config, db);
  assert.equal(r.scannedWords, 1);
  assert.equal(r.scannedSentences, 2);
  assert.equal(r.distinctCandidates > 0, true);
  assert.equal(
    calls
      .flatMap((c) => c.rows)
      .every((row) => Object.keys(row).join() === "word_key" && !row.user_id && !row.sentence),
    true,
  );
});
test("worker atomically claims words, publishes verified results and completes lease", async () => {
  const operations = [];
  const token = "00000000-0000-4000-8000-000000000021";
  const client = {
    rpc: async (name, args) => {
      operations.push({ name, args });
      if (name === "atlas_tooltip_claim_v1")
        return {
          data: [
            { word_key: "obtain", lease_token: token },
            { word_key: "mitigate", lease_token: token },
          ],
          error: null,
        };
      if (name === "atlas_tooltip_finish_v1") return { data: true, error: null };
      throw Error(name);
    },
  };
  const result = await exported.processGlossQueue(config, { db: client, maxBatch: 2 });
  assert.deepEqual(
    { scanned: result.scanned, published: result.published },
    { scanned: 2, published: 2 },
  );
  assert.equal(operations[0].args.p_limit, 2);
  assert.deepEqual(
    operations.slice(1).map((x) => x.args.p_outcome),
    ["ready", "ready"],
  );
  assert.equal(
    operations.every((x) => x.args.p_token === token),
    true,
  );
});
test("publication failure remains retry, not a fabricated ready translation", async () => {
  const op = [];
  const client = {
    rpc: async (name, args) => {
      op.push({ name, args });
      return name === "atlas_tooltip_claim_v1"
        ? { data: [{ word_key: "obtain", lease_token: args.p_token }], error: null }
        : { data: true, error: null };
    },
  };
  const result = await exported.processGlossQueue(config, {
    db: client,
    dictionary: async () => {
      throw Error("offline");
    },
  });
  assert.equal(result.published, 0);
  assert.equal(op[1].args.p_outcome, "retry");
  assert.equal(op[1].args.p_error_code, "LOOKUP_OR_PUBLISH_FAILED");
});
test("SQL migration is service-role-only, RLS-protected, idempotent and lease guarded", () => {
  const sql = readFileSync(
    resolve(
      import.meta.dirname,
      "../../../supabase/migrations/20261120175000_atlas_tooltip_queue_pg17.sql",
    ),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE public\.atlas_tooltip_queue/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.atlas_tooltip_queue FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.atlas_tooltip_queue TO service_role/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /q\.lease_token=p_token AND q\.lease_expires_at > now\(\)/);
  assert.doesNotMatch(
    sql,
    /DROP TABLE|TRUNCATE|DELETE FROM public\.words|ALTER TABLE public\.words/,
  );
});
