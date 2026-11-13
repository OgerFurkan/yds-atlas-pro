#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage", "test-results", "build"].includes(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, found);
    else if (/\.[jt]sx?$/.test(ent.name)) found.push(abs);
  }
  return found;
}
const sources = ["frontend/src", "backend/src", "packages"].flatMap(p => walk(path.join(root, p)));
const oversized = [], violations = [];
for (const file of sources) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const code = fs.readFileSync(file, "utf8");
  const lines = code.split(/\r?\n/).length;
  if (lines > 350) oversized.push({ path: relative, lines });
  if (!relative.startsWith("frontend/src/shared/")) continue;
  for (const match of code.matchAll(/\b(?:import|export)\s+(?:[\s\S]{0,120}?\s+from\s*)?["']([^"']+)["']/g)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const dest = path.relative(root, path.resolve(path.dirname(file), spec)).split(path.sep).join("/");
    if (dest.startsWith("frontend/src/app/") || dest.startsWith("frontend/src/features/"))
      violations.push({ file: relative, import: spec });
  }
}
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
const trackedSecrets = tracked.filter(p => /(^|\/)(\.env(\.|$)|credentials\.json$|service-account\.json$)/i.test(p) && !/\.example$/i.test(p));
const trackedArtifacts = tracked.filter(p => /\.(bak|zip|patch)$/i.test(p));
console.log(JSON.stringify({ analyzedFiles: sources.length, oversized: oversized.sort((a,b)=>b.lines-a.lines), sharedDependencyViolations: violations, trackedSecrets, trackedArtifacts }, null, 2));
if (violations.length || trackedSecrets.length) process.exitCode = 1;
