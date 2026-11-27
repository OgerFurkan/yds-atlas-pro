import { expect, test } from "bun:test";
import { updatePlanCommand } from "../../../frontend/src/features/word-library/api/plan-command-storage";
import { getStorageScope, setStorageScope } from "../../../frontend/src/shared/lib/storage-scope";
import { installMemoryStorage } from "../helpers/memory-storage";

test("tab receipts are preserved across quota failure, promotion, conflict and owner change", async () => {
  const local = installMemoryStorage(),
    tab = installMemoryStorage("sessionStorage"),
    old = getStorageScope();
  const lock = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: async (_name: string, fn: () => unknown) => fn() },
  });
  const key = "atlas-plan-command-v1:alice";
  try {
    setStorageScope("alice");
    tab.storage.setItem(key, "old");
    const set = local.storage.setItem;
    local.storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    await expect(updatePlanCommand("alice")).rejects.toThrow();
    expect(tab.storage.getItem(key)).toBe("old");
    expect(local.storage.getItem(key)).toBeNull();
    local.storage.setItem = set;
    expect(await updatePlanCommand("alice")).toBe("old");
    expect(tab.storage.getItem(key)).toBeNull();
    tab.storage.setItem(key, "other");
    await expect(updatePlanCommand("alice")).rejects.toThrow();
    expect(local.storage.getItem(key)).toBe("old");
    expect(tab.storage.getItem(key)).toBe("other");
    tab.storage.clear();
    await expect(
      updatePlanCommand("alice", { expected: null, next: "overwrite" }),
    ).rejects.toThrow();
    setStorageScope("bob");
    await expect(updatePlanCommand("alice", { expected: "old", next: null })).rejects.toThrow();
    expect(local.storage.getItem(key)).toBe("old");
  } finally {
    if (lock) Object.defineProperty(navigator, "locks", lock);
    else Reflect.deleteProperty(navigator, "locks");
    tab.restore();
    local.restore();
    setStorageScope(old);
  }
});
