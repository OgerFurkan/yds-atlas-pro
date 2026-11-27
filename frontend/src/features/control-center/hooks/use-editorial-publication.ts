import type { editorialCommand } from "@yds-atlas/shared";
import { useRef } from "react";
import type { z } from "zod";
import type { controlApi } from "../api/control-api";

type Command = z.infer<typeof editorialCommand>;
export function useEditorialPublication(api: ReturnType<typeof controlApi>) {
  const receipt = useRef<{ key: string; id: string } | null>(null);
  return async (
    command:
      | Omit<Extract<Command, { action: "publish" }>, "operation">
      | Omit<Extract<Command, { action: "restore" }>, "operation">
      | Omit<Extract<Command, { action: "quarantine" }>, "operation">,
  ) => {
    const key = JSON.stringify(command);
    if (!receipt.current || receipt.current.key !== key)
      receipt.current = { key, id: crypto.randomUUID() };
    await api.publish({ ...command, operation: receipt.current.id });
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("atlas-lexicon-revisions");
      channel.postMessage("published");
      channel.close();
    }
    receipt.current = null;
  };
}
