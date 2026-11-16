import { createHash } from 'node:crypto';

const validParts = new Set(['Noun','Verb','Adjective','Adverb','Preposition','Conjunction','Pronoun','Phrase']);
export type LexicalIdentity = { wordKey:string; partOfSpeech:string; senseKey:string };

/** Stable, conservative identity. NEVER merge words solely on a shared spelling. */
export function lexicalIdentity(word: string, partOfSpeech: string, primaryTurkishMeaning: string): LexicalIdentity {
  const wordKey=word.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
  const part=partOfSpeech[0]?.toUpperCase()+partOfSpeech.slice(1).toLowerCase();
  const sense=primaryTurkishMeaning.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('tr');
  if (!/^[a-z][a-z '-]{0,119}$/.test(wordKey)) throw new Error('An English headword is required');
  if (!validParts.has(part)) throw new Error('Part of speech must be explicit and valid');
  if (!sense || sense.length>200) throw new Error('A concrete Turkish sense is required');
  const senseKey=createHash('sha256').update(sense).digest('hex');
  return {wordKey,partOfSpeech:part,senseKey};
}

/** Query by word/part first, then reconcile intended sense; never pick an arbitrary homograph. */
export function choosePoolRecord<T extends LexicalIdentity>(
  candidates: readonly T[], wordKey:string, partOfSpeech?:string, senseKey?:string,
): T|undefined {
  const found=candidates.filter(c=>c.wordKey===wordKey &&
    (!partOfSpeech||c.partOfSpeech===partOfSpeech) && (!senseKey||c.senseKey===senseKey));
  if(found.length>1)throw new Error('Ambiguous homograph/sense; user must choose intended reading');
  return found[0];
}
