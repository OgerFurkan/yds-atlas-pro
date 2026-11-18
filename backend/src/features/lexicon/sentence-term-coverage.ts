import type { WordInput } from "@yds-atlas/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../../config/env";
import { quotaClient } from "../../shared/supabase";
import { lookupPublicTurkish, type PublicTurkishResult } from "./public-turkish-dictionary";

const TOKEN=/[A-Za-z][A-Za-z0-9]*(?:['’][A-Za-z]+)?(?:-[A-Za-z]+)*/g;
const COMMON:Record<string,string>={
 a:"bir",an:"bir",the:"belirli tanımlık",and:"ve",or:"veya",but:"ama",of:"-ın/-in",
 to:"-e/-a; -mek/-mak",in:"içinde",on:"üzerinde",at:"-de/-da",for:"için",
 from:"-den/-dan",with:"ile",by:"tarafından; ile",as:"olarak",is:"olmak",
 are:"olmak",was:"idi",were:"idi",be:"olmak",been:"olmuş",have:"sahip olmak",
 has:"sahip olmak",had:"sahip olmak",can:"-ebilmek",may:"-ebilir",
 must:"zorunda olmak",will:"-ecek",would:"-erdi",should:"-meli",
 could:"-ebilirdi",this:"bu",that:"şu; ki",these:"bunlar",those:"şunlar",
 they:"onlar",their:"onların",we:"biz",our:"bizim",it:"o",its:"onun",
 which:"hangi; ki",who:"kim",what:"ne",when:"ne zaman",where:"nerede",
 although:"-e rağmen",while:"-iken; oysa",because:"çünkü",if:"eğer",
 than:"-den/-dan",not:"değil",after:"sonra",before:"önce",
 between:"arasında",into:"içine",during:"sırasında",through:"aracılığıyla",
 such:"böyle",more:"daha fazla",most:"en fazla",also:"ayrıca",both:"her ikisi",
 each:"her biri",only:"yalnızca",other:"diğer",some:"bazı",any:"herhangi bir",
 all:"hepsi",one:"bir",two:"iki"
};
export type SentenceTerm={word_key:string;display_word:string;lemma_key:string;
 status:"ready"|"pending";meanings:string[];source:string;source_url:null;license:null};
export function sentenceTokens(sentences:readonly string[]):string[]{
 const seen=new Set<string>();
 for(const sentence of sentences.slice(0,2000)){
  if(!sentence||sentence.length>1200)continue;
  for(const match of sentence.matchAll(TOKEN)){
   const word=match[0].normalize("NFKC").toLocaleLowerCase("en").replaceAll("’","'");
   if(/^[a-z]+(?:'[a-z]+)?(?:-[a-z]+)?$/.test(word)&&word.length<=45)seen.add(word);
   if(seen.size>=1500)return [...seen];
  }
 }
 return [...seen];
}
export function lemmaCandidates(raw:string):string[]{
 const w=raw.toLocaleLowerCase("en"),forms=[w];
 if(w.length>4&&w.endsWith("ies"))forms.push(w.slice(0,-3)+"y");
 if(w.length>5&&w.endsWith("ing")){
  const stem=w.slice(0,-3);forms.push(stem,stem+"e");
  if(stem.length>2&&stem.at(-1)===stem.at(-2))forms.push(stem.slice(0,-1));
 }
 if(w.length>4&&w.endsWith("ed"))forms.push(w.slice(0,-2),w.slice(0,-1));
 if(w.length>4&&w.endsWith("es"))forms.push(w.slice(0,-2));
 if(w.length>3&&w.endsWith("s"))forms.push(w.slice(0,-1));
 return [...new Set(forms.filter(v=>v.length>1))];
}
export function planSentenceTerms(sentences:readonly string[]):SentenceTerm[]{
 return sentenceTokens(sentences).map(word_key=>({
  word_key,display_word:word_key,lemma_key:word_key,
  status:Object.hasOwn(COMMON,word_key)?"ready":"pending",
  meanings:Object.hasOwn(COMMON,word_key)?[COMMON[word_key]]:[],
  source:Object.hasOwn(COMMON,word_key)?"Atlas curated function words":"pending",
  source_url:null,license:null,
 }));
}
export async function enqueueSentenceTerms(db:SupabaseClient,sentences:readonly string[]){
 const unique=new Map<string,SentenceTerm>();
 // Chunk all imported sentences: never silently discard the 2001st sentence.
 for(let offset=0;offset<sentences.length;offset+=200){
  for(const term of planSentenceTerms(sentences.slice(offset,offset+200)))
   if(!unique.has(term.word_key))unique.set(term.word_key,term);
 }
 const planned=[...unique.values()];
 for(let start=0;start<planned.length;start+=100){
  const {error}=await db.from("atlas_sentence_terms").upsert(planned.slice(start,start+100),{
   onConflict:"word_key",ignoreDuplicates:true,
  });
  if(error)throw error;
 }
 return planned.length;
}
export async function backfillSentenceTerms(db:SupabaseClient){
 let scanned=0,queued=0;
 for(let start=0;start<5000;start+=100){
  const {data,error}=await db.from("words").select("content").order("id").range(start,start+99);
  if(error)throw error;
  const rows=data??[];
  if(!rows.length)break;
  const sentences=rows.flatMap(row=>Array.isArray(row.content?.examples)
   ?row.content.examples.map((e:{sentence?:string})=>e.sentence??""):[]);
  queued+=await enqueueSentenceTerms(db,sentences);
  scanned+=rows.length;
  if(rows.length<100)break;
 }
 return {scanned,queued};
}
export type CoverageStats={processed:number;ready:number;ambiguous:number;missing:number;errors:number};
type WorkerOpts={lookup?:(word:string)=>Promise<PublicTurkishResult>;max?:number};
export async function processSentenceTerms(db:SupabaseClient,opts:WorkerOpts={}):Promise<CoverageStats>{
 const max=Math.max(1,Math.min(10,opts.max??5));
 const {data,error}=await db.from("atlas_sentence_terms").select("word_key,attempts")
  .eq("status","pending").lte("next_attempt_at",new Date().toISOString())
  .order("updated_at",{ascending:true}).limit(max);
 if(error)throw error;
 const out:CoverageStats={processed:0,ready:0,ambiguous:0,missing:0,errors:0};
 for(const row of data??[]){
  const word=String(row.word_key);
  try{
   const value=await (opts.lookup??(w=>lookupPublicTurkish(w,"atlas-sentence-prefetch")))(word);
   const status=value.status==="ready"&&value.entries.length===1?"ready":
    value.status==="missing"?"missing":"ambiguous";
   const entry=value.entries[0];
   const {error:saveError}=await db.from("atlas_sentence_terms").update({
    status,meanings:status==="ready"?entry.meanings:[],
    part_of_speech:status==="ready"?entry.partOfSpeech:null,
    source:status==="ready"?"FreeDictionaryAPI.com / Wiktionary":status,
    source_url:value.source?.url??null,license:value.source?.license??null,
    attempts:0,updated_at:new Date().toISOString()
   }).eq("word_key",word).eq("status","pending");
   if(saveError)throw saveError;
   out.processed++;out[status==="ready"?"ready":status==="missing"?"missing":"ambiguous"]++;
  }catch{
   const attempts=Math.min(3,Number(row.attempts??0)+1);
   await db.from("atlas_sentence_terms").update({
    attempts,status:attempts>=3?"error":"pending",
    next_attempt_at:new Date(Date.now()+Math.pow(2,attempts)*3_600_000).toISOString(),
    updated_at:new Date().toISOString()
   }).eq("word_key",word).eq("status","pending");
   out.errors++;
  }
 }
 return out;
}
export async function lookupSentenceTerm(db:SupabaseClient,word:string){
 const form=word.normalize("NFKC").toLocaleLowerCase("en");
 if(!/^[a-z]+(?:[-'][a-z]+)?$/.test(form))return null;
 const {data,error}=await db.from("atlas_sentence_terms")
  .select("word_key,part_of_speech,meanings,source,source_url,license,status")
  .in("word_key",lemmaCandidates(form)).eq("status","ready").limit(10);
 if(error)throw error;
 const exact=data?.find(x=>x.word_key===form);
 const matches=exact?[exact]:(data??[]);
 if(matches.length!==1||!Array.isArray(matches[0].meanings)||!matches[0].meanings.length)return null;
 return {form,lemma:matches[0].word_key,partOfSpeech:matches[0].part_of_speech,
  meanings:matches[0].meanings,source:matches[0].source,
  sourceUrl:matches[0].source_url,license:matches[0].license};
}
export async function queueWordSentenceCoverage(config:ServerConfig,inputs:readonly WordInput[]){
 if(!config.ATLAS_FEEDBACK_LEXICON_ENABLED)return {queued:0,enabled:false};
 const db=quotaClient(config);
 const sentences=inputs.flatMap(w=>(w.examples??[]).map(e=>e.sentence));
 const queued=await enqueueSentenceTerms(db,sentences);
 void processSentenceTerms(db,{max:5}).catch(()=>{});
 return {queued,enabled:true};
}
/** Bounded automatic processing, roughly 50 provider calls/hour per server. */
export function startSentenceCoverageWorker(config:ServerConfig){
 if(!config.ATLAS_FEEDBACK_LEXICON_ENABLED||!config.SUPABASE_SECRET_KEY)return ()=>{};
 const interval=setInterval(()=>{
  try{void processSentenceTerms(quotaClient(config),{max:5}).catch(()=>{});}
  catch{/* Migration may not yet be installed. */}
 },360_000);
 interval.unref?.();
 return ()=>clearInterval(interval);
}
