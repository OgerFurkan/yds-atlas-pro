import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GuidedTour, type GuideStep } from "@/shared/ui/guided-tour";
import type { LibraryView } from "./library-view-tabs";

export function useLibraryGuide({ activeView }: { activeView: LibraryView }) {
  const { t } = useTranslation();
  const [libraryGuide, setLibraryGuide] = useState<number | null>(null);
  useEffect(() => {
    const onHelp = () => {
      if (activeView === "plan") window.dispatchEvent(new Event("atlas:daily-plan-help"));
      else setLibraryGuide(0);
    };
    window.addEventListener("atlas:help-request", onHelp);
    return () => window.removeEventListener("atlas:help-request", onHelp);
  }, [activeView]);
  const librarySteps: GuideStep[] = [
    {
      id: "library-overview",
      target: "#library-page-header",
      title: t("nav.libraryGuideIntro"),
      description: t("nav.libraryGuideIntroDescription"),
    },
    {
      id: "library-tabs",
      target: "#library-view-tabs",
      title: t("nav.libraryGuideTabs"),
      description: t("nav.libraryGuideTabsDescription"),
    },
    {
      id: "library-words",
      target: "#library-word-controls",
      title: t("nav.libraryGuideWords"),
      description: t("nav.libraryGuideWordsDescription"),
    },
  ];
  return (
    <>
      {libraryGuide !== null && activeView === "words" && (
        <GuidedTour
          step={librarySteps[libraryGuide]}
          index={libraryGuide}
          total={librarySteps.length}
          name={t("nav.libraryGuide")}
          onNext={() =>
            setLibraryGuide((current) =>
              current === null || current >= librarySteps.length - 1 ? null : current + 1,
            )
          }
          onExit={() => setLibraryGuide(null)}
        />
      )}
    </>
  );
}
