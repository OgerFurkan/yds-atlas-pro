import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { withLocalWordWrite } from "@/features/word-library/api/local-word-repository";
import { supabase } from "@/shared/api/supabase-client";
import { readStoredText } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { setStorageScope } from "@/shared/lib/storage-scope";
import { Button } from "@/shared/ui/button";
import { createAccountApi } from "../api/account-api";
import {
  type AccountBootstrap,
  AccountDraftConflict,
  adoptRemoteSession,
  bootstrapAccount,
} from "../model/account-cache";
export function AccountWorkspace({
  userId,
  children,
}: {
  userId: string | null;
  children: (
    api: ReturnType<typeof createAccountApi> | null,
    initial: AccountBootstrap | null,
  ) => ReactNode;
}) {
  setStorageScope(userId);
  const api = useMemo(() => (userId ? createAccountApi(userId) : null), [userId]);
  const [initial, setInitial] = useState<AccountBootstrap | null>(null);
  const [ready, setReady] = useState(!userId);
  const [conflict, setConflict] = useState<{ raw: string; revision: number } | null>(null);
  const [error, setError] = useState("");
  const [loadingRequested, setLoadingRequested] = useState(true);
  useEffect(() => {
    if (!api || !userId || !loadingRequested) return;
    let active = true;
    const load = async () => {
      const before = readStoredText(storageKeys.gameSession);
      const state = await api.load();
      return { before, state };
    };
    void load()
      .then(async ({ before, state }) => {
        if (!active) return;
        try {
          const initial = await withLocalWordWrite(() => {
            if (active)
              return bootstrapAccount(
                state,
                before === readStoredText(storageKeys.gameSession),
                userId,
              );
          });
          if (!active || !initial) return;
          setInitial(initial);
        } catch (cause) {
          if (active && cause instanceof AccountDraftConflict && before && state.session)
            setConflict({ raw: before, revision: state.session.revision });
          throw cause;
        }
        if (!active) return;
        setReady(true);
        setError("");
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : "Hesap yüklenemedi.");
      })
      .finally(() => {
        if (active) setLoadingRequested(false);
      });
    return () => {
      active = false;
    };
  }, [api, loadingRequested, userId]);
  if (!ready)
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-5 py-12 text-center">
        <img
          src="/brand/atlas-mascot.png"
          alt=""
          className="h-44 w-44 object-contain sm:h-56 sm:w-56"
        />
        {!error && (
          <LoaderCircle
            aria-hidden="true"
            className="size-8 animate-spin text-atlas-orange motion-reduce:animate-none"
          />
        )}
        <h1 className="text-xl font-bold text-atlas-navy">
          {error ? "Hesabın yüklenemedi" : "Hesabın hazırlanıyor"}
        </h1>
        <p role="status" className="text-sm text-slate-600">
          {error || "Kelimelerin ve ilerlemen yükleniyor…"}
        </p>
        {error && conflict && userId && api && (
          <Button
            variant="outline"
            disabled={loadingRequested}
            onClick={async () => {
              if (
                !window.confirm(
                  "Yerel taslağın özgün kopyasını bu cihazda saklayıp buluttaki oturumu kullan? Puan eklenmez.",
                )
              )
                return;
              try {
                const state = await api.load();
                if (state.session?.revision !== conflict.revision)
                  throw new Error("Bulut sürümü değişti. Yeniden dene.");
                await withLocalWordWrite(() => adoptRemoteSession(userId, conflict.raw, state));
                setConflict(null);
                setLoadingRequested(true);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Taslak korundu.");
              }
            }}
          >
            Taslağı sakla ve bulut oturumunu kullan
          </Button>
        )}
        {error && (
          <div className="flex justify-center gap-2">
            <Button
              onClick={() => {
                setConflict(null);
                setError("");
                setLoadingRequested(true);
              }}
            >
              Yeniden dene
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const result = await supabase?.auth.signOut({ scope: "local" });
                  if (result?.error) setError("Çıkış yapılamadı.");
                } catch {
                  setError("Çıkış yapılamadı.");
                }
              }}
            >
              Çıkış yap
            </Button>
          </div>
        )}
      </main>
    );
  return children(api, initial);
}
