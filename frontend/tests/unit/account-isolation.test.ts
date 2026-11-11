import { expect, test } from "bun:test";
import type { GameSession } from "@yds-atlas/shared";
import type { createAccountApi } from "@/features/account/api/account-api";
import { SessionSync } from "@/features/account/model/session-sync";
import { authStorage, setRememberSession } from "@/features/auth/model/auth-storage";
import { readStorage, writeStorage } from "@/shared/lib/storage";
import { getStorageScope, scopedStorageKey, setStorageScope } from "@/shared/lib/storage-scope";

test("remember session chooses persistent or tab-scoped storage", () => {
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const makeStorage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  };
  const local = makeStorage();
  const tab = makeStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: tab });
  try {
    setRememberSession(false);
    authStorage.setItem("auth", "temporary");
    expect(tab.getItem("auth")).toBe("temporary");
    expect(local.getItem("auth")).toBeNull();
    setRememberSession(true);
    authStorage.setItem("auth", "persistent");
    expect(local.getItem("auth")).toBe("persistent");
    expect(tab.getItem("auth")).toBeNull();
    expect(authStorage.getItem("auth")).toBe("persistent");
    authStorage.removeItem("auth");
    expect(authStorage.getItem("auth")).toBeNull();
  } finally {
    if (originalLocal) Object.defineProperty(globalThis, "localStorage", originalLocal);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalSession) Object.defineProperty(globalThis, "sessionStorage", originalSession);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("guest and two account caches stay isolated, including a late explicit-owner write", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previous = getStorageScope();
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
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
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
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
