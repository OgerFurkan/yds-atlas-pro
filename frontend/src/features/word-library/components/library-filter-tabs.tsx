import type { GroupFilter, WordCounts } from "../model/word-library-view";

const groups: { id: GroupFilter; label: string }[] = [
  { id: "all", label: "Tüm kelimeler" },
  { id: "hard", label: "Zorlanılan" },
  { id: "review", label: "Tekrar gerektiren" },
  { id: "learned", label: "Öğrenilen" },
];

import { useTranslation } from "react-i18next";

export function LibraryFilterTabs({
  group,
  counts,
  onChange,
}: {
  group: GroupFilter;
  counts: WordCounts;
  onChange: (group: GroupFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 items-stretch gap-x-3 border-b border-slate-200 px-3 py-1 sm:flex sm:flex-wrap sm:gap-x-5 sm:px-5">
      {groups.map((item) => (
        <button
          key={item.id}
          className={`relative flex min-h-10 min-w-0 items-center gap-2 text-left text-xs leading-4 transition-colors sm:min-h-[50px] sm:whitespace-nowrap ${group === item.id ? "font-bold text-atlas-navy after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-atlas-orange" : "text-slate-500 hover:text-atlas-navy"}`}
          type="button"
          aria-pressed={group === item.id}
          onClick={() => onChange(item.id)}
        >
          {t(`library.filters.${item.id}`)}
          <span
            className={`grid min-w-4.5 place-items-center rounded px-1 py-0.5 text-xs ${group === item.id ? "bg-orange-50 text-atlas-orange-dark" : "bg-slate-100 text-slate-500"}`}
          >
            {counts[item.id]}
          </span>
        </button>
      ))}
    </div>
  );
}
