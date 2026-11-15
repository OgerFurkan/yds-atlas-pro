"use strict";
// Offline audit only. Never connects to Supabase or any service.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const base = path.resolve(__dirname, "../../docs/architecture/staging-applied");
const file = path.join(base, "20261115180300_atlas_privileged_writers_v3_v5_v6_staging_additive.sql");
const bytes = fs.readFileSync(file);
const sql = bytes.toString("utf8");
const digest = (alg) => crypto.createHash(alg).update(bytes).digest("hex");
assert.equal(bytes.length, 19229, "Recorded staging SQL size drift");
assert.equal(digest("sha256"), "8da8e6deef451dd8ca3b14e871626d5fa4ef7df95b1442302d99514584f011d3", "Staging SQL SHA-256 drift");
assert.equal(digest("md5"), "d18778e21a275b9113b40e95b05445fb", "Staging SQL MD5 drift");
for (const name of ["complete_learning_session_v3", "save_learning_session_v5", "set_daily_goal_v6"]) {
  assert.ok(sql.includes(`public.${name}(`), `${name} missing from recorded SQL`);
}
assert.ok(sql.includes("-- APPROVED 2026-11-15: STAGING ONLY"));
assert.ok(sql.includes("$atlas_guard$"));
assert.ok(sql.includes("$atlas_post$"));
console.log("STAGING APPLIED SQL LEDGER PASS: 19,229 bytes; exact Supabase stored SHA-256 and MD5; no network/writes.");
