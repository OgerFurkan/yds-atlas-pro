import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const version = "atlas-trust-v1";
const iterations = 600_000;
const projectPattern = /^[a-z0-9]{20}$/;
const keyIdPattern = /^[a-f0-9]{32}$/;

function validateIdentity({ environment, project, keyId }) {
  if (
    !["pre", "prod"].includes(environment) ||
    !projectPattern.test(project) ||
    !keyIdPattern.test(keyId)
  )
    throw new Error("recovery_identity");
  return [version, environment, project, keyId];
}

function derive(passphrase, salt) {
  if (!Buffer.isBuffer(passphrase) || passphrase.length < 24 || passphrase.length > 1024)
    throw new Error("recovery_passphrase");
  return pbkdf2Sync(passphrase, salt, iterations, 32, "sha256");
}

export function sealTrustKey(identity, key, passphrase) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("recovery_key");
  const identityFields = validateIdentity(identity);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const derived = derive(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", derived, iv);
    cipher.setAAD(Buffer.from(identityFields.join("|")));
    const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
    return [...identityFields, salt, iv, encrypted, cipher.getAuthTag()]
      .map((field) => (Buffer.isBuffer(field) ? field.toString("hex") : field))
      .join("|");
  } finally {
    derived.fill(0);
  }
}

export function recoverTrustKey(expected, envelope, passphrase) {
  const identityFields = validateIdentity(expected);
  if (typeof envelope !== "string" || envelope.length > 256) throw new Error("recovery_envelope");
  const fields = envelope.split("|");
  if (fields.length !== 8 || !identityFields.every((field, index) => field === fields[index]))
    throw new Error("recovery_identity");
  const expectedLengths = [32, 24, 64, 32];
  const values = fields.slice(4).map((value, index) => {
    if (value.length !== expectedLengths[index] || !/^[a-f0-9]+$/.test(value))
      throw new Error("recovery_envelope");
    return Buffer.from(value, "hex");
  });
  const [salt, iv, encrypted, tag] = values;
  const derived = derive(passphrase, salt);
  let partial;
  try {
    const decipher = createDecipheriv("aes-256-gcm", derived, iv);
    decipher.setAAD(Buffer.from(identityFields.join("|")));
    decipher.setAuthTag(tag);
    partial = decipher.update(encrypted);
    return Buffer.concat([partial, decipher.final()]);
  } catch {
    throw new Error("recovery_authentication");
  } finally {
    partial?.fill(0);
    derived.fill(0);
  }
}

export function recoveryPlan(expected, target, policy, receipts, now) {
  validateIdentity(expected);
  validateIdentity(target);
  if (
    expected.environment !== target.environment ||
    expected.project !== target.project ||
    expected.keyId !== target.keyId
  )
    throw new Error("recovery_identity");
  const { intervalMs, retentionMs, retainAtLeast } = policy;
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isSafeInteger(retentionMs) ||
    retentionMs < intervalMs ||
    !Number.isSafeInteger(retainAtLeast) ||
    retainAtLeast < 1 ||
    receipts.length > 10_000
  )
    throw new Error("recovery_policy");
  const ids = new Set();
  for (const { id, completed, verified } of receipts) {
    if (
      !keyIdPattern.test(id) ||
      ids.has(id) ||
      !Number.isSafeInteger(completed) ||
      completed > now ||
      !Number.isSafeInteger(verified) ||
      verified < completed ||
      verified > now
    )
      throw new Error("recovery_receipt");
    ids.add(id);
  }
  // Input must already have passed manifest and independent receipt authentication.
  const ordered = [...receipts].sort(
    (a, b) => b.completed - a.completed || a.id.localeCompare(b.id),
  );
  return {
    lastBackup: ordered[0]?.completed ?? null,
    lastVerification: ordered.length ? Math.max(...ordered.map(({ verified }) => verified)) : null,
    overdue: !ordered.length || now - ordered[0].completed > intervalMs,
    dryRunCandidates: ordered
      .slice(retainAtLeast)
      .filter((one) => now - one.completed > retentionMs)
      .map(({ id }) => id),
  };
}

const severities = {
  backup_failed: "high",
  backup_overdue: "high",
  restore_failed: "critical",
  integrity: "critical",
  service_down: "critical",
  database_down: "critical",
  api_errors: "high",
  latency: "warning",
  capacity: "warning",
  provider: "high",
  security: "critical",
};

