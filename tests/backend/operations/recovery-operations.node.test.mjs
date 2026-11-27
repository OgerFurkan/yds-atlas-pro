import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  createAlertDelivery,
  recoverTrustKey,
  recoveryPlan,
  sealTrustKey,
} from "../../../scripts/quality/atlas-recovery/operations.mjs";

import {
  checkDeletionWitness,
  createSyntheticBackup,
  releaseDecision,
  signBackupReceipt,
  verifyLegacyReceipt,
} from "../../../scripts/quality/atlas-recovery/publication.mjs";

const identity = { environment: "prod", project: "a".repeat(20), keyId: "b".repeat(32) };

test("portable trust decrypts in a distinct process and rejects wrong custody or ciphertext", () => {
  const key = randomBytes(32);
  const phrase = randomBytes(36);
  const envelope = sealTrustKey(identity, key, phrase);
  const fields = {
    ...identity,
    id: "1".repeat(32),
    task: "2".repeat(32),
    completed: 5,
    verified: 6,
    manifest: "a".repeat(64),
    cipherHash: "b".repeat(64),
  };
  const receipt = signBackupReceipt(fields, key);
  const prefix = `atlas-recovery-v8\npackage=${fields.id}\nsource=synthetic-${fields.task}\n`;
  const body = `${prefix}manifest=${fields.manifest}\nhistory=${"c".repeat(64)}\n`;
  const legacy = `${body}mac=${createHmac("sha256", key).update(body).digest("hex")}\n`;
  assert.equal(verifyLegacyReceipt(legacy, prefix, key).manifest, fields.manifest);
  const code = `import { readFileSync } from "node:fs";
    import { recoverTrustKey } from ${JSON.stringify(new URL("../../../scripts/quality/atlas-recovery/operations.mjs", import.meta.url).href)};
    import { verifyBackupReceipt, verifyLegacyReceipt } from ${JSON.stringify(new URL("../../../scripts/quality/atlas-recovery/publication.mjs", import.meta.url).href)};
    const { identity, envelope, receipt, phrase, legacy, prefix } = JSON.parse(readFileSync(0, "utf8"));
    const passphrase = Buffer.from(phrase, "hex");
    const key = recoverTrustKey(identity, envelope, passphrase);
    try { verifyBackupReceipt(identity, receipt, new Map([[identity.keyId, key]]), 10); verifyLegacyReceipt(legacy,prefix,key); }
    finally { key.fill(0); passphrase.fill(0); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    timeout: 15_000,
    encoding: "utf8",
    input: JSON.stringify({
      identity,
      envelope,
      receipt,
      legacy,
      prefix,
      phrase: phrase.toString("hex"),
    }),
  });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, "");
  assert.throws(
    () => recoverTrustKey({ ...identity, environment: "pre" }, envelope, phrase),
    /recovery_identity/,
  );
  assert.throws(
    () => recoverTrustKey({ ...identity, keyId: "d".repeat(32) }, envelope, phrase),
    /recovery_identity/,
  );
  assert.throws(
    () => recoverTrustKey(identity, envelope, randomBytes(36)),
    /recovery_authentication/,
  );
  const last = envelope.endsWith("0") ? "1" : "0";
  assert.throws(
    () => recoverTrustKey(identity, envelope.slice(0, -1) + last, phrase),
    /recovery_authentication/,
  );
  key.fill(0);
  phrase.fill(0);
});

test("retention dry-run protects the last good package and rejects mismatched project", () => {
  const records = [
    { id: "1".repeat(32), completed: 100, verified: 980 },
    { id: "2".repeat(32), completed: 500, verified: 501 },
  ];
  const plan = { intervalMs: 100, retentionMs: 300, retainAtLeast: 1 };
  const result = recoveryPlan(identity, identity, plan, records, 1000);
  assert.deepEqual(result, {
    lastBackup: 500,
    lastVerification: 980,
    overdue: true,
    dryRunCandidates: [records[0].id],
  });
  assert.throws(
    () => recoveryPlan(identity, { ...identity, project: "x".repeat(20) }, plan, records, 1000),
    /recovery_identity/,
  );
  assert.throws(
    () => recoveryPlan(identity, identity, plan, [...records, records[0]], 1000),
    /recovery_receipt/,
  );
  assert.equal(records.length, 2);
});

test("alarm deduplicates, emits recovery and retries a failed mock delivery", async () => {
  const delivered = [];
  let unavailable = true;
  const signal = createAlertDelivery("prod", 500, async (event) => {
    if (unavailable) throw new Error("mock unavailable");
    delivered.push(event);
  });
  assert.equal(await signal("integrity", true, 1000), "delivery_failed");
  unavailable = false;
  assert.equal(await signal("integrity", true, 1100), "delivered");
  assert.equal(await signal("integrity", true, 1200), "deduplicated");
  assert.equal(await signal("integrity", false, 1300), "delivered");
  assert.equal(await signal("integrity", false, 1400), "unchanged");
  assert.deepEqual(
    delivered.map((event) => event.status),
    ["active", "recovered"],
  );
  assert.equal(delivered[0].severity, "critical");
  assert.notEqual(delivered[0].correlationId, delivered[1].correlationId);
});

test("scoped publication verifies archive, rejects partial publication and preserves old key", async () => {
  const held = new Set();
  const staged = new Map();
  const packages = new Map();
  const migrated = { ...identity, keyId: "d".repeat(32) };
  const entries = [identity, migrated].map(({ keyId }) => [
    keyId,
    { receipt: randomBytes(32), archive: randomBytes(32) },
  ]);
  const keyring = new Map(entries);
  let fail,
    now = 10,
    capture,
    releaseCapture;
  const storage = {
    list: () => [...packages.values()].map(({ receipt }) => receipt),
    read: (id) => packages.get(id)?.archive,
    stage(id, buffer) {
      staged.set(id, buffer);
      if (fail === "disk") throw new Error("synthetic ENOSPC");
    },
    readStaged(id) {
      return fail === "partial" ? staged.get(id).subarray(0, 10) : staged.get(id);
    },
    publish(id, receipt) {
      if (fail === "event") throw new Error("synthetic receipt failure");
      packages.set(id, { receipt, archive: staged.get(id) });
      staged.delete(id);
    },
    discardStaged(id) {
      staged.delete(id);
    },
  };
  const events = [];
  const alert = createAlertDelivery("prod", 50, async (event) => events.push(event));
  const base = {
    keyring,
    clock: () => now,
    storage,
    alert,
    acquire(scope) {
      if (held.has(scope)) return null;
      held.add(scope);
      return () => held.delete(scope);
    },
    async snapshot() {
      if (capture) await capture;
      if (fail === "interrupt") throw new Error("synthetic interrupted capture");
      const bytes = Buffer.from("synthetic archive material");
      return {
        bytes,
        manifest:
          fail === "manifest" ? "invalid" : createHash("sha256").update(bytes).digest("hex"),
      };
    },
  };
  const request = { ...identity, synthetic: true, task: "2".repeat(32) };
  const first = createSyntheticBackup({ ...base, expected: identity });
  const rotated = createSyntheticBackup({ ...base, expected: migrated });
  const policy = { intervalMs: 25, retentionMs: 50, retainAtLeast: 1 };
  const original = await first.run(request);
  now = 100;
  for (const mode of ["disk", "partial", "event", "interrupt", "manifest"]) {
    fail = mode;
    await assert.rejects(rotated.run({ ...request, ...migrated }), /recovery_publication/);
    assert.equal(staged.size, 0);
    assert.equal(packages.size, 1);
    assert.deepEqual((await rotated.plan(policy)).dryRunCandidates, []);
  }
  fail = undefined;
  capture = new Promise((r) => {
    releaseCapture = r;
  });
  const running = rotated.run({ ...request, ...migrated });
  await assert.rejects(first.run({ ...request, task: "3".repeat(32) }), /recovery_busy/);
  releaseCapture();
  await running;
  await assert.rejects(
    rotated.run({ ...request, ...migrated, project: "x".repeat(20) }),
    /recovery_identity/,
  );
  assert.deepEqual((await rotated.plan(policy)).dryRunCandidates, [original.id]);
  assert.deepEqual(
    events.map(({ status }) => status),
    ["active", "recovered"],
  );
  const old = packages.get(original.id);
  const valid = old.receipt;
  old.receipt = { ...valid, verified: 101 };
  await assert.rejects(rotated.plan(policy), /recovery_receipt/);
  old.receipt = valid;
  old.archive[29] ^= 1;
  await assert.rejects(rotated.plan(policy), /recovery_archive/);
});

test("alarm preserves both directions of overlapping transitions and bounds queued work", async () => {
  const statuses = [];
  let unblock;
  const signal = createAlertDelivery("prod", 50, async (e) => {
    statuses.push(e.status);
    if (statuses.length <= 2)
      await new Promise((r) => {
        unblock = r;
      });
  });
  const active = signal("backup_failed", true, 100);
  await new Promise(setImmediate);
  assert.equal(await signal("backup_failed", true, 101), "deduplicated");
  assert.equal(await signal("backup_failed", false, 102), "queued");
  assert.equal(await signal("backup_failed", true, 103), "backpressure");
  unblock();
  await new Promise(setImmediate);
  assert.equal(await signal("backup_failed", true, 104), "queued");
  unblock();
  assert.equal(await active, "delivered");
  assert.deepEqual(statuses, ["active", "recovered", "active"]);
});

test("timeout allows retry after restart using the retained correlation ID", async () => {
  let checkpoint, id;
  const signal = createAlertDelivery(
    "prod",
    50,
    (event, signal) =>
      new Promise((_, reject) => {
        id = event.correlationId;
        signal.addEventListener("abort", () => reject(new Error("mock deadline")), { once: true });
      }),
    {
      timeoutMs: 25,
      save(value) {
        checkpoint = value;
      },
    },
  );
  assert.equal(await signal("restore_failed", true, 100), "delivery_failed");
  const resumed = createAlertDelivery(
    "prod",
    50,
    async (event) => assert.equal(event.correlationId, id),
    {
      restored: [checkpoint],
      save(value) {
        checkpoint = value;
      },
    },
  );
  assert.equal(await resumed("restore_failed", true, 130), "delivered");
  assert.equal(checkpoint.pending.length, 0);
});

test("independent monotonic observation rejects stale or foreign witnesses", () => {
  const key = randomBytes(32);
  const witness = (sequence, source) => {
    const { environment, project } = source;
    const head = "c".repeat(64);
    const mac = createHmac("sha256", key)
      .update(JSON.stringify([1, environment, project, sequence, head]))
      .digest("hex");
    return { environment, project, sequence, head, mac };
  };
  assert.equal(checkDeletionWitness(identity, witness(2, identity), 2, key), "c".repeat(64));
  assert.throws(
    () => checkDeletionWitness(identity, witness(1, identity), 2, key),
    /deletion_witness/,
  );
  assert.throws(() => checkDeletionWitness(identity, null, 2, key), /deletion_witness/);
  assert.throws(
    () => checkDeletionWitness(identity, witness(2, { ...identity, environment: "pre" }), 2, key),
    /deletion_witness/,
  );
});

test("release fallback preserves writes and never requests database restore", () => {
  const v1 = { minSchema: 1, maxSchema: 3 };
  const v2 = { minSchema: 3, maxSchema: 4 };
  assert.deepEqual(releaseDecision(3, v1, v2), { action: "deploy", restore: false });
  assert.deepEqual(releaseDecision(2, v1, v2), { action: "rollback_application", restore: false });
  assert.deepEqual(releaseDecision(5, v1, v2), { action: "forward_fix", restore: false });
});

test("last attempt remains failed after cleanup failure and restart while old archive remains valid", async () => {
  const keys = { receipt: randomBytes(32), archive: randomBytes(32) };
  const keyring = new Map([[identity.keyId, keys]]);
  const { privateKey } = generateKeyPairSync("ed25519");
  const evidence = new Map();
  const staged = new Map();
  let now = 100,
    job = null,
    fail = false;
  const signalResults = [];
  const config = {
    expected: identity,
    keyring,
    clock: () => now,
    acquire: () => () => {},
    attempts: {
      read: () => job,
      write(_scope, record) {
        job = { ...record };
      },
    },
    snapshot() {
      const bytes = Buffer.from("valid synthetic archive");
      if (fail) throw new Error("sensitive-storage-error");
      return { bytes, manifest: createHash("sha256").update(bytes).digest("hex") };
    },
    storage: {
      list: () => [...evidence.values()].map(({ record }) => record),
      read: (id) => evidence.get(id)?.archive,
      stage(id, archive) {
        staged.set(id, archive);
      },
      readStaged: (id) => staged.get(id),
      publish(id, record) {
        evidence.set(id, { record, archive: staged.get(id) });
        staged.delete(id);
      },
      discardStaged() {
        throw new Error("sensitive-cleanup-error");
      },
    },
    alert(_kind, active, at) {
      signalResults.push([active, at]);
      return active
        ? signalResults.length === 2
          ? "backpressure"
          : "delivery_failed"
        : "delivered";
    },
  };
  const req = { ...identity, synthetic: true, task: "9".repeat(32) };
  const policy = { intervalMs: 100, retentionMs: 200, retainAtLeast: 1, maxAttemptMs: 50 };
  const coordinator = createSyntheticBackup(config);
  const committed = await coordinator.run(req);
  assert.equal((await coordinator.signedStatus(policy, privateKey)).backupState, "healthy");
  fail = true;
  now = 115;
  await assert.rejects(coordinator.run(req), (error) => {
    assert.equal(error.code, "recovery_capture");
    assert.equal(error.cleanupCode, "recovery_cleanup");
    assert.equal(error.alert, "delivery_failed");
    assert.equal(error.alertAt, 115);
    assert.doesNotMatch(JSON.stringify(error), /sensitive/);
    return true;
  });
  assert.deepEqual(signalResults, [
    [false, 100],
    [true, 115],
    [true, 115],
  ]);
  assert.deepEqual([...evidence.keys()], [committed.id]);
  const reopened = createSyntheticBackup(config);
  const status = await reopened.signedStatus(policy, privateKey);
  assert.equal(status.version, 2);
  assert.equal(status.backupState, "failed");
  assert.equal(status.lastBackup, 100);
  assert.equal(status.lastVerification, 100);
  assert.deepEqual(status.lastAttempt, {
    startedAt: 115,
    finishedAt: 115,
    outcome: "failed",
    errorCode: "recovery_capture",
    cleanupCode: "recovery_cleanup",
  });
  job = {
    startedAt: 120,
    finishedAt: null,
    outcome: "running",
    errorCode: null,
    cleanupCode: null,
  };
  now = 171;
  const interrupted = await reopened.signedStatus(policy, privateKey);
  assert.equal(interrupted.lastAttempt.outcome, "interrupted");
  assert.equal(interrupted.lastAttempt.finishedAt, null);
  assert.equal(interrupted.backupState, "failed");
});

test("recovered watermark rejects late active events including after restart", async () => {
  let checkpoint;
  const delivered = [];
  const sink = async (event) => delivered.push(event.status);
  const opts = {
    save(value) {
      checkpoint = value;
    },
  };
  const signal = createAlertDelivery("prod", 50, sink, opts);
  assert.equal(await signal("integrity", true, 100), "delivered");
  assert.equal(await signal("integrity", false, 200), "delivered");
  assert.equal(checkpoint.watermark, 200);
  assert.equal(await signal("integrity", true, 150), "stale");
  const reopened = createAlertDelivery("prod", 50, sink, { ...opts, restored: [checkpoint] });
  assert.equal(await reopened("integrity", true, 190), "stale");
  assert.deepEqual(delivered, ["active", "recovered"]);
  assert.equal(await reopened("integrity", true, 201), "delivered");
});

test("healthy observations order alarms even without a transition and across restart", async () => {
  let checkpoint;
  const seen = [];
  const save = (record) => {
    checkpoint = record;
  };
  const send = async (event) => {
    seen.push(event.status);
  };
  let signal = createAlertDelivery("prod", 50, send, { save });
  assert.equal(await signal("integrity", false, 100), "unchanged");
  assert.equal(await signal("integrity", true, 90), "stale");
  assert.equal(await signal("integrity", true, 110), "delivered");
  assert.equal(await signal("integrity", false, 120), "delivered");
  assert.equal(await signal("integrity", false, 150), "unchanged");
  assert.equal(checkpoint.watermark, 150);
  signal = createAlertDelivery("prod", 50, send, { save, restored: [checkpoint] });
  assert.equal(await signal("integrity", true, 140), "stale");
  assert.deepEqual(seen, ["active", "recovered"]);
});
test("in-flight recovery deduplicates healthy observations and retains the newer watermark", async () => {
  let checkpoint, release;
  const signal = createAlertDelivery(
    "prod",
    10,
    async ({ status }) => {
      if (status === "recovered")
        await new Promise((resolve) => {
          release = resolve;
        });
    },
    {
      save(value) {
        checkpoint = value;
      },
    },
  );
  await signal("integrity", true, 100);
  const recovering = signal("integrity", false, 110);
  await new Promise(setImmediate);
  assert.equal(await signal("integrity", false, 140), "deduplicated");
  assert.equal(await signal("integrity", true, 130), "stale");
  release();
  assert.equal(await recovering, "delivered");
  assert.equal(checkpoint.watermark, 140);
});
