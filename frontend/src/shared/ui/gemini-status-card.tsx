import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ApiError, accountRequest } from "@/shared/api/api-client";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { Button } from "@/shared/ui/button";

const timestamp = z.number().int().nonnegative().nullable();
const count = z.number().int().nonnegative();
const keyId = z.string().regex(/^Key \d{2,}$/);
const model = z.string().regex(/^gemini-[a-z0-9.-]+$/);
const diagnostics = z.object({
  lastKey: keyId.nullable(),
  keys: z.array(
    z.object({
      id: keyId,
      state: z.enum(["ready", "rate_limit", "invalid", "denied", "unknown"]),
      lastModel: model.nullable(),
      lastRequest: timestamp,
      lastSuccess: timestamp,
      lastFailure: timestamp,
      retryAt: timestamp,
      successes: count,
      failures: count,
      retries: count,
      fallbacks: count,
    }),
  ),
  pause: z
    .object({
      kind: z.array(z.enum(["daily", "tokens_per_minute", "requests_per_minute", "unknown"])),
      model,
      until: z.number(),
    })
    .nullable(),
});
type Diagnostics = z.infer<typeof diagnostics>;

export function GeminiStatusCard() {
  const { t, i18n } = useTranslation();
  const owner = getStorageScope();
  const [snapshot, setSnapshot] = useState<{ owner: string; data: Diagnostics } | null>(null);
  const [revision, setRevision] = useState(0);
  const [failedOwner, setFailedOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    const request = accountRequest(owner);
    let authorized = false;
    void request<{ authorized: boolean }>("/api/control", {
      signal: controller.signal,
      cache: revision ? "reload" : "no-store",
    })
      .then((access) => {
        if (access.authorized !== true) throw new Error("Unverified access");
        authorized = true;
        return request<unknown>("/api/control/ai-status", { signal: controller.signal });
      })
      .then((response) => {
        const data = diagnostics.parse(response);
        if (controller.signal.aborted) return;
        setSnapshot({ owner, data });
        setFailedOwner(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSnapshot(null);
        const denied = error instanceof ApiError && [401, 403].includes(error.status);
        setFailedOwner(authorized && !denied ? owner : null);
      });
    return () => controller.abort();
  }, [owner, revision]);
  if (owner && failedOwner === owner)
    return (
      <section
        aria-label={t("settings.ai.title")}
        className="space-y-3 rounded-xl border border-atlas-line p-3"
      >
        <h3 className="text-sm font-semibold">{t("settings.ai.title")}</h3>
        <p role="alert">{t("settings.ai.unavailable")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRevision((value) => value + 1)}
        >
          {t("settings.ai.recheck")}
        </Button>
      </section>
    );
  if (!snapshot || snapshot.owner !== owner) return null;
  const { keys, lastKey, pause } = snapshot.data;
  const at = (time: number | null) =>
    time === null ? "—" : new Date(time).toLocaleString(i18n.language);
  return (
    <section
      aria-label={t("settings.ai.title")}
      className="space-y-3 rounded-xl border border-atlas-line p-3"
    >
      <h3 className="text-sm font-semibold">{t("settings.ai.title")}</h3>
      <p className="text-xs text-atlas-muted">{t("settings.ai.measured")}</p>
      <p className="text-xs">
        {t("settings.ai.pool", { count: keys.length, last: lastKey ?? "—" })}
      </p>
      {pause && (
        <p className="text-xs">
          {t("settings.ai.paused", {
            kind: pause.kind.map((kind) => t(`settings.ai.${kind}`)).join(", "),
            time: at(pause.until),
          })}
        </p>
      )}
      <ul className="space-y-2">
        {keys.map((key) => (
          <li key={key.id} className="space-y-1 rounded-md border border-atlas-line p-2 text-xs">
            <p className="font-semibold">
              {key.id} · {t(`settings.ai.${key.state}`)}
            </p>
            <p>
              {t("settings.ai.attempt", { model: key.lastModel ?? "—", time: at(key.lastRequest) })}
            </p>
            <p>{t("settings.ai.success", { count: key.successes, time: at(key.lastSuccess) })}</p>
            <p>{t("settings.ai.failure", { count: key.failures, time: at(key.lastFailure) })}</p>
            <p>{t("settings.ai.retries", { retries: key.retries, fallbacks: key.fallbacks })}</p>
            {key.retryAt !== null && <p>{t("settings.ai.retryAt", { time: at(key.retryAt) })}</p>}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRevision((value) => value + 1)}
      >
        {t("settings.ai.recheck")}
      </Button>
    </section>
  );
}
