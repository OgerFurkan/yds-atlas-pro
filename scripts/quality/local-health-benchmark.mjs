#!/usr/bin/env node
// HTTP liveness and latency sample; never a claim that database is reachable.
// No remote/staging/prod targets, secrets, user data or external requests.
import { performance } from "node:perf_hooks";

const target = new URL(process.env.LOCAL_ATLAS_API_URL ?? "http://127.0.0.1:3000");
if (
  !["http://127.0.0.1:3000", "http://localhost:3000"].includes(target.origin) ||
  target.pathname !== "/" || target.search || target.hash || target.username || target.password
) throw new Error("BLOCKED: local API probe must use loopback:3000");

async function request(origin) {
  const started = performance.now();
  const response = await fetch(new URL("/api/health", target), {
    headers: { Origin: origin },
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  return { response, elapsed: performance.now() - started };
}
const times = [];
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const { response } = await request("http://127.0.0.1:5173");
    if (response.status === 200) break;
  } catch {
    // Startup can require a short bounded wait.
  }
  if (attempt === 11) throw new Error("FAIL: local Bun /api/health never became ready");
  await new Promise((done) => setTimeout(done, 250));
}
for (let i = 0; i < 30; i++) {
  const { response, elapsed } = await request("http://127.0.0.1:5173");
  if (
    response.status !== 200 ||
    response.headers.get("cache-control") !== "no-store" ||
    response.headers.get("x-content-type-options") !== "nosniff"
  ) throw new Error("FAIL: local liveness/security headers mismatch");
  const body = await response.json();
  if (body.status !== "ok" || body.databaseConfigured !== false)
    throw new Error("FAIL: local expected no database config");
  times.push(elapsed);
}
const rejected = await request("https://untrusted.example.test");
if (rejected.response.status !== 403 || rejected.response.headers.has("access-control-allow-origin"))
  throw new Error("FAIL: untrusted CORS origin admitted");
times.sort((a, b) => a - b);
const percentile = (fraction) => Number(times[Math.ceil(times.length * fraction) - 1].toFixed(2));
console.log(JSON.stringify({
  kind: "LOCAL_BUN_HTTP_LIVENESS_NOT_DATABASE_READINESS",
  requestCount: times.length,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  corsNegative: "PASS",
  databaseReady: "NOT_VERIFIED",
}, null, 2));
