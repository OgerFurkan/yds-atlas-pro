import { CheckCheck, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-orange-100 bg-orange-50/60 px-4">
      <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold text-orange-900">
        <CheckCheck size={16} /> {t("library.selectedCount", { count })}
      </span>
      <Button variant="destructive" size="sm" type="button" onClick={onDelete}>
        <Trash2 size={15} /> {t("library.deleteSelected")}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label={t("library.clearSelection")}
        onClick={onClear}
      >
        <X size={15} />
      </Button>
    </div>
  );
}
