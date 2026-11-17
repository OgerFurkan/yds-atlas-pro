import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";

export type AdminAccess = "disabled" | "guest" | "checking" | "allowed" | "denied" | "unavailable";

/** UI discovery only: the server checks the verified user ID on EVERY admin request. */
export const ADMIN_UI_ENABLED = import.meta.env.VITE_FEEDBACK_ADMIN_UI_ENABLED === "true";

export function useAdminAccess(userId: string | null): AdminAccess {
  const [last, setLast] = useState<{ userId: string; access: "allowed" | "denied" | "unavailable" } | null>(null);
  useEffect(() => {
    if (!userId || !ADMIN_UI_ENABLED) return;
    const controller = new AbortController();
    void apiRequest<{ admin: boolean }>("/api/admin/me", { signal: controller.signal }, userId)
      .then((value) => {
        if (!controller.signal.aborted)
          setLast({ userId, access: value?.admin === true ? "allowed" : "denied" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const code = (error as { status?: number })?.status;
        setLast({ userId, access: code === 401 || code === 403 ? "denied" : "unavailable" });
      });
    return () => controller.abort();
  }, [userId]);
  if (!ADMIN_UI_ENABLED) return "disabled";
  if (!userId) return "guest";
  return last?.userId === userId ? last.access : "checking";
}
