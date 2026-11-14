import {
  cloudReviewSchedulesResponseSchema,
  type CloudReviewSchedule,
} from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";

const PATH = "/api/account/review-schedules";

/** Account-only GET, deliberately separate from the local guest ledger. */
export async function loadCloudReviewSchedules(userId: string): Promise<CloudReviewSchedule[]> {
  const response = await apiRequest<unknown>(PATH, undefined, userId);
  return cloudReviewSchedulesResponseSchema.parse(response).schedules;
}
