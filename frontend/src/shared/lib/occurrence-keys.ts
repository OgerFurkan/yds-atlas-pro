/** Keeps duplicate values distinct when immutable display data has no stored ID. */
export function withOccurrenceKeys<T>(items: readonly T[], identity: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const value = identity(item);
    const count = (seen.get(value) ?? 0) + 1;
    seen.set(value, count);
    return { item, key: JSON.stringify([value, count]) };
  });
}
