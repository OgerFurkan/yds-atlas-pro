import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { recoveryPlan } from "./operations.mjs";

const id = /^[a-f0-9]{32}$/;
const sha = /^[a-f0-9]{64}$/;
const project = /^[a-z0-9]{20}$/;
const maxBytes = 16 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scope = ({ environment, project }) => `${environment}:${project}`;
const validIdentity = (one) =>
  ["pre", "prod"].includes(one.environment) &&
  typeof one.project === "string" &&
  project.test(one.project) &&
  typeof one.keyId === "string" &&
  id.test(one.keyId);

function signature(bytes, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("recovery_key");
  return createHmac("sha256", key).update(bytes).digest();
}

function payload(fields) {
  return JSON.stringify([
    1,
    fields.environment,
    fields.project,
    fields.keyId,
    fields.id,
    fields.task,
    fields.completed,
    fields.verified,
    fields.manifest,
    fields.cipherHash,
  ]);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
}

export function verifyBackupReceipt(expected, record, keys, now) {
  if (
    !validIdentity(expected) ||
    !validIdentity(record) ||
    scope(expected) !== scope(record) ||
    typeof record.id !== "string" ||
    !id.test(record.id) ||
    typeof record.task !== "string" ||
    !id.test(record.task) ||
    !validTime(now) ||
    !validTime(record.completed) ||
    !validTime(record.verified) ||
    record.completed > record.verified ||
    record.verified > now ||
    record.version !== 1 ||
    typeof record.manifest !== "string" ||
    !sha.test(record.manifest) ||
    typeof record.cipherHash !== "string" ||
    !sha.test(record.cipherHash) ||
    typeof record.mac !== "string" ||
    !sha.test(record.mac)
  )
    throw new Error("recovery_receipt");
  const key = keys.get(record.keyId);
  if (!key || !timingSafeEqual(signature(payload(record), key), Buffer.from(record.mac, "hex")))
    throw new Error("recovery_receipt");
  return { id: record.id, completed: record.completed, verified: record.verified };
}

export function signBackupReceipt(fields, key) {
  const record = { ...fields, version: 1, mac: signature(payload(fields), key).toString("hex") };
  verifyBackupReceipt(record, record, new Map([[record.keyId, key]]), record.verified);
  return record;
}

// These are the unchanged ImageV2/V7/V8 receipts emitted by Sign-Receipt.
export function verifyLegacyReceipt(record, expectedPrefix, key) {
  if (
    typeof record !== "string" ||
    typeof expectedPrefix !== "string" ||
    record.length > 1024 ||
    !/^[\x20-\x7e\n]+$/.test(record) ||
    !expectedPrefix.endsWith("\n") ||
    !record.startsWith(expectedPrefix)
  )
    throw new Error("independent_trust");
  const tail = /^manifest=([a-f0-9]{64})\nhistory=([a-f0-9]{64})\nmac=([a-f0-9]{64})\n$/.exec(
    record.slice(expectedPrefix.length),
  );
  if (!tail || !timingSafeEqual(signature(record.slice(0, -69), key), Buffer.from(tail[3], "hex")))
    throw new Error("independent_trust");
  return { manifest: tail[1], history: tail[2] };
}

function encrypt(bytes, key, aad) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 1 ||
    bytes.length > maxBytes ||
    !Buffer.isBuffer(key) ||
    key.length !== 32
  )
    throw new Error("recovery_archive");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function verifyArchive(encrypted, key, record) {
  if (
    !Buffer.isBuffer(encrypted) ||
    encrypted.length <= 28 ||
    encrypted.length > maxBytes + 28 ||
    digest(encrypted) !== record.cipherHash
  )
    throw new Error("recovery_archive");
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
  decipher.setAuthTag(encrypted.subarray(12, 28));
  decipher.setAAD(Buffer.from(`${scope(record)}:${record.id}`));
  let first;
  let last;
  try {
    first = decipher.update(encrypted.subarray(28));
    last = decipher.final();
    if (createHash("sha256").update(first).update(last).digest("hex") !== record.manifest)
      throw new Error("recovery_archive");
  } finally {
    first?.fill(0);
    last?.fill(0);
  }
}

