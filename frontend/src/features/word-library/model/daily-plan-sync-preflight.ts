import { dailyPlanSnapshotSchema, type DailyPlanSnapshot } from "@yds-atlas/shared";

/**
 * Read-only plan comparison. It does NOT merge, persist, sync, or choose a winner.
 * In particular, never convert a rejected snapshot into an empty plan.
 */
export type SyncPreflightStatus =
  | "blocked"
  | "both-empty"
  | "local-only"
  | "cloud-only"
  | "identical"
  | "different";

export interface SyncPreflightInput {
  local: unknown | null;
  cloud: { revision: number; snapshot: unknown | null };
  /** When provided, all referenced word IDs must belong to the current library. */
  knownWordIds?: readonly string[];
  /** Local storage errors/corruption are blocking rather than mistaken for an empty plan. */
  localReadErrors?: readonly string[];
}

export interface WordPlacementDifference {
  wordId: string;
  localDay: number | null;
  cloudDay: number | null;
}

export interface SyncPreflightResult {
  status: SyncPreflightStatus;
  cloudRevision: number;
  localWords: number;
  cloudWords: number;
  changedPlacements: WordPlacementDifference[];
  changedExclusions: string[];
  changedOrderDays: number[];
  groupSizeChanged: boolean;
  problems: string[];
  /** The caller must never write from preflight output without a separate explicit flow. */
  requiresUserDecision: boolean;
}

const placementMap = (plan: DailyPlanSnapshot) => {
  const map = new Map<string, number>();
  for (const group of plan.assignments) {
    for (const id of group.words) map.set(id, group.day);
  }
  return map;
};

const referencedIds = (plan: DailyPlanSnapshot) => [
  ...plan.assignments.flatMap((group) => group.words),
  ...plan.excludedWordIds,
];

function invalidSnapshotDetails(label: string, input: unknown): string[] {
  const parsed = dailyPlanSnapshotSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.slice(0, 8).map((issue) =>
    `${label}: ${issue.path.join(".") || "snapshot"}: ${issue.message}`,
  );
}

/**
 * Ordering within a day is intentional. We compare it separately from day placement.
 * Exclusion order is not semantically significant.
 */
export function inspectDailyPlanSyncPreflight(input: SyncPreflightInput): SyncPreflightResult {
  const problems = [...(input.localReadErrors ?? [])];
  if (!Number.isInteger(input.cloud.revision) || input.cloud.revision < 0)
    problems.push("Bulut planının revision değeri geçersiz.");
  if (input.cloud.snapshot === null && input.cloud.revision !== 0)
    problems.push("Bulut revision ve boş snapshot birbiriyle uyuşmuyor.");

  const localParsed = input.local === null ? null : dailyPlanSnapshotSchema.safeParse(input.local);
  const cloudParsed = input.cloud.snapshot === null
    ? null
    : dailyPlanSnapshotSchema.safeParse(input.cloud.snapshot);
  if (localParsed && !localParsed.success)
    problems.push(...invalidSnapshotDetails("Yerel plan", input.local));
  if (cloudParsed && !cloudParsed.success)
    problems.push(...invalidSnapshotDetails("Bulut planı", input.cloud.snapshot));

  const local = localParsed?.success ? localParsed.data : null;
  const cloud = cloudParsed?.success ? cloudParsed.data : null;
  if (input.knownWordIds) {
    const known = new Set(input.knownWordIds);
    const missingLocal = local ? referencedIds(local).filter((id) => !known.has(id)) : [];
    const missingCloud = cloud ? referencedIds(cloud).filter((id) => !known.has(id)) : [];
    if (missingLocal.length)
      problems.push(`Yerel planda kütüphanede bulunmayan ${missingLocal.length} kelime kimliği var.`);
    if (missingCloud.length)
      problems.push(`Bulut planında kütüphanede bulunmayan ${missingCloud.length} kelime kimliği var.`);
  }

  const localPositions = local ? placementMap(local) : new Map<string, number>();
  const cloudPositions = cloud ? placementMap(cloud) : new Map<string, number>();
  const ids = [...new Set([...localPositions.keys(), ...cloudPositions.keys()])].sort();
  const changedPlacements = ids.flatMap((wordId) => {
    const localDay = localPositions.get(wordId) ?? null;
    const cloudDay = cloudPositions.get(wordId) ?? null;
    return localDay === cloudDay ? [] : [{ wordId, localDay, cloudDay }];
  });
  const localExcluded = new Set(local?.excludedWordIds ?? []);
  const cloudExcluded = new Set(cloud?.excludedWordIds ?? []);
  const changedExclusions = [...new Set([...localExcluded, ...cloudExcluded])]
    .filter((id) => localExcluded.has(id) !== cloudExcluded.has(id)).sort();

  const localGroups = new Map(local?.assignments.map((group) => [group.day, group.words]) ?? []);
  const cloudGroups = new Map(cloud?.assignments.map((group) => [group.day, group.words]) ?? []);
  const changedOrderDays = [...new Set([...localGroups.keys(), ...cloudGroups.keys()])]
    .filter((day) => {
      const left = localGroups.get(day) ?? [];
      const right = cloudGroups.get(day) ?? [];
      // Do not double-report added/deleted/moved words as a mere order change.
      return left.length === right.length &&
        [...left].sort().join("\u0000") === [...right].sort().join("\u0000") &&
        left.join("\u0000") !== right.join("\u0000");
    }).sort((a, b) => a - b);
  const groupSizeChanged = Boolean(local && cloud && local.groupSize !== cloud.groupSize);

  let status: SyncPreflightStatus;
  if (problems.length) status = "blocked";
  else if (!local && !cloud) status = "both-empty";
  else if (!cloud) status = "local-only";
  else if (!local) status = "cloud-only";
  else status = changedPlacements.length || changedExclusions.length || changedOrderDays.length || groupSizeChanged
    ? "different" : "identical";

  return {
    status,
    cloudRevision: input.cloud.revision,
    localWords: localPositions.size,
    cloudWords: cloudPositions.size,
    changedPlacements,
    changedExclusions,
    changedOrderDays,
    groupSizeChanged,
    problems,
    requiresUserDecision: status === "different" || status === "local-only" || status === "cloud-only",
  };
}
