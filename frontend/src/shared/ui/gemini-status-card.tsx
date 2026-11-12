import {
  CircleAlert,
  CircleCheckBig,
  CircleSlash2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AiHealth, fetchAiHealth } from "@/shared/api/ai-health";
import { clearAiIssues, type AiIssue, useAiIssues } from "@/shared/lib/ai-issues";
import { Button } from "@/shared/ui/button";

type Phase = "checking" | "ready" | "offline";
type Status = "checking" | "connected" | "degraded" | "offline" | "not-configured";

const STATUS_STYLES: Record<Status, string> = {
  checking: "bg-atlas-blue-pale text-atlas-blue ring-atlas-blue/25",
  connected: "bg-atlas-green-pale text-atlas-green ring-atlas-green/25",
  degraded: "bg-atlas-orange-pale text-atlas-orange-dark ring-atlas-orange/25",
  offline: "bg-destructive/10 text-destructive ring-destructive/25",
  "not-configured": "bg-muted text-atlas-muted ring-atlas-line",
};

const STATUS_ICONS: Record<Status, typeof Sparkles> = {
  checking: LoaderCircle,
  connected: CircleCheckBig,
  degraded: TriangleAlert,
  offline: WifiOff,
  "not-configured": CircleSlash2,
};

const STATUS_KEYS: Record<Status, string> = {
  checking: "checking",
  connected: "connected",
  degraded: "degraded",
  offline: "offline",
  "not-configured": "notConfigured",
};

function statusFor(phase: Phase, health: AiHealth | null): Status {
  if (phase === "checking") return "checking";
  if (phase === "offline" || !health) return "offline";
  if (!health.aiConfigured || health.ai?.configured === false) return "not-configured";
  if (!health.databaseConfigured) return "degraded";
  if (health.ai?.word.readyKeys === 0 || health.ai?.chat.readyKeys === 0) return "degraded";
  return "connected";
}

function PoolRow({
  label,
  model,
  readyKeys,
  total,
  waitSeconds,
}: {
  label: string;
  model: string;
  readyKeys: number;
  total: number;
  waitSeconds: number | null;
}) {
  const { t } = useTranslation();
  const dots = Math.min(total, 8);
  return (
    <div className="rounded-lg border border-atlas-line bg-card/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-atlas-ink">{label}</span>
        <span
          className={
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums " +
            (readyKeys
              ? "bg-atlas-green-pale text-atlas-green"
              : total
                ? "bg-atlas-orange-pale text-atlas-orange-dark"
                : "bg-muted text-atlas-muted")
          }
        >
          {readyKeys
            ? t("settings.ai.keysReady", { ready: readyKeys, total })
            : total
              ? t("settings.ai.keysCooling", { seconds: waitSeconds ?? 0 })
              : t("settings.ai.noKeys")}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <code className="truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-atlas-muted">
          {model}
        </code>
        <span className="flex shrink-0 gap-1" aria-hidden>
          {dots > 0 ? (
            Array.from({ length: dots }, (_, index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: pool dots have no identity.
                key={index}
                className={
                  "size-1.5 rounded-full " +
                  (index < readyKeys ? "bg-atlas-green" : "bg-atlas-orange/60")
                }
              />
            ))
          ) : (
            <span className="size-1.5 rounded-full bg-atlas-line" />
          )}
        </span>
      </div>
    </div>
  );
}

function IssueRow({ issue, time }: { issue: AiIssue; time: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert size={10} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] leading-4 text-atlas-muted">{issue.message}</p>
        <p className="text-[10px] text-atlas-quiet">{time}</p>
      </div>
    </li>
  );
}

