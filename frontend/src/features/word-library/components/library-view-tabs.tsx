import { CalendarDays, LibraryBig } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";

export type LibraryView = "words" | "plan";

export function LibraryViewTabs({
  value,
  wordCount,
  activeDays,
  onChange,
}: {
  value: LibraryView;
  wordCount: number;
  activeDays: number;
  onChange: (view: LibraryView) => void;
}) {
  const { t } = useTranslation();
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as LibraryView)} className="w-full">
      <TabsList className="h-auto w-full justify-start gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:w-fit">
        <TabsTrigger
          value="words"
          className="h-11 flex-none gap-2 rounded-xl px-3 data-[state=active]:bg-atlas-navy data-[state=active]:text-white data-[state=active]:shadow-md sm:px-5"
        >
          <LibraryBig size={17} />
          {t("library.views.words")}
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">
            {wordCount}
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="plan"
          className="h-11 flex-none gap-2 rounded-xl px-3 data-[state=active]:bg-atlas-navy data-[state=active]:text-white data-[state=active]:shadow-md sm:px-5"
        >
          <CalendarDays size={17} />
          {t("library.views.plan")}
          <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] font-bold text-orange-700">
            {t("library.daily.tabBadge", { count: activeDays })}
          </span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
