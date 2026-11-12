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
    <Tabs value={value} onValueChange={(next) => onChange(next as LibraryView)} className="min-w-0 w-full">
      {/* The two tabs must share available width on small screens. The old flex-none
          buttons plus always-visible count badges exceeded a 320px viewport. */}
      <TabsList className="grid h-auto w-full min-w-0 grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:inline-flex sm:w-fit">
        <TabsTrigger
          value="words"
          className="h-11 w-full min-w-0 gap-1.5 rounded-xl px-2 text-xs data-[state=active]:bg-[#123b59] data-[state=active]:text-white data-[state=active]:shadow-md sm:w-auto sm:flex-none sm:gap-2 sm:px-5 sm:text-sm"
        >
          <LibraryBig size={17} aria-hidden="true" />
          {t("library.views.words")}
          <span aria-hidden="true" className="hidden shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500 sm:inline-flex">
            {wordCount}
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="plan"
          className="h-11 w-full min-w-0 gap-1.5 rounded-xl px-2 text-xs data-[state=active]:bg-[#123b59] data-[state=active]:text-white data-[state=active]:shadow-md sm:w-auto sm:flex-none sm:gap-2 sm:px-5 sm:text-sm"
        >
          <CalendarDays size={17} aria-hidden="true" />
          {t("library.views.plan")}
          <span aria-hidden="true" className="hidden shrink-0 rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] font-bold text-orange-700 sm:inline-flex">
            {t("library.daily.tabBadge", { count: activeDays })}
          </span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
