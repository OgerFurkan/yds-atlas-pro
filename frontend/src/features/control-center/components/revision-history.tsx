import type { editorialCommand } from "@yds-atlas/shared";
import type { z } from "zod";
import { Button } from "@/shared/ui/button";

export type Revision = {
  revision: number;
  status: string;
  reason_code: string;
  created_at: string;
  content: unknown;
  provenance: unknown;
};

export function RevisionHistory({
  selected,
  reason,
  setReason,
  history,
  onApply,
  onLoadMore,
}: {
  selected: { id: string; revision: number };
  reason: string;
  setReason: (value: string) => void;
  history: Revision[];
  onApply: (
    command:
      | Omit<Extract<z.infer<typeof editorialCommand>, { action: "restore" }>, "operation">
      | Omit<Extract<z.infer<typeof editorialCommand>, { action: "quarantine" }>, "operation">,
  ) => void;
  onLoadMore: () => void;
}) {
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Revizyon geçmişi</h2>
      <label>
        İşlem gerekçesi{" "}
        <input
          className="rounded border p-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <Button
        disabled={!reason.trim()}
        variant="outline"
        onClick={() =>
          onApply({
            action: "quarantine",
            entryId: selected.id,
            revision: selected.revision,
            reason,
          })
        }
      >
        Karantinaya al
      </Button>
      {history.map((v) => (
        <details key={v.revision}>
          <summary>
            v{v.revision} · {v.status} · {v.created_at}
          </summary>
          <pre className="overflow-auto">
            {pretty({
              content: v.content,
              provenance: v.provenance,
              reason: v.reason_code,
            })}
          </pre>
          {v.status === "human_reviewed" && v.revision < selected.revision && (
            <Button
              disabled={!reason.trim()}
              onClick={() =>
                onApply({
                  action: "restore",
                  entryId: selected.id,
                  revision: selected.revision,
                  target: v.revision,
                  reason,
                })
              }
            >
              Bu revizyonu geri getir
            </Button>
          )}
        </details>
      ))}
      {history.length > 0 && history.length % 50 === 0 && (
        <Button onClick={onLoadMore}>Önceki revizyonlar</Button>
      )}
    </section>
  );
}
