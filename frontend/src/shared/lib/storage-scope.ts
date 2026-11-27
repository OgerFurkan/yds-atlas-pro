let generation = 0;
export const storageGeneration = () => generation;
let scope: string | null = null;
export const localFixtureProfile =
  import.meta.env?.DEV === true &&
  import.meta.env.MODE === "local-fixtures" &&
  typeof window !== "undefined" &&
  ["127.0.0.1", "localhost"].includes(window.location.hostname);

export function setStorageScope(userId: string | null) {
  if (scope !== userId) generation++;
  scope = userId;
}
export function getStorageScope() {
  return scope;
}
export function scopedStorageKey(key: string, owner = scope) {
  if (localFixtureProfile && owner === null) return `${key}:local-fixtures`;
  return owner ? key + ":" + owner : key;
}
