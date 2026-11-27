import { type AccountState, type GameSession, gameSessionSchema } from "@yds-atlas/shared";
import { z } from "zod";
import { readSession } from "@/features/learning-game/task-storage";
import {
  readStoredJson,
  readStoredText,
  removeStorage,
  writeRawStorage,
  writeStorage,
} from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope } from "@/shared/lib/storage-scope";

export class AccountDraftConflict extends Error {}

export type AccountBootstrap = AccountState & { draftRevision?: [string, number] };

// Capture the receipt and its matching draft under the bootstrap profile lock.
export function bootstrapAccount(
  state: AccountState,
  includeSession: boolean,
  owner: string,
): AccountBootstrap {
  if (getStorageScope() !== owner) throw new Error("Oturum değişti. Hesabı yeniden aç.");
  cacheAccount(state, includeSession, owner);
  const draft = readSession();
  if (!draft || draft.saved || draft.tutorial || draft.id === state.session?.snapshot.id)
    return state;
  const receipt = readStoredJson(storageKeys.sessionRevision);
  if (receipt == null) return state;
  const result = z.tuple([z.string().min(1), z.number().int().positive()]).safeParse(receipt);
  if (!result.success) throw new Error("Yerel çalışma sürümü doğrulanamadı. Taslak korundu.");
  return result.data[0] === draft.id ? { ...state, draftRevision: result.data } : state;
}

export function adoptRemoteSession(owner: string, original: string, state: AccountState) {
  if (getStorageScope() !== owner || readStoredText(storageKeys.gameSession, owner) !== original)
    throw new Error("Yerel taslak veya hesap değişti. Yeniden yükle.");
  const draft = gameSessionSchema.parse(JSON.parse(original));
  if (draft.saved || draft.discarded || draft.id !== state.session?.snapshot.id)
    throw new Error("Oturum eşleşmedi. Taslak korundu.");
  const pending = readStoredJson(storageKeys.pendingSession);
  if (pending != null && pending !== draft.id)
    throw new Error("Bekleyen oturum değişti. Özgün taslak korundu.");
  const stored = readStoredJson("atlas-preserved-drafts-v1");
  const archive = z.array(z.string()).parse(stored === undefined ? [] : stored);
  if (!archive.includes(original))
    writeStorage("atlas-preserved-drafts-v1", [...archive, original], owner);
  removeStorage(storageKeys.pendingSession, owner);
  removeStorage(storageKeys.gameSession, owner);
  removeStorage(storageKeys.sessionRevision, owner);
  cacheAccount(state, true, owner);
}

// JSONB may return record keys in a different order. Array order carries progress.
function completedProgress(session: GameSession) {
  return JSON.stringify({ ...session, saved: true }, (_key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    );
  });
}

export function cacheAccount(state: AccountState, includeSession = false, owner?: string | null) {
  writeRawStorage(storageKeys.dailyGoal, String(state.dailyGoal), owner);
  const progress: Record<string, string[]> = {};
  for (const item of state.progress) {
    progress[item.day] ??= [];
    progress[item.day].push(item.word_id);
  }
  writeStorage(storageKeys.dailyProgress, progress, owner);
  writeStorage(
    storageKeys.completedDays,
    Object.fromEntries(state.completedDays.map((item) => [item.day, true])),
    owner,
  );
  writeStorage(
    storageKeys.goalPerDay,
    Object.fromEntries(state.completedDays.map((item) => [item.day, item.goal])),
    owner,
  );
  if (includeSession) {
    const raw = readStoredJson(storageKeys.gameSession);
    const draft = raw === undefined ? null : gameSessionSchema.parse(raw);
    const remote = state.session?.snapshot;
    if (draft?.localPractice) return;
    if (draft && !draft.saved && !draft.discarded) {
      if (!remote) return;
      const pending = readStoredJson(storageKeys.pendingSession);
      const localActions = draft.assessmentActions;
      const remoteActions = remote.assessmentActions;
      if (remote.id === draft.id && !remote.saved && !remote.discarded) {
        if (localActions && remoteActions) {
          const length = Math.min(localActions.length, remoteActions.length);
          if (
            JSON.stringify(localActions.slice(0, length)) !==
            JSON.stringify(remoteActions.slice(0, length))
          )
            throw new AccountDraftConflict(
              "Yerel taslak ve bulut oturumu farklı ilerlemiş. Taslak bu cihazda korundu.",
            );
          if (localActions.length > remoteActions.length) return;
          if (pending === draft.id && localActions.length === remoteActions.length) return;
        } else if (pending === draft.id || JSON.stringify(draft) !== JSON.stringify(remote)) {
          const base = readStoredJson(storageKeys.sessionRevision);
          if (JSON.stringify(base) !== JSON.stringify([draft.id, state.session?.revision]))
            throw new AccountDraftConflict(
              "Buluttaki eski biçimli oturumun sürümü değişti. Yerel taslak korundu.",
            );
          return;
        }
      } else if (remote.id !== draft.id) {
        // An older client may have saved an offline draft without a pending marker.
        return;
      } else {
        // Older drafts may have neither a pending marker nor an action log.
        const equivalent =
          localActions?.length && remoteActions?.length
            ? JSON.stringify(localActions) === JSON.stringify(remoteActions)
            : completedProgress(draft) === completedProgress(remote);
        if (remote.discarded || !equivalent)
          throw new AccountDraftConflict(
            "Kapanmış bulut oturumu ile yerel ilerlemen uzlaştırılamadı. Özgün yerel taslak bu cihazda korundu.",
          );
      }
    }
    if (state.session && !state.session.snapshot.discarded) {
      writeStorage(
        storageKeys.sessionRevision,
        [state.session.snapshot.id, state.session.revision],
        owner,
      );
      writeStorage(storageKeys.gameSession, state.session.snapshot, owner);
    } else removeStorage(storageKeys.gameSession, owner);
  }
}
