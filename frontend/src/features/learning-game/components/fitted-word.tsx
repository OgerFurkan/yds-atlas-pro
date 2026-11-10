import { useLayoutEffect, useRef } from "react";

// Scales to the card's real width (not the viewport) so long words stay on one line.
export function FittedWord({
  text,
  maxSize,
  minSize,
  className,
}: {
  text: string;
  maxSize: number;
  minSize: number;
  className: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refit whenever the text changes
  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;

    let cancelled = false;
    let lastWidth = -1;

    const fit = (force = false) => {
      const available = node.clientWidth;
      if (available <= 0 || (!force && Math.abs(available - lastWidth) < 1)) return;
      lastWidth = available;

      // Measure at the intended large size before scaling down.
      node.style.fontSize = `${maxSize}px`;
      node.style.whiteSpace = "nowrap";
      node.style.overflowWrap = "normal";
      const required = node.scrollWidth;

      if (required > available) {
        const fitted = Math.max(minSize, Math.floor((maxSize * (available - 3)) / required));
        node.style.fontSize = `${fitted}px`;

        // Exceptionally long words wrap instead of overflowing the card.
        if (node.scrollWidth > available) {
          node.style.whiteSpace = "normal";
          node.style.overflowWrap = "anywhere";
        }
      }
    };

    fit(true);
    const observer = new ResizeObserver(() => fit());
    observer.observe(node);
    void document.fonts?.ready.then(() => {
      if (!cancelled) fit(true);
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [text, maxSize, minSize]);

  return (
    <span
      ref={textRef}
      className={`block w-full min-w-0 text-center ${className}`}
      style={{ fontSize: `${maxSize}px`, whiteSpace: "nowrap" }}
    >
      {text}
    </span>
  );
}
