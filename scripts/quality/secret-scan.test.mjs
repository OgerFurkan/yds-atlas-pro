import { test } from "node:test";
import assert from "node:assert/strict";
import { detectExposedSecrets } from "./secret-scan.mjs";

test("secret scanner catches synthetic privileged tokens without exposing them", () => {
  assert.deepEqual(detectExposedSecrets("sb_" + "secret_" + "A".repeat(20)), ["supabase_secret"]);
  assert.deepEqual(detectExposedSecrets("AIza" + "B".repeat(35)), ["google_api_key"]);
  assert.deepEqual(detectExposedSecrets("gh" + "p_" + "C".repeat(36)), ["github_token"]);
});
test("public publishable key and harmless docs stay allowed", () => {
  assert.deepEqual(detectExposedSecrets("sb_publishable_public_fixture"), []);
  assert.deepEqual(detectExposedSecrets("Gemini fake-provider 429 / 503"), []);
});
