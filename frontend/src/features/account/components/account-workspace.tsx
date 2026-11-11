import type { AccountState } from "@yds-atlas/shared";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/shared/api/supabase-client";
import { setStorageScope } from "@/shared/lib/storage-scope";
import { Button } from "@/shared/ui/button";
import { createAccountApi } from "../api/account-api";
import { cacheAccount } from "../model/account-cache";
export function AccountWorkspace({
  userId,
  children,
}: {
  userId: string | null;
  children: (
    api: ReturnType<typeof createAccountApi> | null,
    initial: AccountState | null,
  ) => ReactNode;
}) {
  const api = useMemo(() => (userId ? createAccountApi(userId) : null), [userId]);
  const [initial, setInitial] = useState<AccountState | null>(null);
  const [ready, setReady] = useState(!userId);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  setStorageScope(userId);
  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .load()
      .then((state) => {
        if (!active) return;
        cacheAccount(state, true, userId);
        setInitial(state);
        setReady(true);
        setError("");
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : "Hesap yüklenemedi.");
      });
    return () => {
      active = false;
    };
  }, [api, retry, userId]);
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
        {error && (
          <div className="flex justify-center gap-2">
            <Button
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
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
