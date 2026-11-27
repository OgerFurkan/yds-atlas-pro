import { readStoredText, removeStorage, writeRawStorage } from "@/shared/lib/storage";
import { getStorageScope, scopedStorageKey } from "@/shared/lib/storage-scope";
import { withLocalWordWrite } from "./local-word-repository";

const key = "atlas-plan-command-v1";

/** Promote older tab-local receipts only after the durable owner-scoped copy commits. */
export async function updatePlanCommand(
  owner: string,
  change?: { expected: string | null; next: string | null },
) {
  const legacyKey = scopedStorageKey(key, owner);
  const legacyReceipt = sessionStorage.getItem(legacyKey);
  if (legacyReceipt !== null)
    await withLocalWordWrite(() => {
      if (getStorageScope() !== owner) throw new Error("Planın sahibi değişti.");
      const legacy = sessionStorage.getItem(legacyKey);
      const durable = readStoredText(key, owner);
      if (legacy !== null && durable !== null && durable !== legacy)
        throw new Error(
          "Bu sekmenin işlemi diğer sekmedeki işlemle çakışıyor. İki kayıt da korundu.",
        );
      if (legacy !== null && durable === null) writeRawStorage(key, legacy, owner);
    });
  return withLocalWordWrite(() => {
    if (getStorageScope() !== owner) throw new Error("Planın sahibi değişti.");
    const current = readStoredText(key, owner);
    const legacy = sessionStorage.getItem(legacyKey);
    if (legacy !== null) {
      if (legacy !== current) throw new Error("Bekleyen işlem değişti. Yeniden yükle.");
      sessionStorage.removeItem(legacyKey);
    }
    if (!change) return current;
    if (change.expected !== current)
      throw new Error("Bekleyen plan işlemi değişti. Yeniden yükle.");
    if (change.next === null) removeStorage(key, owner);
    else writeRawStorage(key, change.next, owner);
    return change.next;
  });
}
