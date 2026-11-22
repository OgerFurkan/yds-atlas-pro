import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../src/features/auth/model/auth-storage.ts", import.meta.url),
  "utf8",
);
const compiled =
  stripTypeScriptTypes(source, { mode: "transform" }).replace(/^export /gm, "") +
  "\nObject.assign(module.exports, { setRememberSession, authStorage });";
function load(globals = {}) {
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, ...globals });
  return module.exports;
}
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}
test("SSR/Bun test isolation never persists tokens without browser storage", () => {
  const { authStorage, setRememberSession } = load();
  assert.equal(authStorage.getItem("sb-session"), null);
  assert.doesNotThrow(() => setRememberSession(false));
  assert.doesNotThrow(() => authStorage.setItem("sb-session", "secret"));
  assert.doesNotThrow(() => authStorage.removeItem("sb-session"));
  assert.equal(authStorage.getItem("sb-session"), null);
});
test("real browser storage keeps remember=false isolated to the tab", () => {
  const sessionStorage = memoryStorage(),
    localStorage = memoryStorage();
  const { authStorage, setRememberSession } = load({ sessionStorage, localStorage });
  setRememberSession(false);
  authStorage.setItem("sb-session", "token");
  assert.equal(sessionStorage.getItem("sb-session"), "token");
  assert.equal(localStorage.getItem("sb-session"), null);
  authStorage.removeItem("sb-session");
  assert.equal(authStorage.getItem("sb-session"), null);
});
test("real browser storage keeps remember=true persistent without cross-copy", () => {
  const sessionStorage = memoryStorage(),
    localStorage = memoryStorage();
  const { authStorage, setRememberSession } = load({ sessionStorage, localStorage });
  setRememberSession(true);
  authStorage.setItem("sb-session", "token");
  assert.equal(localStorage.getItem("sb-session"), "token");
  assert.equal(sessionStorage.getItem("sb-session"), null);
});
