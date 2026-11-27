import { expect, test } from "bun:test";
import type { createAccountApi } from "../../../frontend/src/features/account/api/account-api";
import {
  adoptRemoteSession,
  bootstrapAccount,
  cacheAccount,
} from "../../../frontend/src/features/account/model/account-cache";
import { SessionSync } from "../../../frontend/src/features/account/model/session-sync";
import {
  authStorage,
  setRememberSession,
} from "../../../frontend/src/features/auth/model/auth-storage";
import { createSession } from "../../../frontend/src/features/learning-game/model/game-engine";
import {
  persistSession,
  readSession,
} from "../../../frontend/src/features/learning-game/model/game-storage";
import { DailyWordGroupsRepository } from "../../../frontend/src/features/word-library/api/daily-word-groups-repository";
import { localWordRepository } from "../../../frontend/src/features/word-library/api/local-word-repository";
import {
  completedToday,
  recordDailyProgress,
} from "../../../frontend/src/shared/lib/daily-progress";
import {
  commitLocalChanges,
  readStorage,
  writeStorage,
} from "../../../frontend/src/shared/lib/storage";
import { storageKeys } from "../../../frontend/src/shared/lib/storage-keys";
import {
  getStorageScope,
  scopedStorageKey,
  setStorageScope,
} from "../../../frontend/src/shared/lib/storage-scope";
import {
  accountStateSchema,
  type GameSession,
  gameSessionSchema,
} from "../../../packages/shared/src/index";

import { installMemoryStorage } from "../helpers/memory-storage";

test("remember session chooses persistent or tab-scoped storage", () => {
  const local = installMemoryStorage();
  const tab = installMemoryStorage("sessionStorage");
  try {
    setRememberSession(false);
    authStorage.setItem("auth", "temporary");
    expect(tab.storage.getItem("auth")).toBe("temporary");
    expect(local.storage.getItem("auth")).toBeNull();
    setRememberSession(true);
    authStorage.setItem("auth", "persistent");
    expect(local.storage.getItem("auth")).toBe("persistent");
    expect(tab.storage.getItem("auth")).toBeNull();
    expect(authStorage.getItem("auth")).toBe("persistent");
    authStorage.removeItem("auth");
    expect(authStorage.getItem("auth")).toBeNull();
  } finally {
    tab.restore();
    local.restore();
  }
});

test("guest and two account caches stay isolated, including a late explicit-owner write", () => {
  const previous = getStorageScope();
  const fixture = installMemoryStorage();
  try {
    setStorageScope(null);
    writeStorage("goal", 20);
    setStorageScope("alice");
    writeStorage("goal", 30);
    setStorageScope("bob");
    writeStorage("goal", 40);
    writeStorage("goal", 50, "alice");
    expect(readStorage("goal", 0)).toBe(40);
    setStorageScope("alice");
    expect(readStorage("goal", 0)).toBe(50);
    setStorageScope(null);
    expect(readStorage("goal", 0)).toBe(20);
    expect(scopedStorageKey("goal", "bob")).toBe("goal:bob");
  } finally {
    setStorageScope(previous);
    fixture.restore();
  }
});

test("switching accounts restores only that owner's library, plan, session and progress", () => {
  const previous = getStorageScope();
  const fixture = installMemoryStorage();
  try {
    const plan = new DailyWordGroupsRepository();
    setStorageScope(null);
    const guestWord = localWordRepository.save({ word: "Guest" });
    plan.assignWordToDay(guestWord.id, 1);

    setStorageScope("alice");
    const aliceWord = localWordRepository.save({ word: "Evidence", meanings: ["Kanıt"] });
    plan.assignWordToDay(aliceWord.id, 2);
    const session = createSession([aliceWord], 5);
    persistSession(session);
    recordDailyProgress([aliceWord.id]);

    setStorageScope("bob");
    expect(localWordRepository.list()).toEqual([]);
    expect(plan.getGroups()).toEqual([]);
    expect(readSession()).toBeNull();
    expect(completedToday()).toBe(0);
    const bobWord = localWordRepository.save({ word: "Evidence", meanings: ["Delil"] });
    expect(bobWord.id).not.toBe(aliceWord.id);
    plan.assignWordToDay(bobWord.id, 3);

    setStorageScope(null);
    expect(localWordRepository.list()).toEqual([guestWord]);
    expect(plan.getGroups()).toEqual([{ day: 1, words: [guestWord.id] }]);
    expect(readSession()).toBeNull();
    expect(completedToday()).toBe(0);

    setStorageScope("alice");
    expect(localWordRepository.list()).toEqual([aliceWord]);
    expect(plan.getGroups()).toEqual([{ day: 2, words: [aliceWord.id] }]);
    expect(readSession()).toEqual(session);
    expect(completedToday()).toBe(1);

    setStorageScope("bob");
    expect(localWordRepository.list()).toEqual([bobWord]);
    expect(plan.getGroups()).toEqual([{ day: 3, words: [bobWord.id] }]);
  } finally {
    setStorageScope(previous);
    fixture.restore();
  }
});

