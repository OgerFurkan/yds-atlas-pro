import { scopedStorageKey } from "./storage-scope";
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(scopedStorageKey(key));
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown, owner?: string | null) {
  try {
    localStorage.setItem(scopedStorageKey(key, owner), JSON.stringify(value));
  } catch {
    throw new Error("Tarayıcı kaydı yapılamadı. Depolama iznini ve boş alanı kontrol et.");
  }
}

export function readRawStorage(key: string) {
  try {
    return localStorage.getItem(scopedStorageKey(key));
  } catch {
    return null;
  }
}

export function writeRawStorage(key: string, value: string, owner?: string | null) {
  try {
    localStorage.setItem(scopedStorageKey(key, owner), value);
  } catch {
    throw new Error("Tarayıcı kaydı yapılamadı. Depolama iznini ve boş alanı kontrol et.");
  }
}

export function removeStorage(key: string, owner?: string | null) {
  try {
    localStorage.removeItem(scopedStorageKey(key, owner));
  } catch {
    throw new Error("Tarayıcı kaydı silinemedi. Depolama iznini kontrol et.");
  }
}
