const preferenceKey = "yds-atlas-remember-session";

// Browser credentials remain in the configured browser storage. SSR and Bun unit
// tests have no browser storage: never create a shared in-memory token fallback.
function sessionStore(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}
function persistentStore(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function setRememberSession(remember: boolean) {
  sessionStore()?.setItem(preferenceKey, remember ? "true" : "false");
}

export const authStorage = {
  getItem(key: string) {
    return sessionStore()?.getItem(key) ?? persistentStore()?.getItem(key) ?? null;
  },
  setItem(key: string, value: string) {
    const session = sessionStore();
    const local = persistentStore();
    if (!session || !local) return; // No credential storage outside a browser.
    const preference = session.getItem(preferenceKey);
    const remember =
      preference === null
        ? local.getItem(key) !== null || session.getItem(key) === null
        : preference === "true";
    const target = remember ? local : session;
    const other = remember ? session : local;
    target.setItem(key, value);
    other.removeItem(key);
  },
  removeItem(key: string) {
    sessionStore()?.removeItem(key);
    persistentStore()?.removeItem(key);
  },
};
