import type { WordEntry } from "@yds-atlas/shared";
import { getWordGroup } from "@yds-atlas/shared";
import {
  ArrowDownUp,
  ArrowRight,
  BookOpen,
  Check,
  CirclePlus,
  Compass,
  LibraryBig,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  completedToday,
  dailyGoal as getDailyGoal,
  setDailyGoal,
  stepDailyGoal,
} from "../model/daily-progress";
import { dateParts } from "../model/date";
import { DailyGoalHero } from "./daily-goal-hero";
import { RecentWord } from "./recent-word";
import { StreakCard } from "./streak-card";

interface DashboardPageProps {
  words: WordEntry[];
  onGoalChange: (goal: number) => void;
  onAddWord: () => void;
  onOpenLibrary: (group?: "all" | "hard" | "review" | "learned") => void;
  onStartLearning: () => void;
}

interface MetricCardProps {
  label: string;
  value: number;
  hint: string;
  tone: "blue" | "orange" | "gold" | "green";
  icon: React.ReactNode;
  onClick: () => void;
}

function MetricCard({ label, value, hint, tone, icon, onClick }: MetricCardProps) {
  const tones = {
    blue: "bg-sky-50 text-sky-800",
    orange: "bg-orange-50 text-orange-800",
    gold: "bg-amber-50 text-amber-800",
    green: "bg-emerald-50 text-emerald-800",
  };
  return (
    <button
      className="grid min-h-[126px] min-w-0 grid-cols-[36px_1fr] grid-rows-[30px_auto_auto] gap-x-3 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      type="button"
      onClick={onClick}
    >
      <span className={`row-span-2 grid size-9 place-items-center rounded-lg ${tones[tone]}`}>
        {icon}
      </span>
      <span className="self-center text-xs font-medium text-slate-600">{label}</span>
      <strong className="col-start-2 mt-2 text-[26px] leading-none font-semibold text-atlas-ink">
        {value}
      </strong>
      <small className="col-start-2 mt-1 text-[10px] text-slate-400">{hint}</small>
    </button>
  );
}

export function DashboardPage({
  words,
  onGoalChange,
  onAddWord,
  onOpenLibrary,
  onStartLearning,
}: DashboardPageProps) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const today = dateParts(now, i18n.resolvedLanguage === "en" ? "en-US" : "tr-TR");
  const [dailyGoal, setDailyGoalState] = useState(getDailyGoal);
  useEffect(() => {
    const refresh = () => setDailyGoalState(getDailyGoal());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const todayWords = completedToday();

  const counts = {
    all: words.length,
    hard: words.filter((word) => getWordGroup(word.score) === "hard").length,
    review: words.filter((word) => getWordGroup(word.score) === "review").length,
    learned: words.filter((word) => getWordGroup(word.score) === "learned").length,
  };

  function changeGoal(step: number) {
    const goal = stepDailyGoal(dailyGoal, step);
    if (goal === dailyGoal) return;
    setDailyGoalState(setDailyGoal(goal));
    onGoalChange(goal);
  }

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-start">
        <div>
          <p className="text-[10px] font-bold tracking-[1px] text-[#9a6d54]">{today.label}</p>
          <h1 className="mt-1 mb-1 text-[clamp(25px,2.4vw,34px)] leading-tight font-semibold text-atlas-ink">
            {t("dashboard.heading")}
          </h1>
          <p className="text-sm text-atlas-muted">{t("dashboard.subtitle")}</p>
        </div>
        <Button variant="secondary" className="max-sm:min-h-9" type="button" onClick={onAddWord}>
          <CirclePlus size={17} /> {t("dashboard.addWord")}
        </Button>
      </div>

      <DailyGoalHero
        goal={dailyGoal}
        completed={todayWords}
        onChange={changeGoal}
        onStart={onStartLearning}
      />

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold tracking-[1px] text-[#9a6d54]">
              {t("dashboard.libraryEyebrow")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-atlas-ink">{t("dashboard.summary")}</h2>
          </div>
          <Button
            variant="link"
            className="px-0 text-[11px]"
            type="button"
            onClick={() => onOpenLibrary()}
          >
            {t("dashboard.openLibrary")} <ArrowRight size={15} />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <MetricCard
            label={t("dashboard.total")}
            value={counts.all}
            hint={t("dashboard.totalHint")}
            tone="blue"
            icon={<LibraryBig size={18} />}
            onClick={() => onOpenLibrary("all")}
          />
          <MetricCard
            label={t("dashboard.hard")}
            value={counts.hard}
            hint={t("dashboard.hardHint")}
            tone="orange"
            icon={<Compass size={18} />}
            onClick={() => onOpenLibrary("hard")}
          />
          <MetricCard
            label={t("dashboard.review")}
            value={counts.review}
            hint={t("dashboard.reviewHint")}
            tone="gold"
            icon={<ArrowDownUp size={18} />}
            onClick={() => onOpenLibrary("review")}
          />
          <MetricCard
            label={t("dashboard.learned")}
            value={counts.learned}
            hint={t("dashboard.learnedHint")}
            tone="green"
            icon={<Check size={18} />}
            onClick={() => onOpenLibrary("learned")}
          />
        </div>
      </section>

      <section className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(240px,.8fr)]">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold tracking-[1px] text-[#9a6d54]">
                {t("dashboard.recent")}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-atlas-ink">{t("dashboard.words")}</h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={t("dashboard.showAll")}
              onClick={() => onOpenLibrary()}
            >
              <ArrowRight size={18} />
            </Button>
          </div>
          {words.length ? (
            <div className="flex flex-col">
              {words.slice(0, 4).map((word) => (
                <RecentWord key={word.id} word={word} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-24 flex-wrap items-center gap-3 border-t border-slate-100 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-atlas-blue">
                <BookOpen size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <strong className="text-xs text-slate-800">{t("dashboard.emptyTitle")}</strong>
                <p className="mt-1 text-[10px] text-slate-500">{t("dashboard.emptyDescription")}</p>
              </div>
              <Button variant="link" className="px-0 text-[10px]" type="button" onClick={onAddWord}>
                {t("dashboard.addWord")} <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </div>
        <StreakCard now={now} />
      </section>
    </>
  );
}
