import { expect, test } from "bun:test";
import type { createAccountApi } from "../../../frontend/src/features/account/api/account-api";
import { SessionSync } from "../../../frontend/src/features/account/model/session-sync";
import {
  authStorage,
  setRememberSession,
} from "../../../frontend/src/features/auth/model/auth-storage";
import {
  completedToday,
  recordDailyProgress,
} from "../../../frontend/src/features/dashboard/model/daily-progress";
import { createSession } from "../../../frontend/src/features/learning-game/model/game-engine";
import {
  persistSession,
  readSession,
} from "../../../frontend/src/features/learning-game/model/game-storage";
import { DailyWordGroupsRepository } from "../../../frontend/src/features/word-library/api/daily-word-groups-repository";
import { localWordRepository } from "../../../frontend/src/features/word-library/api/local-word-repository";
import { readStorage, writeStorage } from "../../../frontend/src/shared/lib/storage";
import {
  getStorageScope,
  scopedStorageKey,
  setStorageScope,
} from "../../../frontend/src/shared/lib/storage-scope";
import type { GameSession } from "../../../packages/shared/src/index";

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
