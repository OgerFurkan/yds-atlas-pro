import { lstatSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

const safeEnvironment =
  /^(PATH|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|LANG|LC_ALL|TERM|CI|PLAYWRIGHT_BROWSERS_PATH|BUN_INSTALL_CACHE_DIR|NO_COLOR)$/i;
export const syntheticEnv = (input) =>
  Object.fromEntries(Object.entries(input).filter(([name]) => safeEnvironment.test(name)));

export function sourcePaths(paths) {
  return [
    ...new Set(
      paths.filter((p) => p && (!/(^|\/)\.env($|\.)/.test(p) || p.endsWith(".env.example"))),
    ),
  ]
    .filter(
      (p) =>
        !/(^|\/)(node_modules|dist|coverage|test-results(?:-[^/]+)?|playwright-report)(\/|$)/.test(
          p,
        ),
    )
    .filter(
      (p) =>
        !/(^|\/)(\.npmrc|credentials\.json|service-account\.json)$|\.(pem|key|pfx|p12|bak|zip)$/i.test(
          p,
        ),
    )
    .sort();
}

export function safeSource(root, name) {
  if (name.split("/").some((part) => part === ".." || !part))
    throw new Error("Invalid source path.");
  const path = join(root, name);
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  const physical = realpathSync(path);
  if (
    !info.isFile() ||
    relative(root, physical).replaceAll("\\", "/").toLowerCase() !== name.toLowerCase() ||
    (process.platform !== "win32" && relative(root, physical) !== name)
  )
    throw new Error(`Source path traverses a link or is not a regular file: ${name}`);
  return path;
}

export function browserInventory(report) {
  const tests = new Map();
  const projects = new Set(report.config?.projects?.map((project) => project.id));
  function visit(suite, parents = []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const key = JSON.stringify([spec.file, ...parents, spec.title, test.projectId, spec.id]);
        if (!spec.id || !spec.file || !projects.has(test.projectId) || tests.has(key))
          throw new Error("Invalid or duplicate browser test identity.");
        tests.set(key, { test, title: spec.title });
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...parents, child.title]);
  }
  visit(report);
  if (
    !tests.size ||
    !projects.size ||
    report.errors?.length ||
    new Set([...tests.values()].map(({ test }) => test.projectId)).size !== projects.size
  )
    throw new Error("Browser test inventory is incomplete.");
  return tests;
}

export function commandStatus(code, valid, timeout) {
  return code === 0 && valid && !timeout ? "PASS" : "FAIL";
}

export const redact = (value) =>
  value
    .replace(/\b(sb_secret_|ghp_|github_pat_|gh[ousr]_|AIza)[\w-]{16,}/g, "[redacted]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]")
    .replace(
      /-----BEGIN [^\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^\r\n]*PRIVATE KEY-----/g,
      "[redacted]",
    )
    .replace(/(postgres(?:ql)?:\/\/)[^/\s]+@/gi, "$1[redacted]@");

export function browserSummary(report, name, discovery) {
  const expectedSkip = (title, project) =>
    (name === "guest-browser" &&
      project === "mobile" &&
      title === "sign-up slides the Atlas panel to the right and sign-in slides it back") ||
    (name === "cloud-browser" &&
      project === "desktop" &&
      title ===
        "mobile Atlas bubble can be hidden and restored without losing the conversation draft");
  let passed = 0,
    skipped = 0;
  const expected = browserInventory(discovery);
  const actual = browserInventory(report);
  if (expected.size !== actual.size || [...expected.keys()].some((key) => !actual.has(key)))
    throw new Error("Browser discovery and execution inventories differ.");
  for (const { test, title } of actual.values()) {
    if (
      test.status === "skipped" &&
      expectedSkip(title, test.projectName) &&
      (test.results?.length === 0 ||
        (test.results?.length === 1 && test.results[0].status === "skipped"))
    )
      skipped++;
    else if (
      test.status === "expected" &&
      test.expectedStatus === "passed" &&
      test.results?.length === 1 &&
      test.results[0].status === "passed"
    )
      passed++;
    else throw new Error("Unexpected browser skip, failure, retry, or empty result.");
  }
  const stats = report.stats;
  if (
    !passed ||
    stats?.expected !== passed ||
    stats.skipped !== skipped ||
    stats.flaky !== 0 ||
    stats.unexpected !== 0
  )
    throw new Error("Browser report counts do not match execution.");
  return `${passed} passed, ${skipped} explicit viewport skips`;
}
