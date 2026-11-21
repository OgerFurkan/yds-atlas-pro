import { expect, test } from "bun:test";
import { withAiRecovery } from "../../src/features/word-library/model/ai-retry";

test("minute quota waits and retries once without duplicating successful work", async () => {
  let calls = 0;
  const ticks: number[] = [];
  const result = await withAiRecovery(async () => {
    if (++calls === 1) throw { status: 429, retryAfterSeconds: 3 };
    return "ok";
  }, (progress) => ticks.push(progress.secondsRemaining), async () => undefined);
  expect(result).toBe("ok");
  expect(calls).toBe(2);
  expect(ticks).toEqual([3, 2, 1, 0]);
});

test("temporary 503 is retried once with backoff", async () => {
  let calls = 0;
  const result = await withAiRecovery(async () => {
    if (++calls === 1) throw { status: 503 };
    return 42;
  }, undefined, async () => undefined);
  expect(result).toBe(42);
  expect(calls).toBe(2);
});

test("permanent errors and daily quota waits longer than 90 seconds are not retried", async () => {
  let calls = 0;
  const invalid = async () => { calls++; throw { status: 400 }; };
  await expect(withAiRecovery(invalid, undefined, async () => undefined)).rejects.toEqual({ status: 400 });
  expect(calls).toBe(1);
  calls = 0;
  const daily = async () => { calls++; throw { status: 429, retryAfterSeconds: 86400 }; };
  await expect(withAiRecovery(daily, undefined, async () => undefined)).rejects.toEqual({ status: 429, retryAfterSeconds: 86400 });
  expect(calls).toBe(1);
});

test("cancelled legacy recovery stops before a second quota attempt", async () => {
  const controller = new AbortController();
  let calls = 0;
  await expect(withAiRecovery(async () => {
    calls++;
    throw { status: 429, retryAfterSeconds: 60 };
  }, undefined, async () => { controller.abort(new Error("Durduruldu")); }, controller.signal))
    .rejects.toThrow("Durduruldu");
  expect(calls).toBe(1);
});

test("already cancelled requests never start an AI operation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Durduruldu"));
  let calls = 0;
  await expect(withAiRecovery(async () => {
    calls++;
    return 1;
  }, undefined, async () => undefined, controller.signal)).rejects.toThrow("Durduruldu");
  expect(calls).toBe(0);
});

test("repeated 429 cannot create an unbounded retry loop", async () => {
  let calls = 0;
  await expect(withAiRecovery(async () => {
    calls++;
    throw { status: 429, retryAfterSeconds: 1 };
  }, undefined, async () => undefined)).rejects.toEqual({ status: 429, retryAfterSeconds: 1 });
  expect(calls).toBe(2);
});

test.each([
  [503, "AI_NOT_CONFIGURED"],
  [503, "AI_AUTH_ERROR"],
  [503, "AI_MODEL_NOT_FOUND"],
  [502, "AI_INVALID_RESPONSE"],
  [502, "AI_REQUEST_REJECTED"],
  [503, "UNAUTHENTICATED"],
] as const)("known terminal AI code %s/%s never retries, even on a transient-looking status",
  async (status, code) => {
    const failure = { status, code };
    let calls = 0;
    const waits: number[] = [];
    await expect(withAiRecovery(async () => {
      calls++;
      throw failure;
    }, (notice) => waits.push(notice.secondsRemaining), async () => undefined))
      .rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  },
);

test("provider network 503 with an explicitly recoverable code still retries once", async () => {
  let calls = 0;
  const output = await withAiRecovery(async () => {
    if (++calls === 1) throw { status: 503, code: "AI_NETWORK_ERROR" };
    return "ready";
  }, undefined, async () => undefined);
  expect(output).toBe("ready");
  expect(calls).toBe(2);
});
