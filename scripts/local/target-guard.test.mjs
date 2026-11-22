import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalSupabaseTarget } from "./target-guard.mjs";

test("a genuine loopback LOCAL Supabase endpoint is accepted", () => {
  assert.equal(assertLocalSupabaseTarget("http://127.0.0.1:54321").origin, "http://127.0.0.1:54321");
  assert.equal(assertLocalSupabaseTarget("http://localhost:54321").origin, "http://localhost:54321");
});

test("remote staging/production, DNS tricks and port changes fail closed", () => {
  for (const candidate of [
    "https://mxsjocfbsquveeuogspe.supabase.co",
    "https://desanpeigzzuimmtxesx.supabase.co",
    "http://127.0.0.1.evil.example.test:54321",
    "http://127.0.0.1:54322",
    "http://127.0.0.1:54321/extra",
    "http://127.0.0.1:54321/?token=fixture",
    "http://localhost:54321/#next",
    "http://guest:password@localhost:54321",
  ]) {
    assert.throws(() => assertLocalSupabaseTarget(candidate), /BLOCKED/);
  }
});
