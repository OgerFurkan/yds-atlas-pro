/**
 * Stage-aware selection, deliberately small and deterministic.
 * Old examples without an explicit purpose keep the legacy pool and order.
 * A purpose label marks intended use, not an independently verified YDS level.
 */
export function contextExamplesForPhase<T extends { purpose?: "practice" | "exam" }>(
  usable: readonly T[],
  final: boolean,
): T[] {
  const intended = final ? "exam" : "practice";
  const tagged = usable.filter((example) => example.purpose === intended);
  return tagged.length ? tagged : [...usable];
}
