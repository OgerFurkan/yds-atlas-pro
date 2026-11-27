import { Check, Pencil, Plus } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { withOccurrenceKeys } from "@/shared/lib/occurrence-keys";
import { Button } from "@/shared/ui/button";

export function WordExampleEditor({
  examplesPreview,
  editingExample,
  draftEnglish,
  draftTurkish,
  setDraftEnglish,
  setDraftTurkish,
  beginExampleEdit,
  commitExampleEdit,
  cancelEdit,
  examplesField,
  inputClass,
  labelClass,
}: {
  examplesPreview: string[];
  editingExample: number | "new" | null;
  draftEnglish: string;
  draftTurkish: string;
  setDraftEnglish: (value: string) => void;
  setDraftTurkish: (value: string) => void;
  beginExampleEdit: (index: number | "new") => void;
  commitExampleEdit: () => void;
  cancelEdit: () => void;
  examplesField: UseFormRegisterReturn<"examples">;
  inputClass: string;
  labelClass: string;
}) {
  return (
    <section className="space-y-3 border-t border-border/70 pt-5" aria-label="Örnek cümleler">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">Örnek cümleler</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cümleleri yanındaki kalemle ayrı ayrı düzenle.
          </p>
        </div>
        <Button size="sm" type="button" variant="outline" onClick={() => beginExampleEdit("new")}>
          <Plus size={15} /> Cümle ekle
        </Button>
      </div>
      {/* Keep the RHF field registered; the row editor writes to this single canonical value. */}
      <textarea {...examplesField} className="sr-only" tabIndex={-1} aria-hidden="true" />
      <section
        className="overflow-hidden rounded-xl border border-border/70 bg-background"
        aria-label="Örnek cümle listesi"
      >
        {withOccurrenceKeys(examplesPreview, (example) => example).map(
          ({ item: line, key }, index) => {
            const separator = line.indexOf("|");
            const english = separator < 0 ? line : line.slice(0, separator).trim();
            const turkish = separator < 0 ? "" : line.slice(separator + 1).trim();
            return (
              <div key={key} className="border-b border-border/55 p-3 last:border-b-0 sm:px-4">
                {editingExample === index ? (
                  <section className="space-y-2" aria-label={`${index + 1}. örneği düzenle`}>
                    <label className={labelClass}>
                      İngilizce cümle
                      <textarea
                        className={`${inputClass} min-h-16 py-2`}
                        value={draftEnglish}
                        onChange={(event) => setDraftEnglish(event.target.value)}
                        rows={2}
                      />
                    </label>
                    <label className={labelClass}>
                      Türkçe çeviri
                      <textarea
                        className={`${inputClass} min-h-16 py-2`}
                        value={draftTurkish}
                        onChange={(event) => setDraftTurkish(event.target.value)}
                        rows={2}
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" type="button" variant="ghost" onClick={cancelEdit}>
                        Vazgeç
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        disabled={!draftEnglish.trim()}
                        onClick={commitExampleEdit}
                      >
                        <Check size={15} /> Uygula
                      </Button>
                    </div>
                  </section>
                ) : (
                  <div className="flex items-start gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-0.5 size-9 shrink-0 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground"
                      aria-label={`${index + 1}. örnek cümleyi düzenle`}
                      title="Cümleyi düzenle"
                      onClick={() => beginExampleEdit(index)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-6 text-foreground">{english}</p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {turkish || "Türkçe çeviri eklenmemiş"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          },
        )}
        {examplesPreview.length === 0 && (
          <p className="p-4 text-xs text-muted-foreground">Henüz örnek cümle yok.</p>
        )}
      </section>
      {editingExample === "new" && (
        <section
          className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3"
          aria-label="Yeni örnek cümle"
        >
          <label className={labelClass}>
            İngilizce cümle
            <textarea
              className={`${inputClass} min-h-16 py-2`}
              value={draftEnglish}
              onChange={(event) => setDraftEnglish(event.target.value)}
              rows={2}
            />
          </label>
          <label className={labelClass}>
            Türkçe çeviri
            <textarea
              className={`${inputClass} min-h-16 py-2`}
              value={draftTurkish}
              onChange={(event) => setDraftTurkish(event.target.value)}
              rows={2}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
              Vazgeç
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!draftEnglish.trim()}
              onClick={commitExampleEdit}
            >
              <Check size={15} /> Ekle
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
