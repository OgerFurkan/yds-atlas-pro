import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../../supabase/migrations/20261119180000_feedback_lexicon_minimal_pg17.sql", import.meta.url), "utf8");
const body = sql.replace(/^--[^\n]*$/gm, "");
const tables = [...body.matchAll(/\bCREATE\s+TABLE\s+public\.(\w+)/gi)].map((match) => match[1]);
const functions = [...body.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)/gi)]
  .map((match) => match[1]);

test("only three canonical Atlas Lexicon tables and two audited RPCs", () => {
  assert.deepEqual(tables, ["atlas_lexicon_entries", "atlas_lexicon_jobs", "atlas_lexicon_entry_revisions"]);
  assert.deepEqual(functions, ["atlas_lexicon_claim_v1", "atlas_lexicon_publish_v1"]);
  assert.doesNotMatch(body, /\bCREATE\s+(?:TABLE|FUNCTION)\s+public\.(?:atlas_usage_events|atlas_sentence_terms|atlas_admin_)/i);
});

test("PG17, immutable migration and conflicting objects fail closed", () => {
  assert.match(body, /server_version_num/);
  assert.match(body, /existing_table_count\s*<>\s*0\s+OR\s+existing_fn_count\s*<>\s*0/i);
  assert.match(body, /\bBEGIN;[\s\S]*\bCOMMIT;/);
  assert.doesNotMatch(body, /^\s*(?:DROP\s+(?:TABLE|FUNCTION)\b|TRUNCATE\s+\w|DELETE\s+FROM\s+public\.)/im);
});

test("all three RLS enabled; only server role gets direct read/write", () => {
  for (const table of tables) {
    assert.match(body, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(body, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC,anon,authenticated,service_role;/i);
  assert.match(body, /GRANT SELECT,INSERT,UPDATE ON TABLE public\.atlas_lexicon_entries TO service_role/i);
  assert.match(body, /GRANT SELECT,INSERT,UPDATE ON TABLE public\.atlas_lexicon_jobs TO service_role/i);
  assert.match(body, /GRANT SELECT,INSERT ON TABLE public\.atlas_lexicon_entry_revisions TO service_role/i);
  assert.doesNotMatch(body, /\bGRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\b[^;]*\bTO\s+(?:PUBLIC|anon|authenticated)\b/i);
});

test("SECURITY DEFINER functions have fixed search_path and restricted EXECUTE", () => {
  assert.equal((body.match(/SECURITY DEFINER SET search_path = ''/g) ?? []).length, 2);
  for (const name of functions) {
    assert.match(body, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`, "i"));
    assert.match(body, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`, "i"));
  }
  assert.match(body, /has_function_privilege\('anon'/);
  assert.match(body, /has_function_privilege\('authenticated'/);
  assert.doesNotMatch(body, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[^;]*\bTO\s+(?:PUBLIC|anon|authenticated)\b/i);
});

test("leased publisher is token, expiry and revision-ledger bound", () => {
  assert.match(body, /lease_token=p_token\s+AND status='generating'/i);
  assert.match(body, /lease_expires_at>pg_catalog\.clock_timestamp\(\)/i);
  assert.match(body, /ON CONFLICT \(word_key,part_of_speech,sense_key\) DO NOTHING/i);
  assert.match(body, /INSERT INTO public\.atlas_lexicon_entry_revisions/i);
  assert.match(body, /RETURN NEXT stored;/i);
});

test("provenance pinned to inspected staging ledger; no administration or user data", () => {
  assert.match(sql, /696df6eb4bc24f9065d09db37f7699b2831953930e649edd322ed800998af7de/);
  assert.doesNotMatch(body, /\b(?:CREATE|ALTER)\s+(?:TABLE|FUNCTION)\s+public\.(?:words|profiles|learning_sessions|atlas_usage_events|atlas_admin_)/i);
  assert.match(body, /SELECT pg_catalog\.pg_notify\('pgrst','reload schema'\);/);
});
