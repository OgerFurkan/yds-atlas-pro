import type { SpellcheckResult } from "../model/spellcheck.types";

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: SpellcheckResult) => void; reject: (reason: Error) => void }
>();

function resetWorker(message: string) {
  for (const request of pending.values()) request.reject(new Error(message));
  pending.clear();
  worker?.terminate();
  worker = undefined;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("../workers/spellcheck.worker.ts", import.meta.url), {
    type: "module",
  });
  created.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    if (data.error) {
      resetWorker(data.error);
      return;
    }
    pending.delete(data.id);
    request.resolve(data.result);
  };
  created.onerror = () => {
    resetWorker("Yazım denetimi başlatılamadı. Yeniden deneyebilirsin.");
  };
  worker = created;
  return created;
}

export function checkSpelling(word: string): Promise<SpellcheckResult> {
  const activeWorker = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    activeWorker.postMessage({ id, word });
  });
}
