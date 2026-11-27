import type { OnlineAction, OnlineStart, OnlineView, WordEntry } from "@yds-atlas/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, accountRequest } from "@/shared/api/api-client";
import { readStorage, writeStorage } from "@/shared/lib/storage";
import { getStorageScope } from "@/shared/lib/storage-scope";

export function useOnlineAssessment(owner: string | undefined) {
  const api = useMemo(() => (owner ? accountRequest(owner) : null), [owner]);
  const root = "/api/learning/online";
  const receiptKey = "atlas-online-assessment-receipt-v1";
  const [view, setView] = useState<OnlineView | null>(null);
  const [busy, setBusy] = useState(!!owner);
  const [error, setError] = useState("");
  const [practice, setPractice] = useState(false);
  const pending = useRef<{ path: string; body: string } | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const current = useCallback(() => alive.current && owner === getStorageScope(), [owner]);
  const refresh = useCallback(async () => {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const receipt: unknown = readStorage(receiptKey, null);
      const resume = async () => {
        if (typeof receipt === "string" && /^[a-f0-9-]{36}$/i.test(receipt)) {
          try {
            return await api<OnlineView>(root + "/" + receipt);
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 404) throw error;
          }
        }
        return (await api<{ current: OnlineView | null }>(root)).current;
      };
      const response = await resume();
      if (current()) {
        setView(response);
        if (response)
          try {
            writeStorage(receiptKey, response.id, owner);
          } catch {
            /* Resume remains available on the server. */
          }
        setError("");
      }
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Oturum okunamadı.");
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }, [api, current, owner]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (alive.current) return refresh();
    });
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  async function send(path: string, body: string) {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    pending.current = { path, body };
    try {
      const response = await api<OnlineView>(path, { method: "POST", body });
      if (current()) {
        setView(response);
        try {
          writeStorage(receiptKey, response.id, owner);
        } catch {
          /* Keep the current response available. */
        }
        setError("");
        pending.current = null;
      }
    } catch (e) {
      if (current()) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408)
          pending.current = null;
        setError(e instanceof Error ? e.message : "Değerlendirme kaydı doğrulanamadı.");
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  return {
    view,
    busy,
    error,
    practice,
    setPractice,
    retry() {
      const p = pending.current;
      return p ? send(p.path, p.body) : refresh();
    },
    start(words: WordEntry[], batchSize: 5 | 10, day?: number) {
      const payload: OnlineStart = {
        command: crypto.randomUUID(),
        words: words.map((w) => w.id),
        batchSize,
        day,
      };
      return send(root, JSON.stringify(payload));
    },
    act(action: OnlineAction) {
      if (view)
        return send(
          root + "/" + view.id,
          JSON.stringify({ command: crypto.randomUUID(), revision: view.revision, action }),
        );
    },
    forget() {
      try {
        writeStorage(receiptKey, null, owner);
      } catch {
        /* The receipt contains only a session ID. */
      }
    },
  };
}
