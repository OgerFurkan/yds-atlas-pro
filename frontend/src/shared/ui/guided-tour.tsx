import { driver } from "driver.js";
import { MousePointer2 } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import "driver.js/dist/driver.css";
import { usePrefersReducedMotion } from "@/shared/hooks/use-prefers-reduced-motion";

export interface GuideStep {
  id: string;
  target: string;
  title: string;
  description: string;
  action?: boolean;
  actionTarget?: string;
}

export function GuidedTour({
  step,
  index,
  total,
  name,
  onNext,
  onExit,
}: {
  step: GuideStep;
  index: number;
  total: number;
  name: string;
  onNext: () => void;
  onExit: () => void;
}) {
  const [cursor, setCursor] = useState<{ left: number; top: number } | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const handleNext = useEffectEvent(onNext);
  const handleExit = useEffectEvent(onExit);
  useEffect(() => {
    const tour = driver({
      animate: !reducedMotion,
      overlayColor: "#071c2d",
      overlayOpacity: 0.68,
      stagePadding: 7,
      stageRadius: 14,
      popoverOffset: 14,
      smoothScroll: false,
      allowKeyboardControl: false,
      overlayClickBehavior: "none",
      popoverClass: "atlas-guide",
      allowClose: true,
      allowedElements: ["#tutorial-restart", "#pronunciation-recovery"],
    });
    const update = () => {
      const target = document.querySelector(step.target);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const popover = document.querySelector<HTMLElement>(".driver-popover.atlas-guide");
      if (popover) {
        popover.dataset.guideStep = step.id;
        // The callout stays away from the target's clickable centre, including
        // wide cards and targets moved by the user's scroll position.
        const above = rect.top + rect.height / 2 >= window.innerHeight / 2;
        Object.assign(popover.style, {
          position: "fixed",
          left: "auto",
          right: window.innerWidth < 640 ? "14px" : "20px",
          top: above ? "14px" : "auto",
          bottom: above ? "auto" : "14px",
          maxHeight: `${Math.min(380, window.innerHeight * 0.42)}px`,
        });
      }
      const actionElement = step.actionTarget
        ? document.querySelector(step.actionTarget)
        : target.matches("button, input, textarea, [role='tab']")
          ? target
          : target.querySelector("button:not(:disabled), [role='tab'], input:not(:disabled)");
      const actionRect = actionElement?.getBoundingClientRect();
      const nextCursor =
        step.action && actionRect
          ? {
              left: actionRect.left + actionRect.width / 2 - 5,
              top: actionRect.top + actionRect.height / 2 - 4,
            }
          : null;
      setCursor((previous) =>
        previous?.left === nextCursor?.left && previous?.top === nextCursor?.top
          ? previous
          : nextCursor,
      );
    };
    const frame = requestAnimationFrame(() => {
      tour.highlight({
        element: step.target,
        disableActiveInteraction: !step.action,
        popover: {
          title: `${name} · ${index + 1}/${total}`,
          description: `<strong>${step.title}</strong><p>${step.description}</p>${step.action ? '<span class="guide-action-hint">Vurgulanan alana tıklayarak dene.</span>' : ""}`,
          side: window.innerWidth < 640 ? "bottom" : "right",
          align: "center",
          showButtons: step.action ? ["close"] : ["next", "close"],
          nextBtnText: index + 1 === total ? "Rehberi bitir" : "Anladım, devam et",
          onNextClick: handleNext,
          onCloseClick: handleExit,
          closeBtnLabel: "Rehberi kapat",
          onPopoverRender: update,
        },
      });
      update();
    });
    const timer = window.setInterval(() => {
      tour.refresh();
      requestAnimationFrame(update);
    }, 100);
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleExit();
    };
    window.addEventListener("keydown", exitOnEscape, true);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener("keydown", exitOnEscape, true);
      tour.destroy();
    };
  }, [step, index, total, name, reducedMotion]);

  return (
    cursor &&
    createPortal(
      <div
        data-testid="guide-cursor"
        aria-hidden="true"
        className="pointer-events-none fixed z-[1000000001] origin-[5px_4px] motion-safe:animate-guide-tap"
        style={{ left: cursor.left, top: cursor.top }}
      >
        <span className="absolute left-[5px] top-1 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-orange-300 motion-safe:animate-ping" />
        <MousePointer2 size={30} className="relative fill-white text-atlas-orange drop-shadow-lg" />
      </div>,
      document.body,
    )
  );
}
