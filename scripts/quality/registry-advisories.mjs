import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("bun.lock", "utf8").replace(/,(\s*[}\]])/g, "$1"));
const pinned = Object.create(null);
for (const record of Object.values(lock.packages)) {
  const locator = record[0];
  if (locator.includes("@workspace:")) continue;
  const match = /^(@[\w.-]+\/[\w.-]+|[\w.-]+)@(\d+\.\d+\.\d+(?:[-+][\w.+-]+)?)$/.exec(locator);
  if (!match) throw new Error("Unexpected dependency locator. Advisory query stopped.");
  const [, name, version] = match;
  pinned[name] ??= new Set();
  pinned[name].add(version);
}
const packages = Object.fromEntries(
  Object.entries(pinned).map(([name, versions]) => [name, [...versions].sort()]),
);
if (!Object.keys(packages).length) throw new Error("Lockfile contains no external dependencies.");

try {
  const response = await fetch("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(packages),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid advisory response.");
  let count = 0;
  for (const [name, advisories] of Object.entries(payload)) {
    if (!Object.hasOwn(packages, name) || !Array.isArray(advisories))
      throw new Error("Invalid advisory response.");
    for (const item of advisories) {
      if (
        !["low", "moderate", "high", "critical"].includes(item?.severity) ||
        !Number.isSafeInteger(item.id) ||
        typeof item.vulnerable_versions !== "string"
      )
        throw new Error("Invalid advisory record.");
      const ghsa = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/i.exec(item.url)?.[1];
      console.log(name, packages[name].join(","), item.severity, ghsa ?? item.id);
      count++;
    }
  }
  console.log(
    `${count} advisories for ${Object.keys(packages).length} locked public package names.`,
  );
  if (count) process.exitCode = 1;
} catch (error) {
  console.error(
    "Advisory registry unavailable or returned unverifiable data.",
    error.cause?.code ?? error.name,
  );
  process.exitCode = 2;
}
