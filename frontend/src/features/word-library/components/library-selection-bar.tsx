import { CheckCheck, Trash2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";

export function LibrarySelectionBar({
  count,
  onDelete,
  onClear,
}: {
  count: number;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-orange-100 bg-orange-50/60 px-4">
      <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold text-orange-900">
        <CheckCheck size={16} /> {count} kelime seçildi
      </span>
      <Button variant="destructive" size="sm" type="button" onClick={onDelete}>
        <Trash2 size={15} /> Seçilenleri sil
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="Seçimi temizle"
        onClick={onClear}
      >
        <X size={15} />
      </Button>
    </div>
  );
}
