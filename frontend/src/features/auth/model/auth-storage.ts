const preferenceKey = "yds-atlas-remember-session";

export function setRememberSession(remember: boolean) {
  sessionStorage.setItem(preferenceKey, remember ? "true" : "false");
}

export const authStorage = {
  getItem(key: string) {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    const preference = sessionStorage.getItem(preferenceKey);
    const remember =
      preference === null
        ? localStorage.getItem(key) !== null || sessionStorage.getItem(key) === null
        : preference === "true";
    const target = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    target.setItem(key, value);
    other.removeItem(key);
  },
  removeItem(key: string) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  },
};
