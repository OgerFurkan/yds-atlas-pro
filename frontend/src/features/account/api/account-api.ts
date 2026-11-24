import { accountStateSchema, type GameSession } from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";
export function createAccountApi(userId: string) {
  const call = <T>(path: string, init?: RequestInit) => apiRequest<T>(path, init, userId);
  return {
    async load() {
      return accountStateSchema.parse(await call("/api/account"));
    },
    async saveGoal(goal: number) {
      await call("/api/account/goal", { method: "PUT", body: JSON.stringify({ goal }) });
    },
    saveSession(snapshot: GameSession, revision: number) {
      return call<{ revision: number }>("/api/learning/session", {
        method: "PUT",
        body: JSON.stringify({ snapshot, revision }),
      });
    },
    completeSession(id: string, revision: number) {
      return call<{ scores: { id: string; score: number }[]; practiceOnly: boolean }>(
        "/api/learning/sessions/" + id + "/complete",
        { method: "POST", body: JSON.stringify({ revision }) },
      );
    },
  };
}
