/** Normalizes provider glosses while preserving the same limits across both editions. */
export function normalizeTurkishMeaning(value: string): string | null {
  const meaning = value.normalize("NFKC").trim();
  if (!meaning || meaning.length > 85 || meaning.includes("<") || meaning.includes(">"))
    return null;
  for (let index = 0; index < meaning.length; index++) {
    if (meaning.charCodeAt(index) < 32) return null;
  }
  return meaning;
}
