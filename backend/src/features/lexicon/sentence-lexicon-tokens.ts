const COMMON = new Set(
  "a an the and or but of to in on at for from with by as is are was were be been have has had can may must will would should could this that these those they their we our you your it its which who what when where although while because if than not after before between into during through such more most also both each only other some any all one two".split(
    " ",
  ),
);
const TOKEN = /[A-Za-z]+(?:[’'][A-Za-z]+)?(?:-[A-Za-z]+)*/g;

export function sentenceTokens(sentences: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const sentence of sentences.slice(0, 100)) {
    if (!sentence || sentence.length > 1200) continue;
    // Never discover names, addresses, URLs or other user-provided identifiers.
    const safe = sentence
      .replace(/(?:https?:\/\/|www\.)\S+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
      .replace(/(?:^|\s)[@#][\w.-]+/g, " ");
    for (const item of safe.matchAll(TOKEN)) {
      // Possible proper names, including sentence-initial ones, are not exported.
      // Lowercase vocabulary (including ordinary function words) is queued.
      if (/[A-Z]/.test(item[0])) continue; // Conservative PII / proper-name protection.
      const token = item[0].normalize("NFKC").toLocaleLowerCase("en").replaceAll("’", "'");
      if (token.length > 45 || !/^[a-z]+(?:'[a-z]+)?(?:-[a-z]+)?$/.test(token)) continue;
      unique.add(token);
    }
  }
  // Meaningful vocabulary is indexed first; articles and short function words
  // remain eligible, but do not starve content words in the bounded worker.
  return [...unique].sort((a, b) => Number(COMMON.has(a)) - Number(COMMON.has(b)));
}
