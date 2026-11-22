#!/usr/bin/env node
// Scans tracked runtime source/config, never logs matched secrets or test fixture values.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const rules = [
  ["google_api_key", new RegExp("AIza" + "[A-Za-z0-9_-]{35}", "g")],
  ["github_token", new RegExp("gh" + "[pousr]_[A-Za-z0-9]{30,}", "g")],
  ["supabase_secret", new RegExp("sb_" + "secret_[A-Za-z0-9_-]{12,}", "g")],
  ["api_secret", new RegExp("sk-" + "[A-Za-z0-9]{20,}", "g")],
  ["private_key", new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----", "g")],
];
export function detectExposedSecrets(text) {
  return rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
const checked = (p) =>
  /^(frontend\/src\/|frontend\/config\/|backend\/src\/|packages\/shared\/src\/|\.github\/workflows\/|supabase\/migrations\/)/.test(p) ||
  p === "vercel.json";
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: projectRoot })
    .toString("utf8").split("\0").filter(checked);
  const findings = [];
  for (const file of files) {
    const kinds = detectExposedSecrets(readFileSync(resolve(projectRoot, file), "utf8"));
    for (const kind of kinds) findings.push({ file, detector: kind });
  }
  console.log(JSON.stringify({ kind: "TRACKED_SOURCE_SECRET_SCAN", scannedFiles: files.length, findings }, null, 2));
  if (findings.length) process.exitCode = 1;
}
