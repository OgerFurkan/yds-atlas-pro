import { expect, test } from "bun:test";
import { inspectDailyPlanSyncPreflight } from "../../src/features/word-library/model/daily-plan-sync-preflight";
import { readLocalDailyPlanForPreflight } from "../../src/features/word-library/api/daily-plan-preflight-source";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const empty = { groupSize: 20 as const, assignments: [], excludedWordIds: [] };
const first = { ...empty, assignments: [{ day: 1, words: [A, B] }], excludedWordIds: [C] };
const cloud = (snapshot: unknown | null, revision = snapshot ? 1 : 0) => ({ revision, snapshot });

function localStore(data: Record<string, unknown>): Pick<Storage, "getItem"> {
  return { getItem: (key: string) => key in data ? JSON.stringify(data[key]) : null };
}

test("no local or remote plan is an empty preflight, not a write instruction", () => {
  const result = inspectDailyPlanSyncPreflight({ local: null, cloud: cloud(null) });
  expect(result.status).toBe("both-empty");
  expect(result.requiresUserDecision).toBe(false);
});

test("semantically identical plans ignore exclusion and day-row ordering", () => {
  const result = inspectDailyPlanSyncPreflight({
    local: { ...first, assignments: [{ day: 2, words: [B] }, { day: 1, words: [A] }], excludedWordIds: [C] },
    cloud: cloud({ ...first, assignments: [{ day: 1, words: [A] }, { day: 2, words: [B] }], excludedWordIds: [C] }),
  });
  expect(result.status).toBe("identical");
  expect(result.changedPlacements).toEqual([]);
});

test("placement and group size disagreements require an explicit decision", () => {
  const result = inspectDailyPlanSyncPreflight({
    local: first,
    cloud: cloud({ ...first, groupSize: 10, assignments: [{ day: 2, words: [A, B] }] }, 7),
  });
  expect(result.status).toBe("different");
  expect(result.cloudRevision).toBe(7);
  expect(result.groupSizeChanged).toBe(true);
  expect(result.changedPlacements).toEqual([
    { wordId: A, localDay: 1, cloudDay: 2 },
    { wordId: B, localDay: 1, cloudDay: 2 },
  ]);
  expect(result.requiresUserDecision).toBe(true);
});

test("word order alone is visible; exclusion order alone is irrelevant", () => {
  const result = inspectDailyPlanSyncPreflight({
    local: { ...empty, assignments: [{ day: 4, words: [A, B] }], excludedWordIds: [C] },
    cloud: cloud({ ...empty, assignments: [{ day: 4, words: [B, A] }], excludedWordIds: [C] }),
  });
  expect(result.changedPlacements).toHaveLength(0);
  expect(result.changedOrderDays).toEqual([4]);
  expect(result.status).toBe("different");
});

test("exclusion difference is reported without changing either input", () => {
  const local = structuredClone(first);
  const remote = structuredClone(first);
  remote.excludedWordIds = [];
  const result = inspectDailyPlanSyncPreflight({ local, cloud: cloud(remote) });
  expect(result.changedExclusions).toEqual([C]);
  expect(local).toEqual(first);
  expect(remote.excludedWordIds).toEqual([]);
});

test("invalid and duplicate UUIDs, stale IDs and malformed revisions are blocked", () => {
  const invalid = { ...first, assignments: [{ day: 1, words: [A, A] }] };
  expect(inspectDailyPlanSyncPreflight({ local: invalid, cloud: cloud(null) }).status).toBe("blocked");
  expect(inspectDailyPlanSyncPreflight({ local: first, cloud: cloud(null), knownWordIds: [A, B] }).status).toBe("blocked");
  expect(inspectDailyPlanSyncPreflight({ local: first, cloud: cloud(first, -1) }).status).toBe("blocked");
  expect(inspectDailyPlanSyncPreflight({ local: { ...first, assignments: [{ day: 1, words: ["legacy-id"] }] }, cloud: cloud(null) }).status).toBe("blocked");
});

test("one-sided plans must not be silently uploaded or downloaded", () => {
  expect(inspectDailyPlanSyncPreflight({ local: first, cloud: cloud(null) }).status).toBe("local-only");
  const result = inspectDailyPlanSyncPreflight({ local: null, cloud: cloud(first) });
  expect(result.status).toBe("cloud-only");
  expect(result.requiresUserDecision).toBe(true);
});

test("local reader is read-only, scope-aware and fail-closed for corrupt storage", () => {
  const clean = readLocalDailyPlanForPreflight(localStore({}));
  expect(clean).toEqual({ snapshot: null, errors: [] });
  const corrupt: Pick<Storage, "getItem"> = { getItem: () => "{oops" };
  const bad = readLocalDailyPlanForPreflight(corrupt);
  expect(bad.errors.length).toBeGreaterThan(0);
  expect(inspectDailyPlanSyncPreflight({ local: bad.snapshot, cloud: cloud(null), localReadErrors: bad.errors }).status)
    .toBe("blocked");
});

test("storage exceptions are blocking, not interpreted as an empty local plan", () => {
  const failing: Pick<Storage, "getItem"> = { getItem: () => { throw new Error("denied"); } };
  const result = readLocalDailyPlanForPreflight(failing);
  expect(result.errors.length).toBeGreaterThan(0);
});
