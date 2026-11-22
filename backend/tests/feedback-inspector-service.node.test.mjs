import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// TypeScript 7 does not provide the old `ts.ModuleKind` compiler enum API.
// Native Node strips types; Bun has its own transpiler. Neither test path loads
// project secrets or touches real DB, and no module mocking leaks across tests.
const require = createRequire(import.meta.url);
const nativeStrip =
  typeof Bun === "undefined" ? (await import("node:module")).stripTypeScriptTypes : null;
const bunTranspiler =
  typeof Bun !== "undefined" ? new Bun.Transpiler({ loader: "ts", target: "bun" }) : null;
function loadSource(file, imports = {}) {
  const source = readFileSync(resolve(import.meta.dirname, file), "utf8");
  // Convert only the known module boundary, before TypeScript is stripped. This
  // avoids relying on how Bun/Node formats ESM imports in its transpiler output.
  const exports = [...source.matchAll(/\bexport (?:async )?function\s+(\w+)/g)].map(
    (match) => match[1],
  );
  assert.ok(exports.length > 0, `Missing real module exports: ${file}`);
  const transformedSource = source
    .replace(/^import type [^;]+;\s*$/gm, "")
    .replace(/^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/gm, (_, bindings, specifier) => {
      const names = bindings
        .split(",")
        .map((name) => name.trim())
        .filter((name) => !name.startsWith("type "))
        .join(", ");
      return `const { ${names} } = __resolve(${JSON.stringify(specifier)});`;
    })
    .replace(/\bexport (async )?function\b/g, (_, asyncKeyword = "") => `${asyncKeyword}function`);
  const transformed = bunTranspiler
    ? bunTranspiler.transformSync(transformedSource)
    : nativeStrip(transformedSource, { mode: "transform" });
  assert.doesNotMatch(
    transformed,
    /(?:^|\n)\s*(?:import|export)\s/,
    `Unexpected ESM syntax: ${file}`,
  );
  const module = { exports: {} };
  const mapping = { "node:crypto": require("node:crypto"), ...imports };
  const importOnly = (specifier) => {
    if (!Object.hasOwn(mapping, specifier)) throw Error("Unapproved test import: " + specifier);
    return mapping[specifier];
  };
  new Function(
    "module",
    "exports",
    "__resolve",
    transformed + `\nObject.assign(module.exports, { ${exports.join(", ")} });`,
  )(module, module.exports, importOnly);
  return module.exports;
}
const validator = loadSource("../src/features/feedback/inspector-validation.ts");
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const dbError = (e) => {
  if (e) throw new HttpError(503, "DB unavailable", "DATABASE_ERROR");
};
const example = (d) => ({
  sentence:
    d === "yds"
      ? "The researchers obtain useful findings from several carefully evaluated academic studies conducted throughout the entire university semester."
      : "Students obtain useful English vocabulary in class.",
  translation: "Öğrenciler yararlı kelimeler elde eder.",
  difficulty: d,
  translationFocus: ["elde eder"],
});
const ds = ["easy", "easy", "medium", "yds", "yds"];
const ex = ds.map((d, i) => ({
  ...example(d),
  sentence: example(d).sentence.replace(".", ` in ${i + 1}.`),
}));
const entry = {
  id: "11111111-1111-4111-8111-111111111111",
  word_key: "obtain",
  part_of_speech: "Verb",
  sense_key: validator.meaningKey("elde etmek"),
  revision: 4,
  status: "machine_validated",
  content: {
    word: "obtain",
    partOfSpeech: "Verb",
    meanings: ["elde etmek"],
    alternatives: [],
    usageNote: "",
    cefr: "B1",
    examples: ex,
  },
};
function harness({
  session = [],
  rows = [entry],
  rowForBinding = entry,
  onElevated = () => {},
} = {}) {
  const calls = [];
  const make = (result) => {
    const q = {
      select: () => q,
      eq: (field, value) => {
        calls.push(["eq", field, value]);
        return q;
      },
      neq: () => q,
      is: () => q,
      in: () => q,
      limit: () => Promise.resolve({ data: result, error: null }),
      maybeSingle: () => Promise.resolve({ data: rowForBinding, error: null }),
    };
    return q;
  };
  const ctx = {
    userId: "22222222-2222-4222-8222-222222222222",
    db: {
      from: (table) => {
        assert.equal(table, "learning_sessions");
        calls.push(["user_table", table]);
        return make(session);
      },
    },
  };
  const elevated = {
    from: (table) => {
      onElevated();
      assert.equal(table, "atlas_lexicon_entries");
      return make(rows);
    },
  };
  const service = loadSource("../src/features/feedback/inspector-service.ts", {
    "../../shared/supabase": { quotaClient: () => elevated },
    "../../shared/errors": { HttpError, databaseError: dbError },
    "./inspector-validation": validator,
  });
  const config = { ATLAS_FEEDBACK_LEXICON_ENABLED: true };
  return { service, ctx, config, calls };
}
test("real inspector service refuses to expose a pool when flag off", async () => {
  const h = harness();
  await assert.rejects(
    () =>
      h.service.inspectFeedback(
        h.ctx,
        { ATLAS_FEEDBACK_LEXICON_ENABLED: false },
        new URLSearchParams({ word: "obtain" }),
      ),
    (x) => x.code === "INSPECTOR_DISABLED",
  );
});
test("malformed query rejected before reading session or elevated data", async () => {
  let called = 0;
  const h = harness({ onElevated: () => called++ });
  await assert.rejects(
    () => h.service.inspectFeedback(h.ctx, h.config, new URLSearchParams("word=obtain&word=steal")),
    (x) => x.code === "INSPECTOR_INVALID_QUERY",
  );
  assert.equal(h.calls.length, 0);
  assert.equal(called, 0);
});
test("unfinished game blocks inspector before elevated data access", async () => {
  let called = 0;
  const h = harness({ session: [{ id: "active" }], onElevated: () => called++ });
  await assert.rejects(
    () => h.service.inspectFeedback(h.ctx, h.config, new URLSearchParams("word=obtain")),
    (x) => x.code === "INSPECTOR_ACTIVE_ASSESSMENT",
  );
  assert.equal(called, 0);
  assert(h.calls.some((x) => x[1] === "user_id" && x[2] === h.ctx.userId));
});
test("available record is returned through public projection", async () => {
  const h = harness();
  const result = await h.service.inspectFeedback(
    h.ctx,
    h.config,
    new URLSearchParams("word=obtain"),
  );
  assert.equal(result.status, "ready");
  assert.equal(result.entry.examples.length, 5);
  assert.equal("provenance" in result.entry, false);
});
test("empty pool returns missing not generated content", async () => {
  const h = harness({ rows: [] });
  const result = await h.service.inspectFeedback(
    h.ctx,
    h.config,
    new URLSearchParams("word=obtain"),
  );
  assert.equal(result.status, "missing");
});
test("spoofed revision on explicit save is rejected", async () => {
  const h = harness({ rowForBinding: null });
  await assert.rejects(
    () =>
      h.service.assertFeedbackWordBinding(h.config, {
        word: "obtain",
        lexicon: { entryId: entry.id, revision: 5, contractVersion: 1 },
      }),
    (x) => x.code === "INSPECTOR_REVISION_CONFLICT",
  );
});
test("new Inspector import cannot inject an inflated game score", async () => {
  const h = harness();
  await assert.rejects(
    () =>
      h.service.assertFeedbackWordBinding(
        h.config,
        {
          word: "obtain",
          partOfSpeech: "Verb",
          meanings: ["elde etmek"],
          examples: ex,
          score: 100,
          lexicon: { entryId: entry.id, revision: 4, contractVersion: 1 },
        },
        true,
      ),
    (x) => x.code === "INSPECTOR_SCORE_TAMPERED",
  );
});
test("altered saved examples are rejected", async () => {
  const h = harness();
  await assert.rejects(
    () =>
      h.service.assertFeedbackWordBinding(h.config, {
        word: "obtain",
        partOfSpeech: "Verb",
        meanings: ["elde etmek"],
        examples: [...ex.slice(0, 4), { ...ex[4], translation: "wrong" }],
        lexicon: { entryId: entry.id, revision: 4, contractVersion: 1 },
      }),
    (x) => x.code === "INSPECTOR_BINDING_INVALID",
  );
});
test("exact user-initiated save binding is accepted", async () => {
  const h = harness();
  await h.service.assertFeedbackWordBinding(h.config, {
    word: "obtain",
    partOfSpeech: "Verb",
    meanings: ["elde etmek"],
    examples: ex,
    lexicon: { entryId: entry.id, revision: 4, contractVersion: 1 },
  });
});
