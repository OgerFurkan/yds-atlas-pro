let scope: string | null = null;
export function setStorageScope(userId: string | null) {
  scope = userId;
}
export function getStorageScope() {
  return scope;
}
export function scopedStorageKey(key: string, owner = scope) {
  return owner ? key + ":" + owner : key;
}
