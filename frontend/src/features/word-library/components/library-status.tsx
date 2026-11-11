import { ArrowRight, CirclePlus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

export function LibraryStatus({
  loading,
  loadError,
  onReload,
}: {
  loading: boolean;
  loadError: string;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  if (loading)
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-xs text-slate-500">
        <span className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-atlas-blue" />
        {t("library.loading")}
      </div>
    );
  if (loadError)
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-4 text-center">
        <strong className="text-sm text-red-800">{t("library.connectionError")}</strong>
        <span className="text-xs text-slate-500">{loadError}</span>
        <Button variant="link" type="button" onClick={onReload}>
          {t("library.retry")}
        </Button>
      </div>
    );
  return null;
}

export function LibraryNoResults({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-4 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500">
        <Search size={20} />
      </span>
      <strong className="text-sm text-slate-800">{t("library.noMatch")}</strong>
      <span className="text-xs text-slate-500">{t("library.resetHint")}</span>
      <Button variant="link" type="button" onClick={onReset}>
        {t("library.clearFilters")}
      </Button>
    </div>
  );
}

export function LibraryEmpty({ onAdd, onBulk }: { onAdd: () => void; onBulk: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[350px] flex-col items-center justify-center px-5 py-9 text-center">
      <div className="mb-4 grid size-24 place-items-center rounded-full bg-orange-50">
        <img
          className="size-20 object-contain"
          src="/brand/atlas-mascot.png"
          alt={t("library.mascot")}
        />
      </div>
      <p className="text-xs font-bold tracking-[1px] text-orange-900/70">
        {t("library.firstPage")}
      </p>
      <h2 className="mt-2 font-display text-2xl font-medium text-atlas-navy">
        {t("library.ready")}
      </h2>
      <p className="mt-1 max-w-[370px] text-xs leading-5 text-slate-500">
        {t("library.emptyHint")}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Button type="button" onClick={onAdd}>
          <CirclePlus size={16} /> {t("library.firstWord")}
        </Button>
        <Button variant="link" type="button" onClick={onBulk}>
          {t("library.upload")} <ArrowRight size={15} />
        </Button>
      </div>
    </div>
  );
}
