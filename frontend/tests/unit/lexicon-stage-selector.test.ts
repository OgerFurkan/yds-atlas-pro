import { expect, test } from 'bun:test';
import { wordExampleSchema } from '@yds-atlas/shared';
import { chooseTieredExample, hasCompleteTierSet, hasPlayableTierSet } from '@yds-atlas/shared';
import { createSession, makeQuestion, recordAnswer, advance } from '@/features/learning-game/model/game-engine';
import { starterVocabulary } from '@/features/word-library/data/starter-vocabulary';
const samples = [
  {sentence:'We can obtain this.',translation:'Kolay örnek alfa.',translationFocus:['Kolay'],difficulty:'easy' as const},
  {sentence:'Please obtain the letter.',translation:'Kolay örnek beta.',translationFocus:['Kolay'],difficulty:'easy' as const},
  {sentence:'The students should obtain clear evidence.',translation:'Öğrenciler açık kanıt elde etmelidir.',translationFocus:['elde etmelidir'],difficulty:'medium' as const},
  {sentence:'Although the initial results were inconclusive, scientists attempted to obtain independent evidence through an additional controlled experiment.',translation:'İlk sonuçlar belirsiz olmasına rağmen bilim insanları ek bir kontrollü deney yoluyla bağımsız kanıt elde etmeye çalıştı.',translationFocus:['elde etmeye'],difficulty:'yds' as const},
  {sentence:'Given the conflicting observations, the committee was unable to obtain sufficient evidence to establish a reliable causal relationship.',translation:'Çelişen gözlemler nedeniyle kurul, güvenilir bir neden-sonuç ilişkisi kurmak için yeterli kanıt elde edemedi.',translationFocus:['elde edemedi'],difficulty:'yds' as const},
];
const newExamples=samples.map(x=>wordExampleSchema.parse(x));
test('staged contract validates exact 2 easy / 1 medium / 2 YDS',()=>{
  expect(hasCompleteTierSet(newExamples)).toBe(true);
  expect(hasCompleteTierSet(newExamples.slice(1))).toBe(false);
});
test('group first chooses medium and retry after wrong chooses easy',()=>{
  const input = starterVocabulary.find(x=>x.word==='Obtain')!;
  const word={...input,examples:newExamples,id:'lexicon-test-word',score:0,createdAt:'2026-11-16T00:00:00.000Z',updatedAt:'2026-11-16T00:00:00.000Z'};
  const s={...createSession([word],5),phase:'context' as const};
  const q=makeQuestion(s)!;
  expect(q.example?.difficulty).toBe('medium');
  const wrong=q.choices.find(x=>x!==q.correct)!;
  const retried=advance(recordAnswer(s,wrong));
  expect(retried.scoreChanges).toEqual({});
  expect(makeQuestion(retried)?.example?.difficulty).toBe('easy');
});
test('final never selects easy or medium',()=>{
 for(let n=0;n<12;n++) expect(chooseTieredExample(newExamples,'final',n,'fixed-uuid')?.difficulty).toBe('yds');
});
test('extra user examples are preserved without corrupting graded questions',()=>{
  const extra={sentence:'I personally obtain books from the library.',translation:'Kütüphaneden şahsen kitap alırım.',source:'Kullanıcı'};
  const withPersonal=[...newExamples,extra];
  expect(hasCompleteTierSet(withPersonal)).toBe(false); // pool stays strictly five
  expect(hasPlayableTierSet(withPersonal)).toBe(true);
  expect(chooseTieredExample(withPersonal,'group',0,'stable')?.difficulty).toBe('medium');
  expect(chooseTieredExample(withPersonal,'group',1,'stable')?.difficulty).toBe('easy');
  expect(chooseTieredExample(withPersonal,'final',0,'stable')?.difficulty).toBe('yds');
  expect(withPersonal.at(-1)?.source).toBe('Kullanıcı');
});
