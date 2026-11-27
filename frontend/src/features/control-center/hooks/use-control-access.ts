import { useEffect, useState } from "react";
import { ApiError } from "@/shared/api/api-client";
import { controlApi } from "../api/control-api";
export function useControlAccess(owner: string, setError: (error: string) => void) {
  const [access, setAccess] = useState<"loading" | "ready" | "mfa" | "denied">("loading");
  const [tick, reload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    controlApi(owner)
      .access({
        signal: abort.signal,
        cache: tick ? "reload" : "no-store",
      })
      .then(() => {
        if (!abort.signal.aborted) setAccess("ready");
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setAccess(e instanceof ApiError && e.code === "CONTROL_MFA" ? "mfa" : "denied");
          setError(e.message);
        }
      });
    return () => abort.abort();
  }, [owner, tick, setError]);
  return { access, verifyAgain: () => reload((v) => v + 1) };
}