// The adapter is selected by the caller. There is no hosted implementation or default enablement.
export function createSyntheticBackup({
  expected,
  keyring,
  acquire,
  snapshot,
  storage,
  clock,
  alert,
  attempts,
}) {
  if (!validIdentity(expected)) throw new Error("recovery_identity");
  // A restartable publisher supplies an atomic, trusted journal scoped like the lock.
  let latest = null;
  const load = async () => {
    if (!attempts) return latest;
    const recorded = (await attempts.read(scope(expected))) ?? null;
    return latest?.outcome === "failed" &&
      (!recorded || latest.finishedAt >= (recorded.finishedAt ?? recorded.startedAt))
      ? latest
      : recorded;
  };
  async function save(attempt) {
    if (attempts) await attempts.write(scope(expected), { ...attempt });
    latest = attempt;
  }

  async function plan(policy) {
    const records = await storage.list();
    if (!Array.isArray(records) || records.length > 10_000) throw new Error("recovery_receipt");
    const now = clock();
    const verified = [];
    // Retention eligibility is reconstructed, never accepted from caller-supplied timestamps.
    for (const record of records) {
      const keys = keyring.get(record.keyId);
      const projected = verifyBackupReceipt(
        expected,
        record,
        new Map([[record.keyId, keys?.receipt]]),
        now,
      );
      verifyArchive(await storage.read(record.id), keys.archive, record);
      verified.push(projected);
    }
    return recoveryPlan(expected, expected, policy, verified, now);
  }

  async function signal(active, observedAt) {
    let result = "unknown";
    for (let count = 0; count < 2; count++) {
      try {
        result = (await alert?.("backup_failed", active, observedAt)) ?? "unknown";
      } catch {
        result = "delivery_failed";
      }
      if (result !== "backpressure" && result !== "delivery_failed") break;
    }
    return result;
  }

  return {
    plan,
    async signedStatus(policy, signingKey) {
      if (signingKey?.asymmetricKeyType !== "ed25519") throw new Error("recovery_status_key");
      const evidence = await plan(policy);
      const observedAt = clock();
      if (!validTime(observedAt)) throw new Error("recovery_clock");
      const attempt = await load();
      const max = policy.maxAttemptMs;
      const expired =
        attempt?.outcome === "running" &&
        Number.isSafeInteger(max) &&
        max > 0 &&
        observedAt - attempt.startedAt > max;
      const lastAttempt = attempt && {
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        outcome: expired ? "interrupted" : attempt.outcome,
        errorCode: expired ? "recovery_interrupted" : attempt.errorCode,
        cleanupCode: attempt.cleanupCode,
      };
      const state =
        !lastAttempt || lastAttempt.outcome === "running"
          ? "unknown"
          : lastAttempt.outcome !== "succeeded"
            ? "failed"
            : evidence.lastBackup === null
              ? "unknown"
              : evidence.overdue
                ? "overdue"
                : "healthy";
      if (
        lastAttempt?.outcome === "succeeded" &&
        evidence.lastBackup !== null &&
        (evidence.lastBackup < lastAttempt.startedAt ||
          evidence.lastBackup > lastAttempt.finishedAt)
      )
        throw new Error("recovery_receipt");
      const status = {
        version: 2,
        environment: expected.environment,
        project: expected.project,
        observedAt,
        lastBackup: evidence.lastBackup,
        lastVerification: evidence.lastVerification,
        backupState: state,
        lastAttempt,
      };
      const message = JSON.stringify([
        status.version,
        status.environment,
        status.project,
        status.observedAt,
        status.lastBackup,
        status.lastVerification,
        status.backupState,
        lastAttempt === null
          ? null
          : [
              lastAttempt.startedAt,
              lastAttempt.finishedAt,
              lastAttempt.outcome,
              lastAttempt.errorCode,
              lastAttempt.cleanupCode,
            ],
      ]);
      return {
        ...status,
        signature: sign(null, Buffer.from(message), signingKey).toString("base64"),
      };
    },
    async run(request) {
      if (
        request.synthetic !== true ||
        !validIdentity(request) ||
        scope(expected) !== scope(request) ||
        request.keyId !== expected.keyId ||
        typeof request.task !== "string" ||
        !id.test(request.task)
      )
        throw new Error("recovery_identity");
      // The deployment adapter must arbitrate across processes/account owners on this scope.
      const release = await acquire(scope(expected));
      if (!release) throw new Error("recovery_busy");
      const operation = randomBytes(16).toString("hex");
      let bytes;
      let failure;
      let result;
      const startedAt = clock();
      const running = {
        startedAt,
        finishedAt: null,
        outcome: "running",
        errorCode: null,
        cleanupCode: null,
      };
      let errorCode = "recovery_journal";
      try {
        const previous = await load();
        if (!validTime(startedAt) || (previous && startedAt < previous.startedAt))
          throw new Error("recovery_clock");
        await save(running);
        errorCode = "recovery_capture";
        const captured = await snapshot({
          ...expected,
          task: request.task,
          operation,
          synthetic: true,
        });
        bytes = captured.bytes;
        errorCode = "recovery_manifest";
        if (!Buffer.isBuffer(bytes) || captured.manifest !== digest(bytes))
          throw new Error("recovery_manifest");
        errorCode = "recovery_stage";
        const keys = keyring.get(expected.keyId);
        if (!keys || !Buffer.isBuffer(keys.receipt) || keys.receipt.equals(keys.archive))
          throw new Error("recovery_key");
        const encrypted = encrypt(bytes, keys.archive, `${scope(expected)}:${operation}`);
        const completed = clock();
        await storage.stage(operation, encrypted);
        const receipt = signBackupReceipt(
          {
            ...expected,
            id: operation,
            task: request.task,
            completed,
            verified: clock(),
            manifest: captured.manifest,
            cipherHash: digest(encrypted),
          },
          keys.receipt,
        );
        errorCode = "recovery_integrity";
        verifyArchive(await storage.readStaged(operation), keys.archive, receipt);
        // The adapter must atomically publish the signed receipt and encrypted object.
        errorCode = "recovery_publish";
        await storage.publish(operation, receipt);
        errorCode = "recovery_journal";
        const finishedAt = clock();
        await save({ ...running, outcome: "succeeded", finishedAt });
        result = {
          id: operation,
          completed,
          verified: receipt.verified,
          alert: await signal(false, finishedAt),
          alertAt: finishedAt,
        };
      } catch {
        let cleanupCode = null;
        try {
          await storage.discardStaged(operation);
        } catch {
          cleanupCode = "recovery_cleanup";
        }
        const finishedAt = clock();
        const failed = { ...running, outcome: "failed", finishedAt, errorCode, cleanupCode };
        let journalCode = null;
        try {
          await save(failed);
        } catch {
          journalCode = "recovery_journal";
          latest = failed;
        }
        const alert = await signal(true, finishedAt);
        failure = Object.assign(new Error("recovery_publication"), {
          code: errorCode,
          alertAt: finishedAt,
          cleanupCode,
          journalCode,
          alert,
        });
      } finally {
        if (Buffer.isBuffer(bytes)) bytes.fill(0);
        try {
          await release();
        } catch {
          (failure ?? result).releaseCode = "recovery_unlock";
        }
      }
      if (failure) throw failure;
      return result;
    },
  };
}

