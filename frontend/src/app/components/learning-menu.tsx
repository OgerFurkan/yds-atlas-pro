import { ChevronDown, GraduationCap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { learningActivities } from "../config/learning-activities";

export function LearningMenu({
  active,
  onChoose,
}: {
  active: boolean;
  onChoose: (screen: (typeof learningActivities)[number]["screen"]) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={`group h-11 w-full justify-start text-sm xl:w-auto ${active ? "bg-blue-50 text-atlas-navy" : ""}`}
        >
          <GraduationCap size={18} />
          {t("nav.learn")}
          <ChevronDown
            size={14}
            className="ml-auto transition-transform group-data-[state=open]:rotate-180 xl:ml-1"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={18}
        align="start"
        className="w-[min(340px,calc(100vw-24px))] rounded-xl p-2 shadow-lg"
      >
        <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold tracking-wider text-slate-400">
          {t("nav.learningGames")}
        </DropdownMenuLabel>
        {learningActivities.map((activity) => (
          <DropdownMenuItem
            key={activity.id}
            className="cursor-pointer gap-3 rounded-lg p-3"
            onSelect={() => onChoose(activity.screen)}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600">
              <activity.icon size={23} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold text-atlas-navy">
                {t("nav.dailyTask")}
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-atlas-blue">
                  {t("nav.new")}
                </span>
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                {t("nav.learnWords")}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-3 py-2 text-xs leading-5 text-slate-400">{t("nav.moreGames")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
