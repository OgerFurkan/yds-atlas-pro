import type { editorialCommand } from "@yds-atlas/shared";
import { useRef, useState } from "react";
import type { z } from "zod";
import { setStorageScope } from "@/shared/lib/storage-scope";
import { controlApi } from "../api/control-api";
import { useControlAccess } from "../hooks/use-control-access";
import { useEditorialDraft } from "../hooks/use-editorial-draft";
import { useEditorialPublication } from "../hooks/use-editorial-publication";
import type { EditorialDraftItem } from "../model/editorial-draft";
import { ControlEditorPanel } from "./control-editor-panel";
import { ControlLexicon } from "./control-lexicon";
import { ControlMfa } from "./control-mfa";
import { type Revision, RevisionHistory } from "./revision-history";

type Item = EditorialDraftItem;
type Command = z.infer<typeof editorialCommand>;
export default function ControlCenter({ owner }: { owner: string }) {
  setStorageScope(owner);
  const [error, setError] = useState("");
  const { access, verifyAgain } = useControlAccess(owner, setError);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<
    (Omit<Item, "entryId"> & { id: string; status: string })[]
  >([]);
  const [selected, select] = useState<{ id: string; revision: number } | null>(null),
    [history, setHistory] = useState<Revision[]>([]);
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState<unknown[]>([]);
  const api = controlApi(owner);
  const editor = useEditorialDraft(api);
  const publish = useEditorialPublication(api);
  const operation = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem tamamlanamadı.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function apply(
    command:
      | Omit<Extract<Command, { action: "publish" }>, "operation">
      | Omit<Extract<Command, { action: "restore" }>, "operation">
      | Omit<Extract<Command, { action: "quarantine" }>, "operation">,
  ) {
    await publish(command);
    setEntries([]);
    select(null);
    setHistory([]);
    setError("Revizyon kaydedildi. Güncel kaydı arayabilirsin.");
  }
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 text-atlas-ink">
      <header className="flex flex-wrap justify-between gap-3">
        <h1 className="text-2xl font-bold">Atlas Control Center</h1>
        <a href="#home" className="underline">
          Öğrenmeye dön
        </a>
      </header>
      {error && <p role="status">{error}</p>}
      {access === "loading" && <p>Yönetim yetkisi doğrulanıyor…</p>}
      {access === "mfa" && <ControlMfa busy={busy} run={run} onVerified={verifyAgain} />}
      {access === "ready" && (
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <ControlLexicon
            query={query}
            setQuery={setQuery}
            entries={entries}
            legacy={legacy}
            onSearch={() =>
              void run(async () => {
                const rows = await api.search(query);
                setEntries(rows);
                setLegacy([]);
                select(null);
                setHistory([]);
                if (!rows.length) setError("Kayıt bulunamadı.");
              })
            }
            onLegacy={() =>
              void run(async () => {
                const rows = await api.legacy(query);
                setLegacy(rows);
                if (!rows.length) setError("Tarihsel Tooltip kaydı bulunamadı.");
              })
            }
            onSelect={(row) =>
              void run(async () => {
                const versions = await api.history(row.id);
                select({ id: row.id, revision: row.revision });
                setHistory(versions);
                editor.load(row);
              })
            }
          />
          <ControlEditorPanel
            editor={editor}
            selected={selected}
            run={run}
            onPublish={(items) => apply({ action: "publish", items })}
          />
          {selected && (
            <RevisionHistory
              selected={selected}
              reason={reason}
              setReason={setReason}
              history={history}
              onApply={(command) => void run(() => apply(command))}
              onLoadMore={() =>
                void run(async () => {
                  const older = await api.history(selected.id, history.at(-1)?.revision);
                  if (!older.length) setError("Geçmişin sonuna ulaşıldı.");
                  setHistory([...history, ...older]);
                })
              }
            />
          )}
        </fieldset>
      )}
    </main>
  );
}
