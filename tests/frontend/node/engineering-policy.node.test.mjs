import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readRuntimeConfig } from "../../../backend/src/config/env.ts";
import { assertPublicEnvironment } from "../../../frontend/config/public-env.ts";
import { credentialKinds, workflowIssues } from "../../../scripts/quality/engineering-policy.mjs";
import {
  browserSummary,
  commandStatus,
  redact,
  sourcePaths,
  syntheticEnv,
} from "../../../scripts/quality/run-policy.mjs";

test("quality evidence fails for an unexpected skip, retry or nonzero command", () => {
  const result = {
    status: "expected",
    expectedStatus: "passed",
    projectName: "desktop",
    projectId: "desktop",
    results: [{ status: "passed" }],
  };
  const report = (entry) => ({
    config: { projects: [{ id: "desktop" }] },
    stats: { expected: 1, skipped: 0, flaky: 0, unexpected: 0 },
    suites: [
      {
        title: "suite",
        specs: [{ id: "spec", file: "sample.spec.ts", title: "Ordinary test", tests: [entry] }],
      },
    ],
  });
  const discovery = report(result);
  assert.equal(
    browserSummary(report(result), "cloud-browser", discovery),
    "1 passed, 0 explicit viewport skips",
  );
  for (const invalid of [
    report({ ...result, status: "skipped" }),
    report({ ...result, results: [{ status: "failed" }, { status: "passed" }] }),
    { ...report(result), stats: { ...report(result).stats, expected: 151 } },
    { ...report(result), suites: [] },
    { ...report(result), config: { projects: [{ id: "desktop" }, { id: "tablet" }] } },
  ])
    assert.throws(() => browserSummary(invalid, "cloud-browser", discovery), /Browser|browser/);
  assert.equal(commandStatus(7, true, false), "FAIL");
  assert.equal(commandStatus(0, false, false), "FAIL");
  assert.equal(commandStatus(0, true, true), "FAIL");
});

test("workflow and credential checks reject unsafe fixtures without echoing credentials", () => {
  const clean = `on: pull_request\npermissions: {contents: read}\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n        with: {persist-credentials: false}\n`;
  assert.deepEqual(workflowIssues(clean), []);
  assert.ok(
    workflowIssues(clean.replace("a".repeat(40), "v4")).includes(
      "third-party action must use a full SHA",
    ),
  );
  assert.ok(
    workflowIssues(clean.replace("on: pull_request", "on: pull_request_target")).includes(
      "privileged workflow feature requires separate review",
    ),
  );
  assert.ok(
    workflowIssues(
      clean.replace("    steps:", "    permissions: { contents: write }\n    steps:"),
    ).includes("job permissions exceed contents: read"),
  );
  assert.ok(
    workflowIssues(clean.replace("false", "true")).includes(
      "checkout credentials must be disabled",
    ),
  );
  const key = "sb_" + "secret_" + "a".repeat(24);
  assert.deepEqual(credentialKinds(key), ["Supabase key"]);
  assert.equal(redact(key), "[redacted]");
  assert.deepEqual(
    syntheticEnv({ PATH: "local", SUPABASE_SECRET_KEY: key, VITE_API_URL: "external" }),
    { PATH: "local" },
  );
  assert.deepEqual(sourcePaths(["backend/.env", "backend/.env.example", "bun.lock"]), [
    "backend/.env.example",
    "bun.lock",
  ]);
});

