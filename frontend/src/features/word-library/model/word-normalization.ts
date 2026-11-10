export function wordKey(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[’‘]/g, "'").toLocaleLowerCase("en-US");
}

export function formatWordType(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function normalizeWord(value: string) {
  const clean = value.normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[’‘]/g, "'");
  const cased = clean === clean.toUpperCase() ? clean.toLocaleLowerCase("en-US") : clean;
  return cased.charAt(0).toLocaleUpperCase("en-US") + cased.slice(1);
}

export function parseWordList(value: string) {
  return [
    ...new Map(
      value
        .split(/[\n,;]+/)
        .map(normalizeWord)
        .filter(Boolean)
        .map((word) => [wordKey(word), word]),
    ).values(),
  ];
}
