export function wordKey(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[’‘]/g, "'").toLocaleLowerCase("en-US");
}

/** Keep personal Turkish senses and POS when borrowing or generating learning material. */
export function matchesRequestedSense(
  requested: { meanings?: string[]; partOfSpeech?: string },
  candidate: { meanings?: string[]; partOfSpeech?: string },
) {
  const normalized = (value: string) =>
    value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("tr");
  const provided = new Set((candidate.meanings ?? []).map(normalized));
  return (
    (!requested.partOfSpeech ||
      wordKey(requested.partOfSpeech) === wordKey(candidate.partOfSpeech ?? "")) &&
    (requested.meanings ?? []).every((meaning) => provided.has(normalized(meaning)))
  );
}

export function lemmaCandidates(token: string) {
  const word = token.toLowerCase().replaceAll("’", "'");
  const candidates = [word];
  const irregular: Record<string, string> = {
    these: "this",
    those: "that",
    was: "be",
    were: "be",
    been: "be",
    is: "be",
    are: "be",
    has: "have",
    had: "have",
    did: "do",
    went: "go",
    children: "child",
  };
  if (Object.hasOwn(irregular, word)) candidates.push(irregular[word]);
  if (word.length > 3 && word.endsWith("s")) candidates.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("es")) candidates.push(word.slice(0, -2));
  if (word.endsWith("ies")) candidates.push(word.slice(0, -3) + "y");
  if (word.length > 4 && word.endsWith("ed")) candidates.push(word.slice(0, -2), word.slice(0, -1));
  if (word.length > 5 && word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    candidates.push(stem, stem + "e");
    if (stem.at(-1) === stem.at(-2)) candidates.push(stem.slice(0, -1));
  }
  return [...new Set(candidates)];
}