test("runtime environment allows guest LOCAL and rejects invalid hosted identity", () => {
  assert.equal(readRuntimeConfig({}).HOST, "127.0.0.1");
  assert.throws(() => readRuntimeConfig({ NODE_ENV: "production" }), /ATLAS_ENV/);
  assert.throws(
    () => readRuntimeConfig({ SUPABASE_URL: "https://fixture.invalid" }),
    /SUPABASE_URL/,
  );
  assert.throws(() => readRuntimeConfig({ ATLAS_ENV: "local", HOST: "0.0.0.0" }), /HOST/);
  const deployment = (mode) => ({
    web: `https://web.${mode}.invalid`,
    api: `https://api.${mode}.invalid`,
    supabase: `https://${mode}project.supabase.co`,
    assessment: {
      host: "region.pooler.supabase.com",
      port: 5432,
      user: `atlas_assessment_api.${mode}project`,
    },
  });
  const identities = { pre: deployment("pre"), prod: deployment("prod") };
  const config = JSON.stringify(identities);
  const pre = {
    ATLAS_ENV: "pre",
    ATLAS_HOSTED_IDENTITIES: config,
    APP_ORIGINS: identities.pre.web,
    SUPABASE_URL: identities.pre.supabase,
    SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
    SUPABASE_ASSESSMENT_DATABASE_URL:
      "postgres://atlas_assessment_api.preproject@region.pooler.supabase.com/postgres?sslmode=verify-full",
  };
  assert.equal(readRuntimeConfig(pre).SUPABASE_URL, pre.SUPABASE_URL);
  const browser = {
    ATLAS_HOSTED_IDENTITIES: config,
    VITE_ATLAS_ENV: "pre",
    VITE_SUPABASE_URL: pre.SUPABASE_URL,
    VITE_API_URL: identities.pre.api,
    VITE_SUPABASE_PUBLISHABLE_KEY: pre.SUPABASE_PUBLISHABLE_KEY,
  };
  assert.doesNotThrow(() => assertPublicEnvironment(browser));
  for (const invalid of [
    { APP_ORIGINS: identities.prod.web },
    { SUPABASE_URL: identities.prod.supabase },
    {
      SUPABASE_ASSESSMENT_DATABASE_URL: pre.SUPABASE_ASSESSMENT_DATABASE_URL.replace(
        "preproject",
        "prodproject",
      ),
    },
    {
      SUPABASE_ASSESSMENT_DATABASE_URL: pre.SUPABASE_ASSESSMENT_DATABASE_URL.replace(
        "verify-full",
        "require",
      ),
    },
    {
      SUPABASE_ASSESSMENT_DATABASE_URL:
        pre.SUPABASE_ASSESSMENT_DATABASE_URL + "&host=db.other.invalid",
    },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { ATLAS_HOSTED_IDENTITIES: JSON.stringify({ pre: identities.pre, prod: identities.pre }) },
  ])
    assert.throws(
      () => readRuntimeConfig({ ...pre, ...invalid }),
      /binding|ATLAS_HOSTED_IDENTITIES/,
    );
  assert.throws(
    () => assertPublicEnvironment({ ...browser, VITE_API_URL: identities.prod.api }),
    /VITE_API_URL/,
  );
  assert.throws(
    () => assertPublicEnvironment({ ...browser, VITE_SUPABASE_URL: identities.prod.supabase }),
    /VITE_SUPABASE_URL/,
  );
  assert.doesNotThrow(() => assertPublicEnvironment({}));
  assert.throws(
    () => assertPublicEnvironment({ VITE_SUPABASE_URL: "https://fixture.invalid" }),
    /VITE_SUPABASE_URL/,
  );
});

test("LOCAL API releases its port and fails closed when another process owns it", {
  timeout: 15_000,
}, async () => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  const cwd = new URL("../../../backend/", import.meta.url);
  const start = () =>
    spawn("bun", ["--no-install", "--no-env-file", "src/index.ts"], {
      cwd,
      env: { ...syntheticEnv(process.env), PORT: String(port) },
      stdio: "ignore",
    });
  let service;
  try {
    const conflicting = start();
    const [code] = await once(conflicting, "exit");
    assert.notEqual(code, 0);
    await new Promise((resolve, reject) =>
      socket.close((error) => (error ? reject(error) : resolve())),
    );
    service = start();
    let healthy = false;
    for (let count = 0; count < 40 && !healthy; count++) {
      try {
        healthy = (
          await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(250) })
        ).ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(healthy);
  } finally {
    if (socket.listening) socket.close();
    if (service && service.exitCode === null) {
      const exiting = once(service, "exit");
      service.kill("SIGTERM");
      await exiting;
    }
  }
  const probe = createServer();
  probe.listen(port, "127.0.0.1");
  await once(probe, "listening");
  await new Promise((resolve) => probe.close(resolve));
});

test("Node file placeholders cannot satisfy the test inventory", () => {
  const temp = mkdtempSync(join(tmpdir(), "atlas-node-inventory-"));
  const empty = join(temp, "empty.node.test.mjs");
  writeFileSync(empty, "export {};\n");
  const entry = fileURLToPath(
    new URL("../../../scripts/quality/node-inventory.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [entry, join(temp, "result.json"), empty], {
    env: syntheticEnv(process.env),
    timeout: 5000,
    windowsHide: true,
  });
  assert.equal(result.status, 1);
});
