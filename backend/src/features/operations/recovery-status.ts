import { createPublicKey, verify } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { z } from "zod";
import type { ServerConfig } from "../../config/env";

const time = z.number().int().nonnegative().max(8.64e15);
const fields = {
  environment: z.enum(["pre", "prod"]),
  project: z.string().regex(/^[a-z0-9]{20}$/),
  observedAt: time,
  lastBackup: time.nullable(),
  lastVerification: time.nullable(),
  backupState: z.enum(["healthy", "failed", "overdue", "unknown"]),
  signature: z.string().regex(/^[a-zA-Z0-9+/]{86}==$/),
};
const attemptSchema = z
  .object({
    startedAt: time,
    finishedAt: time.nullable(),
    outcome: z.enum(["running", "succeeded", "failed", "interrupted"]),
    errorCode: z
      .enum([
        "recovery_journal",
        "recovery_capture",
        "recovery_manifest",
        "recovery_stage",
        "recovery_integrity",
        "recovery_publish",
        "recovery_interrupted",
      ])
      .nullable(),
    cleanupCode: z.literal("recovery_cleanup").nullable(),
  })
  .strict();
const statusSchema = z.discriminatedUnion("version", [
  z.object({ ...fields, version: z.literal(1) }).strict(),
  z.object({ ...fields, version: z.literal(2), lastAttempt: attemptSchema.nullable() }).strict(),
]);
const maxBytes = 2048;
type SignedStatus = z.infer<typeof statusSchema>;

type StatusPayload =
  | Omit<Extract<SignedStatus, { version: 1 }>, "signature">
  | Omit<Extract<SignedStatus, { version: 2 }>, "signature">;
export function recoveryStatusPayload(status: StatusPayload) {
  const base: unknown[] = [
    status.version,
    status.environment,
    status.project,
    status.observedAt,
    status.lastBackup,
    status.lastVerification,
    status.backupState,
  ];
  if (status.version === 2) {
    const a = status.lastAttempt;
    base.push(a && [a.startedAt, a.finishedAt, a.outcome, a.errorCode, a.cleanupCode]);
  }
  return JSON.stringify(base);
}

export function verifyRecoveryStatus(
  raw: string,
  publicKey: string,
  environment: string,
  project: string,
  now: number,
) {
  if (Buffer.byteLength(raw) > maxBytes) return null;
  try {
    const body = statusSchema.parse(JSON.parse(raw));
    if (
      body.environment !== environment ||
      body.project !== project ||
      body.observedAt > now ||
      now - body.observedAt > 15 * 60_000 ||
      (body.lastBackup !== null && body.lastBackup > body.observedAt) ||
      (body.lastVerification !== null &&
        (body.lastBackup === null ||
          body.lastVerification < body.lastBackup ||
          body.lastVerification > body.observedAt)) ||
      (body.backupState === "healthy" && body.lastVerification === null)
    )
      return null;
    const attempt = body.version === 2 ? body.lastAttempt : null;
    if (body.version === 2) {
      if (!attempt && body.backupState !== "unknown") return null;
      if (attempt) {
        const { outcome, startedAt, finishedAt, errorCode, cleanupCode } = attempt;
        if (
          startedAt > body.observedAt ||
          (finishedAt !== null && (finishedAt < startedAt || finishedAt > body.observedAt))
        )
          return null;
        if (
          outcome === "running" &&
          (finishedAt !== null || errorCode || cleanupCode || body.backupState !== "unknown")
        )
          return null;
        if (
          outcome === "interrupted" &&
          (finishedAt !== null ||
            errorCode !== "recovery_interrupted" ||
            cleanupCode ||
            body.backupState !== "failed")
        )
          return null;
        if (
          outcome === "failed" &&
          (finishedAt === null ||
            !errorCode ||
            errorCode === "recovery_interrupted" ||
            body.backupState !== "failed")
        )
          return null;
        if (
          outcome === "succeeded" &&
          (finishedAt === null ||
            errorCode ||
            cleanupCode ||
            body.backupState === "failed" ||
            (body.lastBackup !== null &&
              (body.lastBackup < startedAt || body.lastBackup > finishedAt)))
        )
          return null;
      }
    }
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(recoveryStatusPayload(body)),
        key,
        Buffer.from(body.signature, "base64"),
      )
    )
      return null;
    return {
      lastBackup: body.lastBackup,
      lastVerification: body.lastVerification,
      backupAgeMs: body.lastBackup === null ? null : now - body.lastBackup,
      status: body.backupState,
      observedAt: body.observedAt,
      lastAttempt: attempt,
    };
  } catch {
    return null;
  }
}

export async function readRecoveryStatus(config: ServerConfig) {
  if (
    !config.ATLAS_RECOVERY_STATUS_FILE ||
    !config.ATLAS_RECOVERY_STATUS_PUBLIC_KEY ||
    !config.SUPABASE_URL ||
    config.ATLAS_ENV === "local"
  )
    return null;
  const path = config.ATLAS_RECOVERY_STATUS_FILE;
  try {
    const name = new URL(config.SUPABASE_URL).hostname.split(".")[0];
    const info = await lstat(path);
    if (!info.isFile() || info.size > maxBytes) return null;
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const actual = await file.stat();
      if (
        !actual.isFile() ||
        actual.size > maxBytes ||
        actual.ino !== info.ino ||
        actual.dev !== info.dev
      )
        return null;
      const bytes = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      return verifyRecoveryStatus(
        bytes.subarray(0, bytesRead).toString("utf8"),
        config.ATLAS_RECOVERY_STATUS_PUBLIC_KEY,
        config.ATLAS_ENV,
        name,
        Date.now(),
      );
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}
