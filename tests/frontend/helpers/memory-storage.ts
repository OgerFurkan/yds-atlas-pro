export function installMemoryStorage(key: "localStorage" | "sessionStorage" = "localStorage") {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
    clear: () => values.clear(),
  };
  Object.defineProperty(globalThis, key, { configurable: true, value: storage });
  return {
    storage,
    restore() {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    },
  };
}
