import type { ServerConfig } from "../../config/env";
import { quotaClient } from "../../shared/supabase";
import { geminiDiagnostics } from "../ai/gemini-keys";

import { readRecoveryStatus } from "./recovery-status";

export type Readiness = { database: boolean; auth: boolean };

export function createOperations(
  config: ServerConfig,
  database: (() => Promise<boolean>) | undefined,
  probe?: () => Promise<Readiness>,
) {
  const startedAt = new Date().toISOString();
  const latencyBounds = [50, 200, 1000, 5000];
  const counts = { requests: 0, serverErrors: 0, latency: [0, 0, 0, 0, 0] };
  let cached: { until: number; checks: Readiness } | undefined;
  let pending: Promise<Readiness> | undefined;

  async function auth(signal: AbortSignal) {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return false;
    const response = await fetch(new URL("/auth/v1/health", config.SUPABASE_URL), {
      headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY },
      signal,
      redirect: "error",
    });
    await response.body?.cancel();
    return response.ok;
  }

  async function check(signal: AbortSignal): Promise<Readiness> {
    const [db, authentication] = await Promise.allSettled([database?.(), auth(signal)]);
    return {
      database: db.status === "fulfilled" && db.value === true,
      auth: authentication.status === "fulfilled" && authentication.value === true,
    };
  }

  function readiness() {
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.checks);
    if (pending) return pending;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<Readiness>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ database: false, auth: false });
      }, 2800);
    });
    pending = Promise.race([
      Promise.resolve().then(() => probe?.() ?? check(controller.signal)),
      deadline,
    ])
      .catch(() => ({ database: false, auth: false }))
      .then((checks) => {
        cached = { checks, until: Date.now() + 5000 };
        return checks;
      })
      .finally(() => {
        clearTimeout(timer);
        pending = undefined;
      });
    return pending;
  }

  async function queues() {
    if (!config.SUPABASE_SECRET_KEY) return null;
    try {
      const client = quotaClient(config);
      const result = await client
        .from("atlas_tooltip_queue")
        .select("status")
        .in("status", ["pending", "retry", "processing"])
        .limit(101)
        .abortSignal(AbortSignal.timeout(1800));
      if (
        result.error ||
        !result.data ||
        result.data.some(({ status }) => !["pending", "retry", "processing"].includes(status))
      )
        return null;
      const failed = await client
        .from("atlas_lexicon_jobs")
        .select("status")
        .eq("status", "failed")
        .limit(101)
        .abortSignal(AbortSignal.timeout(1800));
      const failureSample =
        failed.error || !failed.data || failed.data.some(({ status }) => status !== "failed")
          ? null
          : { failed: Math.min(100, failed.data.length), truncated: failed.data.length > 100 };
      const rows = result.data.slice(0, 100);
      return {
        sampled: rows.length,
        truncated: result.data.length > 100,
        pending: rows.filter(({ status }) => status === "pending").length,
        processing: rows.filter(({ status }) => status === "processing").length,
        retry: rows.filter(({ status }) => status === "retry").length,
        lexicon: failureSample,
      };
    } catch {
      return null;
    }
  }

  return {
    readiness,
    observe(status: number, duration: number) {
      counts.requests++;
      if (status >= 500) counts.serverErrors++;
      const bucket = latencyBounds.findIndex((bound) => duration <= bound);
      counts.latency[bucket === -1 ? latencyBounds.length : bucket]++;
    },
    async snapshot() {
      const [checks, queueStatus, recovery] = await Promise.all([
        readiness(),
        queues(),
        readRecoveryStatus(config),
      ]);
      return {
        version: 1,
        environment: config.ATLAS_ENV,
        release: config.ATLAS_RELEASE ?? null,
        readiness: checks,
        process: { startedAt, rssBytes: process.memoryUsage.rss() },
        api: {
          requests: counts.requests,
          serverErrors: counts.serverErrors,
          latencyBounds,
          latency: [...counts.latency],
        },
        ai: geminiDiagnostics(config),
        queues: queueStatus,
        recovery,
        disk: null,
      };
    },
  };
}
