import { useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GuideStep } from "@/shared/ui/guided-tour";

export function useDailyPlanGuide(closeDay: () => void) {
  const { t } = useTranslation();
  const onExternalGuide = useEffectEvent(closeDay);
  const [tourStep, setTourStep] = useState<number | null>(null);
  useEffect(() => {
    const startGuide = () => {
      onExternalGuide();
      setTourStep(0);
    };
    window.addEventListener("atlas:daily-plan-help", startGuide);
    if (sessionStorage.getItem("atlas:daily-plan-help") === "1") {
      sessionStorage.removeItem("atlas:daily-plan-help");
      startGuide();
    }
    return () => window.removeEventListener("atlas:daily-plan-help", startGuide);
  }, []);
  const tourSteps: GuideStep[] = [
    {
      id: "overview",
      target: "#daily-plan-hero",
      title: t("library.daily.manage.tourOverviewTitle"),
      description: t("library.daily.manage.tourOverviewDescription"),
    },
    {
      id: "target",
      target: "#daily-plan-target-selector",
      title: t("library.daily.manage.tourTargetTitle"),
      description: t("library.daily.manage.tourTargetDescription"),
    },
    {
      id: "days",
      target: "#daily-plan-groups",
      title: t("library.daily.manage.tourDaysTitle"),
      description: t("library.daily.manage.tourDaysDescription"),
    },
    {
      id: "bulk",
      target: "#daily-plan-bulk-add",
      title: t("library.daily.manage.tourBulkTitle"),
      description: t("library.daily.manage.tourBulkDescription"),
    },
    {
      id: "study",
      target: "#daily-plan-study-area",
      title: t("library.daily.manage.tourStudyTitle"),
      description: t("library.daily.manage.tourStudyDescription"),
    },
  ];
  return { tourStep, setTourStep, tourSteps };
}
