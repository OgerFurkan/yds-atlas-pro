import { describe, expect, test } from "bun:test";
import { dailyPlanSaveSchema, dailyPlanSnapshotSchema } from "@yds-atlas/shared";
import { readDailyPlan, saveDailyPlan } from "../src/features/learning/daily-plan-service";
import { HttpError } from "../src/shared/errors";
import type { RequestContext } from "../src/shared/supabase";

const owner = "11111111-1111-4111-8111-111111111111";
const ownWord = "22222222-2222-4222-8222-222222222222";
const foreignWord = "33333333-3333-4333-8333-333333333333";
const snapshot = { groupSize: 20 as const, assignments: [{ day: 1, words: [ownWord] }], excludedWordIds: [] };

test("snapshot rejects repeated days, duplicated words and assigned exclusions", () => {
  expect(dailyPlanSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(dailyPlanSnapshotSchema.safeParse({ ...snapshot, assignments: [snapshot.assignments[0], snapshot.assignments[0]] }).success).toBe(false);
  expect(dailyPlanSnapshotSchema.safeParse({ ...snapshot, excludedWordIds: [ownWord] }).success).toBe(false);
  expect(dailyPlanSnapshotSchema.safeParse({ ...snapshot, assignments: [{ day: 1, words: [ownWord, ownWord] }] }).success).toBe(false);
  expect(dailyPlanSaveSchema.safeParse({ snapshot, expectedRevision: -1 }).success).toBe(false);
  expect(dailyPlanSaveSchema.safeParse({ snapshot, expectedRevision: 0, user_id: foreignWord }).success).toBe(false);
});

type FakeState = { revision: number; payload: typeof snapshot } | null;
function fakeContext(initial: FakeState, ownedWords = [ownWord]) {
  let state = initial;
  let updatedWith: Record<string, unknown> = {};
  let insertedWith: Record<string, unknown> = {};
  const db = {
    from(table: string) {
      if (table === "words") return {
        select() { return {
          eq() { return {
            async in(_: string, ids: string[]) {
              return { data: ids.filter((id) => ownedWords.includes(id)).map((id) => ({ id })), error: null };
            },
          }; },
        }; },
      };
      if (table !== "daily_plan_states") throw new Error(`Unexpected table: ${table}`);
      return {
        select() { return {
          eq() { return {
            async maybeSingle() { return { data: state, error: null }; },
          }; },
        }; },
        insert(input: Record<string, unknown>) {
          insertedWith = input;
          return { select() { return { async single() {
            if (state) return { data: null, error: { code: "23505" } };
            state = { revision: input.revision as number, payload: input.payload as typeof snapshot };
            return { data: state, error: null };
          } }; } };
        },
        update(input: Record<string, unknown>) {
          updatedWith = input;
          const filters: Record<string, unknown> = {};
          return {
            eq(name: string, value: unknown) { filters[name] = value; return this; },
            select() { return { async maybeSingle() {
              if (filters.user_id !== owner || filters.revision !== state?.revision)
                return { data: null, error: null };
              state = { revision: input.revision as number, payload: input.payload as typeof snapshot };
              return { data: state, error: null };
            } }; },
          };
        },
      };
    },
  };
  // A JWT-scoped client may SELECT but cannot INSERT/UPDATE the plan table.
  const userDb = {
    from(table: string) {
      const source = db.from(table);
      return table === "daily_plan_states" ? { select: source.select } : source;
    },
  };
  const ctx = { userId: owner, db: userDb as unknown as RequestContext["db"] };
  const writer = db as unknown as RequestContext["db"];
  return { ctx, writer, state: () => state, inserted: () => insertedWith, updated: () => updatedWith };
}

describe("account-bound daily plan cloud sync", () => {
  test("read missing row returns revision 0 without creating data", async () => {
    const mock = fakeContext(null);
    expect(await readDailyPlan(mock.ctx)).toEqual({ revision: 0, snapshot: null });
    expect(mock.state()).toBeNull();
  });

  test("first save claims the authenticated owner, never a client-supplied ID", async () => {
    const mock = fakeContext(null);
    const result = await saveDailyPlan(mock.ctx, { snapshot, expectedRevision: 0 }, mock.writer);
    expect(result.revision).toBe(1);
    expect(mock.inserted().user_id).toBe(owner);
    expect(mock.state()?.payload).toEqual(snapshot);
  });

  test("revision-matched update increments exactly once", async () => {
    const mock = fakeContext({ revision: 3, payload: snapshot });
    const result = await saveDailyPlan(mock.ctx, { snapshot, expectedRevision: 3 }, mock.writer);
    expect(result.revision).toBe(4);
    expect(mock.updated().revision).toBe(4);
  });

  test("outdated writers receive 409 without overwriting cloud data", async () => {
    const mock = fakeContext({ revision: 3, payload: snapshot });
    try {
      await saveDailyPlan(mock.ctx, { snapshot, expectedRevision: 2 }, mock.writer);
      throw new Error("Expected a revision conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
      expect((error as HttpError).code).toBe("DAILY_PLAN_CONFLICT");
    }
    expect(mock.state()?.revision).toBe(3);
  });

  test("first-save race returns 409 rather than replacing an existing plan", async () => {
    const mock = fakeContext({ revision: 1, payload: snapshot });
    await expect(saveDailyPlan(mock.ctx, { snapshot, expectedRevision: 0 }, mock.writer)).rejects.toMatchObject({ status: 409, code: "DAILY_PLAN_CONFLICT" });
    expect(mock.state()?.revision).toBe(1);
  });

  test("a foreign or deleted word ID cannot be saved into the plan", async () => {
    const mock = fakeContext(null);
    const forged = { groupSize: 20 as const, assignments: [{ day: 2, words: [foreignWord] }], excludedWordIds: [] };
    await expect(saveDailyPlan(mock.ctx, { snapshot: forged, expectedRevision: 0 }, mock.writer)).rejects.toMatchObject({ status: 409, code: "DAILY_PLAN_STALE_WORDS" });
    expect(mock.state()).toBeNull();
  });
});
