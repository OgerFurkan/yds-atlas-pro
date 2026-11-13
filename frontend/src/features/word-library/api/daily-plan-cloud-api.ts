import {
  dailyPlanSnapshotSchema,
  type DailyPlanCloudState,
  type DailyPlanSnapshot,
} from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";

const PATH = "/api/account/daily-plan";

/** Account-bound transport. No client-supplied user ID is sent to the backend. */
export async function loadCloudDailyPlan(userId: string): Promise<DailyPlanCloudState> {
  const state = await apiRequest<DailyPlanCloudState>(PATH, undefined, userId);
  return {
    revision: state.revision,
    snapshot: state.snapshot ? dailyPlanSnapshotSchema.parse(state.snapshot) : null,
  };
}

export async function saveCloudDailyPlan(
  userId: string,
  snapshot: DailyPlanSnapshot,
  expectedRevision: number,
): Promise<DailyPlanCloudState> {
  const saved = await apiRequest<DailyPlanCloudState>(PATH, {
    method: "PUT",
    body: JSON.stringify({ snapshot: dailyPlanSnapshotSchema.parse(snapshot), expectedRevision }),
  }, userId);
  return { revision: saved.revision, snapshot: dailyPlanSnapshotSchema.parse(saved.snapshot) };
}