export function GeminiStatusCard() {
  const { t } = useTranslation();
  const issues = useAiIssues();
  const [phase, setPhase] = useState<Phase>("checking");
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const controller = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setPhase("checking");
    try {
      const next = await fetchAiHealth(pending.signal);
      if (pending.signal.aborted) return;
      setHealth(next);
      setErrorMessage("");
      setCheckedAt(Date.now());
      setPhase("ready");
    } catch (error) {
      if (pending.signal.aborted) return;
      setErrorMessage(error instanceof Error ? error.message : "");
      setCheckedAt(Date.now());
      setPhase("offline");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void check(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [check]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function timeAgo(at: number) {
    const minutes = Math.max(0, Math.round((now - at) / 60_000));
    if (minutes < 1) return t("settings.ai.justNow");
    if (minutes < 60) return t("settings.ai.minutesAgo", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("settings.ai.hoursAgo", { count: hours });
    return t("settings.ai.daysAgo", { count: Math.round(hours / 24) });
  }

  const status = statusFor(phase, health);
  const StatusIcon = STATUS_ICONS[status];
  const pool = health?.ai;

  const problems: string[] = [];
  if (phase === "offline") problems.push(t("settings.ai.issueUnreachable"));
  if (phase === "ready" && health) {
    if (!health.databaseConfigured) problems.push(t("settings.ai.issueDatabase"));
    if (!health.aiConfigured || pool?.configured === false) {
      if (!pool?.keyCount) problems.push(t("settings.ai.issueNoKeys"));
      if (!pool?.quotaConfigured) problems.push(t("settings.ai.issueQuotaClient"));
    }
    const waits = [pool?.word.waitSeconds, pool?.chat.waitSeconds].filter(
      (seconds): seconds is number => typeof seconds === "number",
    );
    if (pool?.keyCount && waits.length)
      problems.push(t("settings.ai.issuePoolCooling", { seconds: Math.min(...waits) }));
  }

  return (
    <section
      aria-label={t("settings.ai.title")}
      className="relative overflow-hidden rounded-xl border border-atlas-line bg-card p-4"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-atlas-blue via-atlas-green to-atlas-orange"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-atlas-blue-pale to-atlas-orange-pale text-atlas-blue ring-1 ring-atlas-line">
            <Sparkles size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-atlas-ink">{t("settings.ai.title")}</p>
            <p className="text-[11px] leading-4 text-atlas-muted">{t("settings.ai.description")}</p>
          </div>
        </div>
        <span
          className={
            "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 " +
            STATUS_STYLES[status]
          }
        >
          <StatusIcon size={11} className={status === "checking" ? "animate-spin" : undefined} />
          {t(`settings.ai.${STATUS_KEYS[status]}`)}
        </span>
      </div>

      {pool && (
        <div className="mt-3 grid gap-2">
          <PoolRow
            label={t("settings.ai.word")}
            model={pool.modelWord}
            readyKeys={pool.word.readyKeys}
            total={pool.keyCount}
            waitSeconds={pool.word.waitSeconds}
          />
          <PoolRow
            label={t("settings.ai.chat")}
            model={pool.modelChat}
            readyKeys={pool.chat.readyKeys}
            total={pool.keyCount}
            waitSeconds={pool.chat.waitSeconds}
          />
        </div>
      )}

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-2">
              <TriangleAlert size={12} className="mt-0.5 shrink-0 text-atlas-orange" />
              <p className="text-[11px] leading-4 text-atlas-muted">{problem}</p>
            </li>
          ))}
          {phase === "offline" && errorMessage && (
            <li className="pl-5 text-[10px] text-atlas-quiet">{errorMessage}</li>
          )}
        </ul>
      )}

      {issues.length > 0 ? (
        <div className="mt-3 border-t border-atlas-line/70 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold tracking-[0.08em] text-atlas-quiet uppercase">
              {t("settings.ai.issues")}
            </p>
            <button
              type="button"
              onClick={clearAiIssues}
              className="cursor-pointer text-[10px] font-semibold text-atlas-blue hover:text-atlas-orange-dark"
            >
              {t("settings.ai.clearIssues")}
            </button>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {issues.map((issue) => (
              <IssueRow key={`${issue.code}-${issue.at}`} issue={issue} time={timeAgo(issue.at)} />
            ))}
          </ul>
        </div>
      ) : (
        status === "connected" && (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-atlas-green">
            <CircleCheckBig size={12} /> {t("settings.ai.issuesEmpty")}
          </p>
        )
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-atlas-line/70 pt-3">
        <p className="text-[10px] text-atlas-quiet">
          {checkedAt ? t("settings.ai.checkedAt", { time: timeAgo(checkedAt) }) : ""}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={phase === "checking"}
          onClick={() => void check()}
        >
          <RefreshCw size={12} className={phase === "checking" ? "animate-spin" : undefined} />
          {t("settings.ai.recheck")}
        </Button>
      </div>
    </section>
  );
}
