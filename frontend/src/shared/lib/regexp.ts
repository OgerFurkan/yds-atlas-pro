/** Escapes a literal string so it can be embedded in a regular expression. */
export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
