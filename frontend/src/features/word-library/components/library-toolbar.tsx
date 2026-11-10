import type { CefrLevel } from "@yds-atlas/shared";
import { Search } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import type { SortMode } from "../model/word-library-view";

const levels: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function LibraryToolbar({
  search,
  onSearchChange,
  level,
  onLevelChange,
  sort,
  onSortChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  level: CefrLevel | "all";
  onLevelChange: (value: CefrLevel | "all") => void;
  sort: SortMode;
  onSortChange: (value: SortMode) => void;
}) {
  return (
    <div className="flex min-h-17 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 max-sm:flex-col max-sm:items-stretch">
      <label className="flex h-10 w-full max-w-91.25 items-center gap-2 rounded-md border border-slate-200 px-3 text-slate-400 transition focus-within:border-sky-700/50 focus-within:ring-2 focus-within:ring-sky-800/10">
        <Search size={17} />
        <Input
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Kelime, anlam veya eş anlamlı ara"
          aria-label="Kelimelerde ara"
        />
      </label>
      <div className="flex gap-2 max-sm:grid max-sm:grid-cols-2">
        <div className="flex h-10 min-w-[150px] items-center gap-2 rounded-md border border-slate-200 px-2.5 text-xs text-slate-400 max-sm:min-w-0">
          <span className="shrink-0">Seviye</span>
          <Select
            value={level}
            onValueChange={(value) => onLevelChange(value as CefrLevel | "all")}
          >
            <SelectTrigger
              aria-label="Seviye filtresi"
              className="h-full flex-1 border-0 px-0 text-sm font-semibold"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm seviyeler</SelectItem>
              {levels.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex h-10 min-w-[160px] items-center gap-2 rounded-md border border-slate-200 px-2.5 text-xs text-slate-400 max-sm:min-w-0">
          <span className="shrink-0">Sırala</span>
          <Select value={sort} onValueChange={(value) => onSortChange(value as SortMode)}>
            <SelectTrigger
              aria-label="Sıralama"
              className="h-full flex-1 border-0 px-0 text-sm font-semibold"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Son eklenen</SelectItem>
              <SelectItem value="alphabetical">Alfabetik</SelectItem>
              <SelectItem value="score">Puana göre</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
