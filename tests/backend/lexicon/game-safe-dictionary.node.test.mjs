import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function load() {
  const raw = readFileSync(
    resolve(import.meta.dirname, "../../../backend/src/features/feedback/inspector-service.ts"),
    "utf8",
  );
  const withoutImports = raw
    .replace(/^import\b[\s\S]*?;\s*/gm, "")
    .replace(/\bexport\s+(?=(?:async\s+)?function\b)/g, "");
  const js =
    typeof Bun === "undefined"
      ? nodeModule.stripTypeScriptTypes(withoutImports, { mode: "transform" })
      : new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(withoutImports);
  return new Function(
    "databaseError",
    "HttpError",
    "quotaClient",
    js + "\nreturn { assertGameSafeDictionaryWord };",
  )(
    (error) => {
      if (error) throw error;
    },
    HttpError,
    () => {
      throw Error("no database");
    },
  );
}
const { assertGameSafeDictionaryWord } = load();
function ctx(rows) {
  return {
    userId: "synthetic-user",
    db: {
      from(table) {
        assert.equal(table, "learning_sessions");
        const chain = {
          select() {
            return this;
          },
          eq(column, user) {
            assert.equal(column, "user_id");
            assert.equal(user, "synthetic-user");
            return this;
          },
          is() {
            return this;
          },
          or(filter) {
            assert.equal(filter, "snapshot->>discarded.is.null,snapshot->>discarded.neq.true");
            return this;
          },
          limit() {
            return Promise.resolve({
              data: rows.filter((row) => row.snapshot?.discarded !== true),
              error: null,
            });
          },
        };
        return chain;
      },
    },
  };
}
const snapshot = {
  words: [
    { word: "Supplant", alternatives: ["supplants", "supplanted"] },
    { word: "Deteriorate", alternatives: [] },
  ],
};
test("a normal surrounding word is allowed while an unfinished game exists", async () => {
  await assert.doesNotReject(() => assertGameSafeDictionaryWord(ctx([{ snapshot }]), "evidence"));
});
test("active word and grammatical variants remain hidden from dictionary", async () => {
  for (const token of ["supplant", "supplants", "supplanted", "deteriorate", "deteriorating"]) {
    await assert.rejects(
      () => assertGameSafeDictionaryWord(ctx([{ snapshot }]), token),
      (e) => e.code === "DICTIONARY_ANSWER_PROTECTED",
    );
  }
});
test("discarded gameplay no longer protects words from dictionary lookups", async () => {
  await assert.doesNotReject(() =>
    assertGameSafeDictionaryWord(ctx([{ snapshot: { ...snapshot, discarded: true } }]), "supplant"),
  );
});
test("invalid game data blocks all lookups rather than exposing answers", async () => {
  await assert.rejects(
    () => assertGameSafeDictionaryWord(ctx([{ snapshot: { words: null } }]), "evidence"),
    (e) => e.code === "DICTIONARY_GAME_UNAVAILABLE",
  );
  await assert.doesNotReject(() => assertGameSafeDictionaryWord(ctx([]), "evidence"));
});
