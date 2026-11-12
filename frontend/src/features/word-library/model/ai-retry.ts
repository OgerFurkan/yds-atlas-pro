/**
 * Bounded recovery for temporary failures in sequential vocabulary enrichment.
 * Provider quotas are never bypassed: respect Retry-After before trying again.
 */
export type AiRetryNotice = {
  reason: "rate-limit" | "temporary-failure";
  secondsRemaining: number;
};

type RetryableError = { status?: number; retryAfterSeconds?: number };

function asRetryableError(error: unknown): RetryableError {
  if (!error || typeof error !== "object") return {};
  const value = error as RetryableError;
  return {
    status: typeof value.status === "number" ? value.status : undefined,
    retryAfterSeconds: typeof value.retryAfterSeconds === "number" ? value.retryAfterSeconds : undefined,
  };
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Maximum one automatic retry for each class of failure. Never loop forever. */
export async function withAiRecovery<T>(
  operation: () => Promise<T>,
  onWait?: (notice: AiRetryNotice) => void,
  wait: (milliseconds: number) => Promise<void> = sleep,
): Promise<T> {
  let rateLimitRetried = false;
  let upstreamRetried = false;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const { status, retryAfterSeconds } = asRetryableError(error);
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
        onWait?.({ reason, secondsRemaining: remaining });
        await wait(1000);
      }
      onWait?.({ reason, secondsRemaining: 0 });
    }
  }
}
