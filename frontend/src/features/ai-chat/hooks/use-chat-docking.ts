import { type RefObject, useEffect } from "react";

export function useChatDocking(
  widget: RefObject<HTMLDivElement | null>,
  assessmentActive: boolean,
  open: boolean,
  mobileChatVisible: boolean,
) {
  useEffect(() => {
    const bubble = widget.current?.querySelector<HTMLButtonElement>(".atlas-chat-launcher");
    if (assessmentActive || open || !mobileChatVisible || !bubble) return;
    let frame = 0;
    function align() {
      if (!bubble) return;
      const rect = bubble.getBoundingClientRect();
      const shell = bubble.parentElement;
      if (!shell) return;
      // Use the viewport docking point even when a densely packed view needs an in-flow slot.
      const baseline = window.innerHeight - (parseFloat(getComputedStyle(shell).bottom) || 16);
      let bottom = baseline;
      if (rect.width > 0 && rect.width <= 56) {
        const actions = Array.from(
          document.querySelectorAll<HTMLElement>(
            "main button, main a[href], main input, main select, main textarea, main [role=button]",
          ),
        )
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.right > rect.left - 4 && r.left < rect.right + 4)
          .sort((a, b) => b.bottom - a.bottom);
        for (const action of actions) {
          if (action.top < bottom + 4 && action.bottom > bottom - rect.height - 4)
            bottom = action.top - 5;
        }
      }
      const crowded = bottom < 72 + rect.height;
      shell.classList.toggle("atlas-chat-in-flow", crowded);
      bubble.style.translate = crowded ? "" : `0 ${Math.min(0, bottom - baseline)}px`;
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(align);
    }
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      bubble.parentElement?.classList.remove("atlas-chat-in-flow");
      bubble.style.translate = "";
    };
  }, [assessmentActive, open, mobileChatVisible, widget]);
}