export function createAlertDelivery(environment, cooldownMs, deliver, options = {}) {
  const { timeoutMs = 5000, restored = [], save } = options;
  if (
    !["pre", "prod"].includes(environment) ||
    !Number.isSafeInteger(cooldownMs) ||
    cooldownMs < 1 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000 ||
    !Array.isArray(restored) ||
    restored.length > Object.keys(severities).length
  )
    throw new Error("alert_policy");
  const states = new Map();
  const event = (kind, active, at, id = randomBytes(16).toString("hex")) => ({
    version: 1,
    environment,
    severity: severities[kind],
    kind,
    status: active ? "active" : "recovered",
    timestamp: new Date(at).toISOString(),
    correlationId: id,
  });
  const validTime = (at) => Number.isSafeInteger(at) && at >= 0 && at <= 8.64e15;
  for (const { version, environment: source, kind, sentAt, pending, watermark } of restored) {
    if (
      ![1, 2].includes(version) ||
      source !== environment ||
      !Object.hasOwn(severities, kind) ||
      states.has(kind) ||
      (sentAt !== null && !validTime(sentAt)) ||
      !Array.isArray(pending) ||
      pending.length > 2 ||
      pending.some(
        ({ active, at, id }) =>
          typeof active !== "boolean" || !validTime(at) || !keyIdPattern.test(id),
      )
    )
      throw new Error("alert_checkpoint");
    const latestEvent = Math.max(sentAt ?? -1, ...pending.map(({ at }) => at));
    const seenAt = version === 2 ? watermark : latestEvent;
    // An empty v1 checkpoint cannot prove when a recovery signal last arrived.
    if (
      !validTime(seenAt) ||
      seenAt < latestEvent ||
      pending.some(({ at }, index) => index > 0 && at < pending[index - 1].at)
    )
      throw new Error("alert_checkpoint");
    states.set(kind, {
      sentAt,
      seenAt,
      queue: pending.map((item) => ({ ...item })),
      running: false,
    });
  }
  // Persist each kind independently. The sink deduplicates by correlation ID
  // if acknowledgement or checkpointing is interrupted after delivery.
  const persist = (kind, sentAt, queue, watermark) =>
    save?.({
      version: 2,
      environment,
      kind,
      sentAt,
      watermark,
      pending: queue.map(({ active, at, id }) => ({ active, at, id })),
    });
  return async (kind, active, now) => {
    if (!Object.hasOwn(severities, kind) || typeof active !== "boolean" || !validTime(now))
      throw new Error("alert_signal");
    const state = states.get(kind) ?? { sentAt: null, seenAt: -1, queue: [], running: false };
    states.set(kind, state);
    if (now < state.seenAt) return "stale";
    const before = state.seenAt;
    const tail = state.queue.at(-1);
    function observeHealthy(result) {
      if (active || now <= state.seenAt) return result;
      try {
        persist(kind, state.sentAt, state.queue, now);
        state.seenAt = now;
        return result;
      } catch {
        return "delivery_failed";
      }
    }
    if (state.running && tail?.active === active) return observeHealthy("deduplicated");
    if (tail?.active !== active) {
      if (!tail && !active && state.sentAt === null) return observeHealthy("unchanged");
      if (!tail && active && state.sentAt !== null && now - state.sentAt < cooldownMs)
        return "deduplicated";
      if (state.queue.length >= 2) return "backpressure";
      state.seenAt = now;
      state.queue.push({ active, at: now, id: randomBytes(16).toString("hex") });
    }
    if (state.running) {
      try {
        // The checkpoint writer is synchronous and atomically replaces the record per kind.
        persist(kind, state.sentAt, state.queue, state.seenAt);
      } catch {
        state.queue.pop();
        state.seenAt = before;
        return "delivery_failed";
      }
      return "queued";
    }
    state.running = true;
    try {
      while (state.queue.length) {
        const head = state.queue[0];
        await persist(kind, state.sentAt, state.queue, state.seenAt);
        const controller = new AbortController();
        let timer;
        try {
          await Promise.race([
            Promise.resolve().then(() =>
              deliver(event(kind, head.active, head.at, head.id), controller.signal),
            ),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error("alert_timeout"));
              }, timeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        const sentAt = head.active ? head.at : null;
        persist(kind, sentAt, state.queue.slice(1), state.seenAt);
        state.sentAt = sentAt;
        state.queue.shift();
      }
      return "delivered";
    } catch {
      return "delivery_failed";
    } finally {
      state.running = false;
    }
  };
}
