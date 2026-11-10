import { useMemo } from "react";
import { toast } from "react-toastify";
import type { Notify } from "@/shared/lib/notify";

/** Typed notification port so features never import the toast library directly. */
export function useNotify(): Notify {
  return useMemo(
    () => ({
      success: (message) => toast.success(message),
      error: (message) => toast.error(message),
      info: (message) => toast.info(message),
    }),
    [],
  );
}
