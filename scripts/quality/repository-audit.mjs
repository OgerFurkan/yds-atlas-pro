#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  featureDependencies,
  generatedPaths,
  largeFileReview,
  misplacedSources,
} from "./architecture-policy.mjs";
import { engineeringIssues } from "./engineering-policy.mjs";
import { safeSource } from "./run-policy.mjs";
import {
  crossWorkspaceImports,
  forbiddenSharedImports,
  importReferences,
  resolveSource,
  runtimeCycles,
} from "./shared-imports.mjs";

const root = process.cwd();
function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage", "test-results", "build"].includes(ent.name))
      continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, found);
    else if (/\.[cm]?[jt]sx?$/.test(ent.name)) found.push(abs);
  }
  return found;
}
const sources = ["frontend/src", "frontend/config", "backend/src", "packages"].flatMap((p) =>
  walk(path.join(root, p)),
);
const sourceNames = new Set(
  sources.map((file) => path.relative(root, file).split(path.sep).join("/")),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "packages/shared/package.json"), "utf8"),
);
const sharedExports = new Map(
  Object.entries(manifest.exports).map(([key, target]) => [
    key === "." ? manifest.name : manifest.name + key.slice(1),
    path.posix.join("packages/shared", target),
  ]),
);
const graph = new Map();
const lazyImports = [],
  unresolvedDynamicImports = [];
const workspaceViolations = [];
const featureImports = [];
const oversized = [],
  violations = [];
for (const file of sources) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const code = fs.readFileSync(safeSource(root, relative), "utf8");
  const lines = code.split(/\r?\n/).length;
  const review = largeFileReview(relative, lines);
  if (review) oversized.push(review);
  for (const dependency of featureDependencies(relative, code))
    featureImports.push({ file: relative, ...dependency });
  const eager = [];
  for (const { spec, lazy, typeOnly, offset } of importReferences(relative, code)) {
    if (spec === null) {
      unresolvedDynamicImports.push({ file: relative, offset });
      continue;
    }
    const target = resolveSource(relative, spec, sourceNames, sharedExports);
    if (lazy) lazyImports.push({ file: relative, spec, target: target ?? null });
    else if (!typeOnly && target) eager.push(target);
  }
  graph.set(relative, eager);
  for (const spec of crossWorkspaceImports(relative, code, sharedExports))
    workspaceViolations.push({ file: relative, import: spec });
  if (!/^(frontend|backend)\/src\/shared\//.test(relative)) continue;
  for (const spec of forbiddenSharedImports(relative, code))
    violations.push({ file: relative, import: spec });
}
const cycles = runtimeCycles(graph);
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean);
const trackedSecrets = tracked.filter(
  (p) =>
    /(^|\/)(\.env(\.|$)|credentials\.json$|service-account\.json$)|\.(pem|key|pfx|p12)$/i.test(p) &&
    !/\.example$/i.test(p),
);
const sourceFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  cwd: root,
})
  .toString()
  .split("\0")
  .filter(Boolean);
const layoutViolations = misplacedSources(
  sourceFiles.filter((file) => fs.existsSync(path.join(root, file))),
);
const engineeringViolations = engineeringIssues(root, sourceFiles);
const trackedArtifacts = generatedPaths(sourceFiles).filter((file) =>
  fs.existsSync(path.join(root, file)),
);
const privateFeatureImports = featureImports.filter(({ allowed }) => !allowed);
console.log(
  JSON.stringify(
    {
      analyzedFiles: sources.length,
      oversized: oversized.sort((a, b) => b.lines - a.lines),
      sharedDependencyViolations: violations,
      workspaceDependencyViolations: workspaceViolations,
      featureImports,
      privateFeatureImports,
      trackedSecrets,
      runtimeImportCycles: cycles,
      lazyImports,
      unresolvedDynamicImports,
      trackedArtifacts,
      layoutViolations,
      engineeringViolations,
    },
    null,
    2,
  ),
);
if (
  oversized.some(({ violation }) => violation) ||
  violations.length ||
  workspaceViolations.length ||
  privateFeatureImports.length ||
  trackedArtifacts.length ||
  layoutViolations.length ||
  trackedSecrets.length ||
  engineeringViolations.length ||
  cycles.length
)
  process.exitCode = 1;
