import type { InspectorEntry } from "../api/word-inspector-api";

/** A stale asynchronous save cannot display success for a different entry. */
export function inspectorSaveBelongsTo(
  entry: InspectorEntry | null,
  saved: {
    id: string;
    revision: number;
  } | null,
) {
  return (
    entry !== null && saved !== null && entry.id === saved.id && entry.revision === saved.revision
  );
}
