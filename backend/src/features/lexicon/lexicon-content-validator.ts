import { hasCompleteTierSet, type LeveledExample } from '@yds-atlas/shared';

/** Baseline machine checks. They are NOT a claim of independent CEFR/YDS certification. */
export function validateLexicalCandidate(input: {
  word:string; partOfSpeech:string; meanings:string[];
  alternatives?:string[]; examples:readonly LeveledExample[];
}) {
  const issues:string[]=[];
  if(!input.word?.trim()||!input.partOfSpeech?.trim()||!input.meanings?.some(x=>x?.trim()))issues.push('metadata_missing');
  if(!hasCompleteTierSet(input.examples))issues.push('tier_distribution_invalid');
  const forms=[input.word,...(input.alternatives??[])].map(x=>x.toLocaleLowerCase('en').trim()).filter(Boolean);
  for(const [index,example] of input.examples.entries()){
    const s=example.sentence?.trim()??'';
    const words=s.match(/[a-z]+(?:'[a-z]+)?/gi)??[];
    if(!words.some(w=>forms.includes(w.toLocaleLowerCase('en'))))issues.push(`headword_absent_${index}`);
    if(!example.translation?.trim()) issues.push(`translation_missing_${index}`);
    if(!example.translationFocus?.length || example.translationFocus.some(f=>!f.trim() || !example.translation.includes(f)))
      issues.push(`translation_focus_invalid_${index}`);
    if(example.difficulty==='easy' && (words.length<3||words.length>12))issues.push(`easy_length_${index}`);
    if(example.difficulty==='medium' && (words.length<6||words.length>21))issues.push(`medium_length_${index}`);
    if(example.difficulty==='yds' && (words.length<14||words.length>52))issues.push(`yds_length_${index}`);
  }
  if(issues.length)throw new Error(`Lexical candidate rejected: ${issues.join(',')}`);
  return {valid:true as const,verification:'machine_checked' as const};
}
