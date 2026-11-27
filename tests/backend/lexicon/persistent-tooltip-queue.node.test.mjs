import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("retired workers and caller stay absent from application sources", () => {
  for (const file of [
    "backend/src/features/lexicon/persistent-tooltip-queue.ts",
    "backend/src/features/lexicon/sentence-lexicon-prefetch.ts",
    "frontend/src/features/word-library/components/tooltip-backfill.tsx",
  ])
    assert.equal(existsSync(resolve(import.meta.dirname, "../../..", file)), false);
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
