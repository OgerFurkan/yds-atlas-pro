import type { wordAiAvailability } from "@/shared/hooks/use-ai-health";
import type { DailyGroup } from "./daily-groups";

export function dayStudyState(
  group: DailyGroup,
  availability: ReturnType<typeof wordAiAvailability>,
  authenticated: boolean,
  taskActive: boolean,
) {
  const missing = group.total - group.learned - group.playable;
  if (group.playable) return missing ? "partial" : "ready";
  if (!group.total) return "empty";
  if (!missing) return "learned";
  if (!authenticated) return "guest";
  if (taskActive) return "task-active";
  return availability === "available" ? "prepare" : availability;
}

export type DayStudyState = ReturnType<typeof dayStudyState>;
