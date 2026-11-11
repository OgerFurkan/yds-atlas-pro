import { getWordGroup, type WordGroup } from "@yds-atlas/shared";
import { CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

const tones: Record<WordGroup, string> = {
  hard: "bg-orange-50 text-orange-800",
  review: "bg-amber-50 text-amber-800",
  learned: "bg-emerald-50 text-emerald-800",
};

export function WordStatus({ score }: { score: number }) {
  const { t } = useTranslation();
  const group = getWordGroup(score);
  return (
    <span
      className={`inline-flex min-h-7 w-fit items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-semibold ${tones[group]}`}
    >
      {group === "learned" ? (
        <CircleCheck size={12} />
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
      {t(`wordStatus.${group}`)}
    </span>
  );
}
