import {
  cloudReviewScheduleSchema,
  type CloudReviewSchedule,
  type CloudReviewSchedulesResponse,
} from "@yds-atlas/shared";
import { databaseError, HttpError } from "../../shared/errors";
import type { RequestContext } from "../../shared/supabase";

const PAGE_SIZE = 200;
const MAX_SCHEDULES = 5000;
const COLUMNS = "word_id,repetitions,lapses,interval_days,ease_factor,due_at,last_reviewed_at";

function invalidRow(): never {
  throw new HttpError(503, "Tekrar takvimindeki veriler doğrulanamadı.", "REVIEW_SCHEDULE_INVALID");
}

function isoInstant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalidRow();
  return new Date(value).toISOString();
}

function normalizeRow(value: unknown): CloudReviewSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidRow();
  const row = value as Record<string, unknown>;
  const parsed = cloudReviewScheduleSchema.safeParse({
    wordId: row.word_id,
    repetitions: row.repetitions,
    lapses: row.lapses,
    intervalDays: row.interval_days,
    easeFactor: row.ease_factor,
    dueAt: isoInstant(row.due_at),
    lastReviewedAt: row.last_reviewed_at === null ? null : isoInstant(row.last_reviewed_at),
  });
  if (!parsed.success) invalidRow();
  return parsed.data;
}

/**
 * Read-only, owner-scoped and bounded. The request's JWT-scoped client enforces
 * RLS; the explicit user_id filter is an additional defense. No writer or
 * service-role client may be constructed for a GET request.
 */
export async function readReviewSchedules(
  ctx: RequestContext,
): Promise<CloudReviewSchedulesResponse> {
  const schedules: CloudReviewSchedule[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset <= MAX_SCHEDULES; offset += PAGE_SIZE) {
    const response = await ctx.db.from("word_review_schedules")
      .select(COLUMNS)
      .eq("user_id", ctx.userId)
      .order("due_at", { ascending: true })
      .order("word_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    databaseError(response.error);
    if (!Array.isArray(response.data)) invalidRow();
    if (schedules.length + response.data.length > MAX_SCHEDULES)
      throw new HttpError(409, "Tekrar takvimi sınırı aşıldı.", "REVIEW_SCHEDULE_LIMIT");

    for (const raw of response.data) {
      const schedule = normalizeRow(raw);
      if (seen.has(schedule.wordId)) invalidRow();
      seen.add(schedule.wordId);
      schedules.push(schedule);
    }
    if (response.data.length < PAGE_SIZE) return { schedules };
  }
  throw new HttpError(409, "Tekrar takvimi sınırı aşıldı.", "REVIEW_SCHEDULE_LIMIT");
}
