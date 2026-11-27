import { type LexiconPreview, lexiconPreview } from "@yds-atlas/shared";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { normalizeTooltipWord, type splitSentenceWords } from "./sentence-tooltip";

export function useSentenceLookup(
  parts: ReturnType<typeof splitSentenceWords>,
  owner: string | null,
  enabled: boolean,
  open: boolean,
) {
  const [rows, setRows] = useState<LexiconPreview[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [attempt, setAttempt] = useState(0);
  const fetchedAt = useRef(0);
  const [requested, request] = useState(false);
  useEffect(() => {
    if (!requested || !enabled || !owner) return;
    const abort = new AbortController();
    const terms = [
      ...new Set(
        parts
          .filter((p) => p.kind === "word")
          .map((p) => normalizeTooltipWord(p.text))
          .filter((w) => w.length <= 120 && /^[a-z]+(?:[' -][a-z]+)*$/.test(w)),
      ),
    ];
    terms.sort();
    async function load() {
      setStatus("loading");
      setRows([]);
      const rows: LexiconPreview[] = [];
      for (let i = 0; i < terms.length; i += 96) {
        const params = new URLSearchParams(terms.slice(i, i + 96).map((w) => ["word", w]));
        const payload = await apiRequest(
          "/api/lexicon/preview?" + params,
          { signal: abort.signal, cache: attempt ? "reload" : "no-store" },
          owner,
        );
        rows.push(...lexiconPreview.array().parse(payload));
      }
      if (!abort.signal.aborted) {
        fetchedAt.current = Date.now();
        setRows(rows);
        setStatus("ready");
      }
    }
    void load().catch(() => {
      if (!abort.signal.aborted) setStatus("error");
    });
    const refresh = () => setAttempt((v) => v + 1);
    window.addEventListener("focus", refresh);
    const channel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel("atlas-lexicon-revisions")
        : null;
    if (channel) channel.onmessage = refresh;
    return () => {
      channel?.close();
      abort.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [requested, enabled, owner, parts, attempt]);
  useEffect(() => {
    if (!open || !enabled || !owner || status !== "ready") return;
    const timer = window.setTimeout(() => setAttempt((v) => v + 1), 60_000);
    return () => window.clearTimeout(timer);
  }, [open, enabled, owner, status]);
  return { rows, status, setAttempt, request, fetchedAt };
}
