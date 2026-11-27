import { Button } from "@/shared/ui/button";
import type { ControlEntry } from "../api/control-api";
export function ControlLexicon({
  query,
  setQuery,
  legacy,
  entries,
  onSearch,
  onLegacy,
  onSelect,
}: {
  query: string;
  setQuery: (query: string) => void;
  legacy: unknown[];
  entries: ControlEntry[];
  onSearch: () => void;
  onLegacy: () => void;
  onSelect: (row: ControlEntry) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Ortak havuz</h2>
      <label>
        İngilizce kelime{" "}
        <input
          className="rounded border p-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <Button onClick={() => onSearch()}>Ara</Button>
      <Button variant="outline" onClick={() => onLegacy()}>
        Tarihsel kaynağı incele
      </Button>
      {legacy.length > 0 && (
        <details open>
          <summary>Kaynak, lisans ve revizyon</summary>
          <pre className="overflow-auto">{JSON.stringify(legacy, null, 2)}</pre>
          <p>
            Doğruladığın anlama ait kaynak kimliğini, sürümü ve özeti taslağın legacy alanına ekle.
            Özgün kayıt saklanır.
          </p>
        </details>
      )}
      {entries.map((row) => (
        <div key={row.id}>
          <Button variant="outline" onClick={() => onSelect(row)}>
            {row.content.word} · {row.content.partOfSpeech} · {row.content.meanings[0]} · v
            {row.revision} · {row.status}
          </Button>
        </div>
      ))}
    </section>
  );
}
