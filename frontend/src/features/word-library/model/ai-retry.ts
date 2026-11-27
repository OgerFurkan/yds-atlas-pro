/**
 * Bounded recovery for temporary failures in sequential vocabulary enrichment.
 * Provider quotas are never bypassed: respect Retry-After before trying again.
 */
export type AiRetryNotice = {
  reason: "rate-limit" | "temporary-failure";
  secondsRemaining: number;
};

type RetryableError = { status?: number; code?: string; retryAfterSeconds?: number };

// A missing key, rejected credential or invalid AI output cannot recover after
// a timed retry. In particular AI_NOT_CONFIGURED uses HTTP 503, the same status
// that a genuinely temporary upstream outage may return.
const TERMINAL_AI_CODES = new Set([
  "AI_NOT_CONFIGURED",
  "AI_AUTH_ERROR",
  "AI_PERMISSION_DENIED",
  "AI_MODEL_NOT_FOUND",
  "AI_INVALID_RESPONSE",
  "AI_REQUEST_REJECTED",
  "AI_CANCELLED",
  "UNAUTHENTICATED",
  "INVALID_RESPONSE",
]);

function asRetryableError(error: unknown): RetryableError {
  if (!error || typeof error !== "object") return {};
  const value = error as RetryableError;
  return {
    status: typeof value.status === "number" ? value.status : undefined,
    code: typeof value.code === "string" ? value.code : undefined,
    retryAfterSeconds:
      typeof value.retryAfterSeconds === "number" ? value.retryAfterSeconds : undefined,
  };
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Maximum one automatic retry for each class of failure. Never loop forever. */
export async function withAiRecovery<T>(
  operation: () => Promise<T>,
  onWait?: (notice: AiRetryNotice) => void,
  wait: (milliseconds: number) => Promise<void> = sleep,
  signal?: AbortSignal,
): Promise<T> {
  let rateLimitRetried = false;
  let upstreamRetried = false;
  for (;;) {
    if (signal?.aborted) throw signal.reason ?? new Error("İstek durduruldu.");
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      const { status, code, retryAfterSeconds } = asRetryableError(error);
      if (code && TERMINAL_AI_CODES.has(code)) throw error;
      let reason: AiRetryNotice["reason"];
      let seconds: number;
      if (status === 429 && !rateLimitRetried) {
        // A daily quota or a long ban should not leave the dialog running.
        if (retryAfterSeconds !== undefined && retryAfterSeconds > 90) throw error;
        rateLimitRetried = true;
        reason = "rate-limit";
        seconds = Math.max(1, Math.ceil(retryAfterSeconds ?? 60));
      } else if ([500, 502, 503, 504].includes(status ?? 0) && !upstreamRetried) {
        upstreamRetried = true;
        reason = "temporary-failure";
        seconds = 3;
      } else {
        throw error;
      }
      for (let remaining = seconds; remaining > 0; remaining--) {
        if (signal?.aborted) throw signal.reason ?? new Error("İstek durduruldu.");
        onWait?.({ reason, secondsRemaining: remaining });
        await wait(1000);
      }
      if (signal?.aborted) throw signal.reason ?? new Error("İstek durduruldu.");
      onWait?.({ reason, secondsRemaining: 0 });
    }
  }
}