test("cloud saves serialize revisions and do not overwrite the server with a stale revision", async () => {
  const calls: number[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = {
    saveSession: async (_snapshot: GameSession, revision: number) => {
      calls.push(revision);
      if (calls.length === 1) await gate;
      return { revision: revision + 1 };
    },
  } as ReturnType<typeof createAccountApi>;
  const snapshot = { id: "task" } as GameSession;
  const sync = new SessionSync(api, { snapshot, revision: 7 });
  const first = sync.save(snapshot);
  const second = sync.save(snapshot);
  await Promise.resolve();
  expect(calls).toEqual([7]);
  release();
  await Promise.all([first, second]);
  await sync.flush();
  expect(calls).toEqual([7, 8]);
});
test("failed cloud save leaves its revision intact and an explicit retry can recover", async () => {
  let failed = true;
  const revisions: number[] = [];
  const api = {
    saveSession: async (_snapshot: GameSession, revision: number) => {
      revisions.push(revision);
      if (failed) throw new Error("offline");
      return { revision: revision + 1 };
    },
  } as ReturnType<typeof createAccountApi>;
  const sync = new SessionSync(api);
  const snapshot = { id: "task" } as GameSession;
  await expect(sync.save(snapshot)).rejects.toThrow("offline");
  await expect(sync.flush()).rejects.toThrow("offline");
  failed = false;
  sync.retry();
  await sync.save(snapshot);
  await sync.flush();
  expect(revisions).toEqual([0, 0]);
});

test("bootstrap preserves an unsent account session when the server has no copy", () => {
  const fixture = installMemoryStorage();
  const previous = getStorageScope();
  try {
    setStorageScope("alice");
    const draft = createSession([localWordRepository.save({ word: "Draft" })], 5);
    persistSession(draft);
    cacheAccount({ dailyGoal: 20, completedDays: [], progress: [], session: null }, true, "alice");
    expect(readSession()).toEqual(draft);
  } finally {
    setStorageScope(previous);
    fixture.restore();
  }
});

test("reconnect uses the older active draft's own receipt and preserves real revision conflicts", async () => {
  const fixture = installMemoryStorage();
  const previous = getStorageScope();
  try {
    setStorageScope("alice");
    const word = localWordRepository.save({ word: "Review" });
    const draft = { ...createSession([word], 5), assessmentActions: [] };
    const other = { ...createSession([word], 5), assessmentActions: [] };
    const state = accountStateSchema.parse({
      dailyGoal: 20,
      progress: [],
      completedDays: [],
      session: { snapshot: other, revision: 11 },
    });
    persistSession(draft);
    writeStorage(storageKeys.sessionRevision, [draft.id, 4]);
    let serverRevision = 4;
    const calls: number[] = [];
    const api = {
      async saveSession(snapshot: GameSession, revision: number) {
        expect(snapshot.id).toBe(draft.id);
        calls.push(revision);
        if (revision !== serverRevision) throw new Error("session conflict");
        return { revision: ++serverRevision };
      },
    } as ReturnType<typeof createAccountApi>;
    const resume = () => {
      const initial = commitLocalChanges(() => bootstrapAccount(state, true, "alice"));
      return new SessionSync(api, initial.session, initial.draftRevision);
    };
    const sync = resume();
    expect(sync.hasSaved(draft)).toBe(false);
    expect(sync.revision(other.id)).toBe(11);
    await sync.save(draft);
    await expect(resume().save(draft)).rejects.toThrow("session conflict");
    expect(calls).toEqual([4, 4]);
    expect(readSession()).toEqual(draft);
    writeStorage(storageKeys.sessionRevision, [other.id, 11]);
    expect(resume().revision(draft.id)).toBe(0);
    writeStorage(storageKeys.sessionRevision, [draft.id, -1]);
    expect(resume).toThrow("sürümü doğrulanamadı");
    expect(readSession()).toEqual(draft);
    expect(() => bootstrapAccount(state, true, "bob")).toThrow("Oturum değişti");
    const sameId = new SessionSync(api, { snapshot: draft, revision: 12 }, [draft.id, 4]);
    expect(sameId.revision(draft.id)).toBe(12);
  } finally {
    setStorageScope(previous);
    fixture.restore();
  }
});

test("a clean pending marker permits draft recovery while a different pending task is preserved", () => {
  const fixture = installMemoryStorage();
  const previous = getStorageScope();
  try {
    setStorageScope("alice");
    const draft = createSession([localWordRepository.save({ word: "Observe" })], 5);
    persistSession(draft);
    const raw = fixture.storage.getItem(scopedStorageKey(storageKeys.gameSession))!;
    const state = accountStateSchema.parse({
      dailyGoal: 20,
      completedDays: [],
      progress: [],
      session: { revision: 3, snapshot: { ...draft, discarded: true } },
    });
    const recover = () => commitLocalChanges(() => adoptRemoteSession("alice", raw, state));
    writeStorage(storageKeys.pendingSession, "different-task");
    expect(recover).toThrow("Bekleyen oturum");
    expect(readSession()).toEqual(draft);
    expect(readStorage("atlas-preserved-drafts-v1", [])).toEqual([]);
    writeStorage(storageKeys.pendingSession, null);
    recover();
    expect(readStorage("atlas-preserved-drafts-v1", [])).toEqual([raw]);
    expect(readSession()).toBeNull();
    expect(fixture.storage.getItem(scopedStorageKey(storageKeys.pendingSession))).toBeNull();
  } finally {
    setStorageScope(previous);
    fixture.restore();
  }
});

for (const marked of [false, true]) {
  for (const outcome of [
    "different actions",
    "discarded",
    "equivalent",
    "different unlogged progress",
    "equivalent unlogged",
  ] as const) {
    test(`terminal bootstrap: ${outcome}, pending marker=${marked}`, () => {
      const fixture = installMemoryStorage();
      const previous = getStorageScope();
      try {
        setStorageScope("alice");
        const word = localWordRepository.save({ word: "Observe", meanings: ["gözlemlemek"] });
        const initial = createSession([word], 5);
        const discarded = outcome === "discarded";
        const unlogged = outcome.includes("unlogged");
        const draft = gameSessionSchema.parse({
          ...initial,
          phase: discarded ? initial.phase : "complete",
          queue: discarded ? initial.queue : [],
          finalTotal: discarded ? 0 : 2,
          attempts: { [`meaning:${word.id}`]: 1, [`context:${word.id}`]: 1 },
          assessmentActions: unlogged
            ? undefined
            : discarded
              ? []
              : [{ type: "answer", choice: "Observe" }, { type: "advance" }],
        });
        const state = accountStateSchema.parse({
          dailyGoal: 20,
          progress: [],
          completedDays: [],
          session: {
            revision: 4,
            snapshot: {
              ...draft,
              attempts: Object.fromEntries(Object.entries(draft.attempts).reverse()),
              saved: !discarded,
              discarded: discarded || undefined,
              finalCorrect:
                outcome === "different unlogged progress"
                  ? draft.finalCorrect + 1
                  : draft.finalCorrect,
              assessmentActions:
                outcome === "different actions"
                  ? [{ type: "answer", choice: "Other" }, { type: "advance" }]
                  : draft.assessmentActions,
            },
          },
        });
        const raw = JSON.stringify(draft, null, 2);
        const key = scopedStorageKey(storageKeys.gameSession);
        fixture.storage.setItem(key, raw);
        if (marked) writeStorage(storageKeys.pendingSession, draft.id);
        const reconcile = () => cacheAccount(state, true, "alice");
        if (outcome.startsWith("equivalent")) {
          reconcile();
          expect(readSession()).toEqual(state.session!.snapshot);
          expect(readSession()?.saved).toBe(true);
        } else {
          let issue: unknown;
          try {
            reconcile();
          } catch (error) {
            issue = error;
          }
          expect(fixture.storage.getItem(key)).toBe(raw);
          expect(issue).toBeInstanceOf(Error);
          expect((issue as Error).message).toContain("taslak bu cihazda korundu");
          expect(fixture.storage.getItem(scopedStorageKey(storageKeys.pendingSession))).toBe(
            marked ? JSON.stringify(draft.id) : null,
          );
          expect(fixture.storage.getItem(scopedStorageKey(storageKeys.sessionRevision))).toBeNull();
        }
      } finally {
        setStorageScope(previous);
        fixture.restore();
      }
    });
  }
}
