import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createApp } from "../../../backend/src/app";
import { readConfig } from "../../../backend/src/config/env";
import {
  recoveryStatusPayload,
  verifyRecoveryStatus,
} from "../../../backend/src/features/operations/recovery-status";
import type { RequestContext } from "../../../backend/src/shared/supabase";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const config = readConfig({ ATLAS_CONTROL_OWNER_ID: owner, GEMINI_API_KEY: "synthetic-never-log" });
const request = (path: string) => new Request(`http://127.0.0.1/api/${path}`);

test("readiness coalesces dependency checks and liveness survives their failure", async () => {
  let calls = 0;
  const app = createApp(config, {
    async readiness() {
      calls++;
      throw new Error("internal-credential");
    },
  });
  expect((await app(request("health"))).status).toBe(200);
  expect(calls).toBe(0);
  for (const response of await Promise.all([app(request("ready")), app(request("ready"))])) {
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("X-Request-Id")).toMatch(/^[a-f0-9-]{36}$/);
  }
  expect((await app(request("ready"))).status).toBe(503);
  expect(calls).toBe(1);
});

test("operations snapshot uses owner and MFA and keeps metrics bounded", async () => {
  let userId = other;
  let mfa = false;
  let mfaCalls = 0;
  const app = createApp(config, {
    authenticate: async () =>
      ({
        userId,
        db: {
          rpc: async (name: string) => {
            expect(name).toBe("atlas_control_mfa");
            mfaCalls++;
            return { data: mfa, error: null };
          },
        },
      }) as unknown as RequestContext,
    readiness: async () => ({ database: true, auth: true }),
  });
  expect((await app(request("control/operations"))).status).toBe(403);
  expect(mfaCalls).toBe(0);
  userId = owner;
  expect((await app(request("control/operations"))).status).toBe(403);
  mfa = true;
  expect((await app(request("ready?credential=private-detail"))).status).toBe(200);
  const response = await app(request("control/operations"));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.version).toBe(1);
  expect(data.api.requests).toBe(3);
  expect(data.api.latency).toHaveLength(5);
  expect(data.recovery).toBeNull();
  expect(JSON.stringify(data)).not.toMatch(/private-detail|synthetic-never-log/);
});

test("readiness deadline bounds a non-cooperative dependency and coalesces waiters", async () => {
  let calls = 0;
  const app = createApp(config, {
    readiness: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const responses = await Promise.all([app(request("ready")), app(request("ready"))]);
  expect(responses.map(({ status }) => status)).toEqual([503, 503]);
  expect(calls).toBe(1);
});

test("status transfer rejects stale, altered and foreign observations", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const verifier = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const project = "p".repeat(20);
  const now = Date.now();
  const data = {
    version: 1 as const,
    environment: "pre" as const,
    project,
    observedAt: now,
    lastBackup: now - 1000,
    lastVerification: now - 500,
    backupState: "healthy" as const,
  };
  const signature = sign(null, Buffer.from(recoveryStatusPayload(data)), privateKey).toString(
    "base64",
  );
  const raw = JSON.stringify({ ...data, signature });
  expect(verifyRecoveryStatus(raw, verifier, "pre", project, now)?.backupAgeMs).toBe(1000);
  expect(verifyRecoveryStatus(raw, verifier, "prod", project, now)).toBeNull();
  expect(verifyRecoveryStatus(raw, verifier, "pre", project, now + 900_001)).toBeNull();
  expect(
    verifyRecoveryStatus(
      JSON.stringify({ ...data, backupState: "failed", signature }),
      verifier,
      "pre",
      project,
      now,
    ),
  ).toBeNull();
});

test("signed v2 preserves prior verified age and failed attempt with separate cleanup code", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const project = "q".repeat(20);
  const data = {
    version: 2 as const,
    environment: "pre" as const,
    project,
    observedAt: 300,
    lastBackup: 100,
    lastVerification: 101,
    backupState: "failed" as const,
    lastAttempt: {
      startedAt: 200,
      finishedAt: 210,
      outcome: "failed" as const,
      errorCode: "recovery_capture" as const,
      cleanupCode: "recovery_cleanup" as const,
    },
  };
  const raw = (value: Parameters<typeof recoveryStatusPayload>[0]) =>
    JSON.stringify({
      ...value,
      signature: sign(null, Buffer.from(recoveryStatusPayload(value)), privateKey).toString(
        "base64",
      ),
    });
  expect(verifyRecoveryStatus(raw(data), key, "pre", project, 310)).toMatchObject({
    status: "failed",
    backupAgeMs: 210,
    lastAttempt: data.lastAttempt,
  });
  expect(
    verifyRecoveryStatus(raw({ ...data, backupState: "healthy" }), key, "pre", project, 310),
  ).toBeNull();
  expect(
    verifyRecoveryStatus(
      raw({ ...data, lastAttempt: { ...data.lastAttempt, finishedAt: 190 } }),
      key,
      "pre",
      project,
      310,
    ),
  ).toBeNull();
});
