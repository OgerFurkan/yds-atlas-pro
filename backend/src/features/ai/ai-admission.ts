import type { ServerConfig } from "../../config/env";
import { databaseError, HttpError } from "../../shared/errors";
import { quotaClient } from "../../shared/supabase";

export function createAiAdmission(
  config: ServerConfig,
  consumeQuota?: (userId: string) => Promise<boolean>,
) {
  const activeAi = new Map<string, number>();
  let pendingAi = 0;
  async function recordUsage(userId: string, signal: AbortSignal) {
    if (signal.aborted) throw new HttpError(499, "İstek iptal edildi.", "AI_CANCELLED");
    if (consumeQuota) {
      if (await consumeQuota(userId)) return;
    } else {
      const meter = await quotaClient(config).rpc("consume_ai_quota", { p_user_id: userId });
      databaseError(meter.error);
      if (meter.data === true) return;
    }
    throw new HttpError(
      503,
      "AI kullanım kaydı doğrulanamadı. Yeniden dene.",
      "AI_USAGE_UNAVAILABLE",
    );
  }

  return (signal: AbortSignal) => {
    let activeOwner: string | undefined;
    async function beginAi(userId: string) {
      const current = activeAi.get(userId) ?? 0;
      // Immediate backpressure bounds in-flight work; there is no queue or per-period allowance.
      if (current >= 2 || pendingAi >= 12)
        throw new HttpError(
          429,
          "Devam eden AI işlemleri var. Tamamlanınca yeniden dene.",
          "AI_BUSY",
          2,
        );
      activeAi.set(userId, current + 1);
      pendingAi++;
      activeOwner = userId;
      await recordUsage(userId, signal);
    }
    function release() {
      if (activeOwner) {
        const left = (activeAi.get(activeOwner) ?? 1) - 1;
        if (left) activeAi.set(activeOwner, left);
        else activeAi.delete(activeOwner);
        pendingAi--;
      }
    }
    return { beginAi, release };
  };
}
