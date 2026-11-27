import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

type TooltipPlacement = {
  anchor: HTMLElement;
  x: number;
  y: number;
  below: boolean;
  maxHeight: number;
  width: number;
  sheet: boolean;
};

/** A fixed portal escapes card/dialog overflow, and follows the anchored word on scroll. */
export function ViewportTooltip({
  anchor,
  id,
  children,
  onEscape,
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: HTMLElement | null;
  id: string;
  children: ReactNode;
  onEscape: () => void;
  onPointerEnter: () => void;
  onPointerLeave: (event: PointerEvent) => void;
}) {
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const boundary = document.createElement("div");
    boundary.className = "atlas-tooltip-boundary";
    document.body.appendChild(boundary);
    const viewport = window.visualViewport;
    function align() {
      if (!anchor?.isConnected) {
        setPlacement(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const safe = boundary.getBoundingClientRect();
      const top =
        Math.max(
          safe.top,
          viewport?.offsetTop ?? 0,
          document.querySelector("header.sticky")?.getBoundingClientRect().bottom ?? 0,
        ) + 8;
      const bottom =
        Math.min(safe.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)) - 8;
      const left = Math.max(safe.left, viewport?.offsetLeft ?? 0) + 10;
      const right =
        Math.min(safe.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth)) - 10;
      if (rect.bottom <= top || rect.top >= bottom || right <= left) {
        setPlacement(null);
        return;
      }
      const sentence =
        anchor.closest("[data-testid=english-sentence-tooltips]")?.getBoundingClientRect() ?? rect;
      const belowSpace = bottom - sentence.bottom - 8;
      const aboveSpace = sentence.top - top - 8;
      const sheet =
        Math.max(belowSpace, aboveSpace) < 180 &&
        bottom - rect.bottom >= rect.top - top &&
        matchMedia("(pointer: coarse)").matches;
      const below = belowSpace >= 230 || belowSpace >= aboveSpace;
      const width = sheet ? Math.min(right - left, 400) : Math.min(272, right - left);
      const x = sheet
        ? (left + right) / 2
        : Math.max(left + width / 2, Math.min(right - width / 2, rect.left + rect.width / 2));
      // Keep the selected line visible even when the complete paragraph is taller than the viewport.
      const y = sheet
        ? bottom
        : below
          ? Math.min(sentence.bottom + 8, Math.max(rect.bottom + 8, bottom - 180))
          : Math.max(sentence.top - 8, Math.min(rect.top - 8, top + 180));
      setPlacement({
        anchor,
        x,
        y,
        width,
        sheet,
        below: !sheet && below,
        maxHeight: Math.max(
          1,
          Math.min(320, sheet ? bottom - rect.bottom - 8 : below ? bottom - y : y - top),
        ),
      });
    }
    align();
    viewport?.addEventListener("resize", align);
    viewport?.addEventListener("scroll", align);
    window.addEventListener("resize", align);
    window.addEventListener("scroll", align, true);
    return () => {
      boundary.remove();
      viewport?.removeEventListener("resize", align);
      viewport?.removeEventListener("scroll", align);
      window.removeEventListener("resize", align);
      window.removeEventListener("scroll", align, true);
    };
  }, [anchor]);
  if (!placement || placement.anchor !== anchor || typeof document === "undefined") return null;
  return createPortal(
    <span
      id={id}
      role="dialog"
      aria-label="Kelime bilgisi"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={(event) => onPointerLeave(event.nativeEvent)}
      data-testid="sentence-word-definition"
      data-layout={placement.sheet ? "sheet" : "popover"}
      style={{
        position: "fixed",
        top: placement.y,
        left: placement.x,
        width: placement.width,
        maxHeight: placement.maxHeight,
        overflowY: "auto",
      }}
      className={
        "z-[9999] block w-max rounded-xl border border-border bg-popover px-4 py-3 text-left text-sm font-normal leading-5 text-popover-foreground shadow-lg -translate-x-1/2 " +
        (placement.below ? "" : "-translate-y-full")
      }
    >
      {children}
    </span>,
    anchor?.closest('[role="dialog"]') ?? document.body,
  );
}
