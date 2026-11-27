import { lemmaCandidates } from "@yds-atlas/shared";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  normalizeTooltipWord,
  splitSentenceWords,
  type TooltipVocabulary,
} from "./sentence-tooltip";
import { SentenceTooltipCard } from "./sentence-tooltip-card";
import { VocabularyContext } from "./sentence-vocabulary-context";
import { useSentenceLookup } from "./use-sentence-lookup";
import { ViewportTooltip } from "./viewport-tooltip";

type Props = { text: string; focusWord?: TooltipVocabulary | null; allowDuringGame?: boolean };
export function SentenceWordTooltips(props: Props) {
  const ctx = useContext(VocabularyContext);
  return <SentenceTokens key={JSON.stringify([ctx.owner, ctx.lookup, props.text])} {...props} />;
}
function SentenceTokens({ text, focusWord, allowDuringGame = false }: Props) {
  const ctx = useContext(VocabularyContext),
    id = useId();
  const parts = useMemo(() => splitSentenceWords(text), [text]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [key, setKey] = useState("");
  const [pinned, setPinned] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const prefix = id + "-";
  const { select } = ctx;
  const open = !!ctx.active?.startsWith(prefix);
  const { rows, status, setAttempt, request, fetchedAt } = useSentenceLookup(
    parts,
    ctx.owner,
    ctx.lookup,
    open,
  );
  function close(focus = false) {
    clearTimeout(timer.current);
    if (focus) anchor?.focus();
    ctx.select(null);
    setPinned(null);
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        e.target instanceof Node &&
        !anchor?.contains(e.target) &&
        !document.getElementById(id)?.contains(e.target)
      ) {
        select(null);
        setPinned(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, anchor, select, id]);
  const candidates = lemmaCandidates(key);
  const exact = rows.filter((r) => r.word === key);
  const matches = exact.length ? exact : rows.filter((r) => candidates.includes(r.word));
  const selected = matches.length === 1 ? matches[0] : undefined;
  const interactive = ctx.enabled || allowDuringGame;
  return (
    <span data-testid="english-sentence-tooltips" lang="en">
      {parts.map((part) => {
        if (part.kind !== "word") return <span key={part.offset}>{part.text}</span>;
        const token = normalizeTooltipWord(part.text),
          active = ctx.active === prefix + part.offset;
        const focus =
          !!focusWord &&
          (lemmaCandidates(token).includes(normalizeTooltipWord(focusWord.word)) ||
            focusWord.alternatives?.some((v) => normalizeTooltipWord(v) === token));
        function activate(el: HTMLElement) {
          if (status === "ready" && Date.now() - fetchedAt.current > 60_000) {
            fetchedAt.current = Date.now();
            setAttempt((v) => v + 1);
          }
          clearTimeout(timer.current);
          setAnchor(el);
          setKey(token);
          ctx.select(prefix + part.offset);
          request(true);
        }
        const clearCloseTimer = () => clearTimeout(timer.current);
        const scheduleClose = (event: PointerEvent) => {
          if (pinned === part.offset || event.pointerType !== "mouse") return;
          const target = event.relatedTarget;
          if (
            target instanceof Node &&
            (anchor?.contains(target) || document.getElementById(id)?.contains(target))
          )
            return;
          clearCloseTimer();
          timer.current = setTimeout(
            () => ctx.select((current) => (current === prefix + part.offset ? null : current)),
            220,
          );
        };
        if (!interactive)
          return (
            <span key={part.offset} data-headword={focus} className="atlas-sentence-word">
              {part.text}
            </span>
          );
        return (
          <span
            key={part.offset}
            ref={(element) => {
              if (!element) return;
              const listeners = new AbortController();
              const options = { signal: listeners.signal };
              element.addEventListener("pointerenter", clearCloseTimer, options);
              element.addEventListener("pointerleave", scheduleClose, options);
              element.addEventListener(
                "keydown",
                (event) => {
                  if (event.key === "Escape" && active) {
                    event.preventDefault();
                    event.stopPropagation();
                    close(true);
                  }
                },
                options,
              );
              return () => listeners.abort();
            }}
          >
            <button
              type="button"
              data-testid="sentence-word"
              data-word={token}
              data-headword={focus}
              data-inspected={active}
              className="atlas-sentence-word"
              aria-haspopup="dialog"
              aria-expanded={active}
              aria-controls={active ? id : undefined}
              onPointerMove={(e) => {
                if (
                  !active &&
                  e.pointerType === "mouse" &&
                  window.matchMedia("(any-hover: hover)").matches
                ) {
                  setPinned(null);
                  activate(e.currentTarget);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && active) {
                  e.preventDefault();
                  document
                    .getElementById(id)
                    ?.querySelector<HTMLButtonElement>("button")
                    ?.focus({ preventScroll: true });
                }
              }}
              onFocus={(e) => activate(e.currentTarget)}
              onClick={(e) => {
                if (active && pinned === part.offset) close();
                else {
                  activate(e.currentTarget);
                  setPinned(part.offset);
                  document.getElementById(id)?.querySelector<HTMLButtonElement>("button")?.focus();
                }
              }}
            >
              {part.text}
            </button>
            {active && (
              <ViewportTooltip
                id={id}
                anchor={anchor}
                onEscape={() => close(true)}
                onPointerEnter={clearCloseTimer}
                onPointerLeave={scheduleClose}
              >
                <SentenceTooltipCard
                  text={part.text}
                  token={token}
                  selected={selected}
                  matches={matches}
                  lookup={ctx.lookup}
                  owner={ctx.owner}
                  status={status}
                  onClose={() => close(true)}
                  onRetry={() => setAttempt((v) => v + 1)}
                />
              </ViewportTooltip>
            )}
          </span>
        );
      })}
    </span>
  );
}