// Current state is asserted by an independent authority with a monotonic floor from outside the archive.
export function checkDeletionWitness(expected, actual, floor, key) {
  const message = (one) =>
    JSON.stringify([1, one.environment, one.project, one.sequence, one.head]);
  if (
    !validIdentity(expected) ||
    !actual ||
    scope(expected) !== scope(actual) ||
    !Number.isSafeInteger(actual.sequence) ||
    actual.sequence < 0 ||
    !Number.isSafeInteger(floor) ||
    floor < 0 ||
    actual.sequence !== floor ||
    typeof actual.head !== "string" ||
    !sha.test(actual.head) ||
    typeof actual.mac !== "string" ||
    !sha.test(actual.mac) ||
    !timingSafeEqual(signature(message(actual), key), Buffer.from(actual.mac, "hex"))
  )
    throw new Error("deletion_witness");
  return actual.head;
}

export function releaseDecision(currentSchema, previousApp, proposedApp) {
  const supports = (app) =>
    Number.isSafeInteger(app.minSchema) &&
    Number.isSafeInteger(app.maxSchema) &&
    app.minSchema <= currentSchema &&
    app.maxSchema >= currentSchema;
  if (!Number.isSafeInteger(currentSchema) || currentSchema < 0) throw new Error("release_schema");
  if (supports(proposedApp)) return { action: "deploy", restore: false };
  if (supports(previousApp)) return { action: "rollback_application", restore: false };
  return { action: "forward_fix", restore: false };
}
