import { accountRequest } from "@/shared/api/api-client";
import type { Revision } from "../components/revision-history";
import type { EditorialDraftItem } from "../model/editorial-draft";
export type ControlEntry = Omit<EditorialDraftItem, "entryId"> & { id: string; status: string };

export function controlApi(owner: string) {
  const api = accountRequest(owner);
  return {
    access: (init: RequestInit) => api("/api/control", init),
    search: (query: string) =>
      api<ControlEntry[]>("/api/control/entries?word=" + encodeURIComponent(query)),
    legacy: (query: string) =>
      api<unknown[]>("/api/control/legacy?word=" + encodeURIComponent(query)),
    history: (id: string, before?: number) =>
      api<Revision[]>(
        "/api/control/history?id=" + id + (before === undefined ? "" : "&before=" + before),
      ),
    draft: (word: string) =>
      api<Pick<EditorialDraftItem, "content" | "provenance">>("/api/control/draft", {
        method: "POST",
        body: JSON.stringify({ word }),
      }),
    publish: (body: unknown) =>
      api("/api/control/revisions", { method: "POST", body: JSON.stringify(body) }),
  };
}
