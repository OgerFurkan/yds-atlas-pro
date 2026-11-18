import {createHash,randomUUID} from "node:crypto";
import {hasCompleteTierSet, type WordInput} from "@yds-atlas/shared";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {ServerConfig} from "../../config/env";
import {quotaClient} from "../../shared/supabase";
import {dictionaryWord,lookupPublicTurkish,type PublicTurkishResult} from "./public-turkish-dictionary";
import {lexiconStore} from "./lexicon-store";
import type {LexiconStore} from "./lexicon-resolver";

const KIND="atlas_tooltip_gloss_v1";
const TOKEN=/[A-Za-z][A-Za-z0-9]*(?:[’'][A-Za-z]+)?(?:-[A-Za-z]+)*/g;
// Grammar words are not expensive 5-example generation candidates.
const COMMON=new Set(("a an the and or but of to in on at for from with by as is are was were be been "+
 "have has had can may must will would should could this that these those they their we our "+
 "you your it its which who what when where although while because if than not after before "+
 "between into during through such more most also both each only other some any all one two").split(" "));
export function sentenceTokens(sentences:readonly string[]):string[]{
 const result=new Set<string>();
 for(const sentence of sentences){
  if(!sentence||sentence.length>1200)continue;
  for(const match of sentence.matchAll(TOKEN)){
   const token=match[0].normalize("NFKC").toLocaleLowerCase("en").replaceAll("’","'");
   if(/^[a-z]+(?:'[a-z]+)?(?:-[a-z]+)?$/.test(token) && token.length<=45 && !COMMON.has(token))
    result.add(token);
  }
 }
 return [...result];
}
export function lemmaCandidates(raw:string):string[]{
 const w=raw.toLocaleLowerCase("en"),p=[w];
 if(w.length>4&&w.endsWith("ies"))p.push(w.slice(0,-3)+"y");
 if(w.length>5&&w.endsWith("ing")){
  const stem=w.slice(0,-3);p.push(stem,stem+"e");
  if(stem.length>2&&stem.at(-1)===stem.at(-2))p.push(stem.slice(0,-1));
 }
 if(w.length>4&&w.endsWith("ed"))p.push(w.slice(0,-2),w.slice(0,-1));
 if(w.length>4&&w.endsWith("es"))p.push(w.slice(0,-2));
 if(w.length>3&&w.endsWith("s"))p.push(w.slice(0,-1));
 return [...new Set(p.filter(x=>x.length>1))];
}
export function tooltipWriteEnabled(config:ServerConfig):boolean {
 // Explicit deploy-time opt-in; disabled on production and all existing environments.
 return config.ATLAS_FEEDBACK_LEXICON_ENABLED &&
  process.env.ATLAS_SENTENCE_PREFETCH_WRITE_ENABLED==="true" && !!config.SUPABASE_SECRET_KEY;
}
type Gloss={word_key:string;part_of_speech:string;content:Record<string,unknown>;
 provenance:Record<string,unknown>;status:string};
function verifiedGloss(row:Gloss) {
 const content=row.content, source=row.provenance;
 if(row.part_of_speech!=="Tooltip"||row.status!=="machine_validated"||content?.kind!==KIND||
  source?.kind!==KIND||source?.license!=="CC BY-SA 4.0"||
  source?.provider!=="FreeDictionaryAPI.com / Wiktionary"||
  !Array.isArray(content.meanings)||content.meanings.length<1||content.meanings.length>4||
  !content.meanings.every(x=>typeof x==="string"&&x.length>0&&x.length<=85)||
  typeof source.url!=="string")return null;
 try {
  const uri=new URL(source.url);
  if(uri.protocol!=="https:"||uri.hostname!=="en.wiktionary.org"||!uri.pathname.startsWith("/wiki/"))return null;
 }catch{return null;}
 return {word:row.word_key,partOfSpeech:String(content.originalPartOfSpeech),
  meanings:content.meanings as string[],url:String(source.url)};
}
export async function lookupSharedGloss(db:SupabaseClient,raw:string){
 const word=dictionaryWord(raw);
 const {data,error}=await db.from("atlas_lexicon_entries")
  .select("word_key,part_of_speech,content,provenance,status")
  .eq("part_of_speech","Tooltip").eq("word_key",word)
  .in("status",["machine_validated"]).limit(10);
 if(error)throw error;
 const all=(data??[]).map(x=>verifiedGloss(x as Gloss)).filter(x=>x!==null);
 const matches=all.filter(x=>x.word===word);
 return matches.length===1?matches[0]:null;
}
export async function existingFullEntry(db:SupabaseClient,word:string):Promise<boolean>{
 const {data,error}=await db.from("atlas_lexicon_entries")
  .select("part_of_speech,content,status").eq("word_key",word)
  .neq("part_of_speech","Tooltip")
  .in("status",["machine_validated","human_reviewed"]).limit(30);
 if(error)throw error;
 return (data??[]).some(row=>Array.isArray(row.content?.meanings)&&row.content.meanings.length>0 &&
   Array.isArray(row.content?.examples)&&hasCompleteTierSet(row.content.examples));
}
export function glossaryRecord(word:string,response:PublicTurkishResult){
 if(response.status!=="ready"||response.entries.length!==1||!response.source||
  response.source.license!=="CC BY-SA 4.0"||
  response.source.provider!=="FreeDictionaryAPI.com / Wiktionary"||
  response.entries[0].meanings.length<1)return null;
 const source=response.source,entry=response.entries[0];
 const meanings=[...new Set(entry.meanings)].filter(x=>x.trim()&&x.length<=85).slice(0,4);
 if(!meanings.length||!entry.partOfSpeech||entry.partOfSpeech.length>32)return null;
 const url=new URL(source.url);
 if(url.protocol!=="https:"||url.hostname!=="en.wiktionary.org"||!url.pathname.startsWith("/wiki/"))return null;
 const content={kind:KIND,word,partOfSpeech:"Tooltip",originalPartOfSpeech:entry.partOfSpeech,
  meanings,alternatives:[],usageNote:"",cefr:"Belirtilmedi",examples:[]};
 return {word_key:word,part_of_speech:"Tooltip",
  sense_key:createHash("sha256").update(KIND+":"+word).digest("hex"),
  status:"machine_validated",revision:1,content,
  provenance:{kind:KIND,provider:source.provider,url:source.url,
   license:source.license,licenseUrl:source.licenseUrl,
   validation:"dictionary_verified_not_context_certified"},
  digest:createHash("sha256").update(JSON.stringify(content)).digest("hex")};
}
/** Preserve existing canonical publisher lease, collision checks and immutable revisions. */
export async function publishSharedGlossViaLedger(
 db:SupabaseClient, record:NonNullable<ReturnType<typeof glossaryRecord>>,
 store:Pick<LexiconStore,"claim"|"publish"|"fail">=lexiconStore(db),
):Promise<boolean>{
 const identity={wordKey:record.word_key,partOfSpeech:"Tooltip",senseKey:record.sense_key};
 const lease={...identity,token:randomUUID()};
 const claimed=await store.claim(lease);
 if(!claimed)return false;
 try{
  const saved=await store.publish(lease,identity,record.content,record.provenance);
  const content=saved?.content as {kind?:string}|undefined;
  if(!saved||saved.status!=="machine_validated"||content?.kind!==KIND||
     saved.provenance.kind!==KIND||saved.provenance.license!=="CC BY-SA 4.0")
   throw new Error("Tooltip publication rejected or conflicting canonical entry");
  return true;
 }finally{
  // Token-conditional: already published leases remain ready, failures are released.
  await store.fail(lease,"GLOSS_PUBLISH_REJECTED").catch(()=>{});
 }
}
export type ProcessReport={processed:number;existing:number;cached:number;inserted:number;
 ambiguous:number;missing:number;errors:number};
type ProcessDeps={
 dictionary?:(word:string)=>Promise<PublicTurkishResult>;
 alreadyFull?:(word:string)=>Promise<boolean>;
 alreadyCached?:(word:string)=>Promise<unknown>;
 persist?:(entry:ReturnType<typeof glossaryRecord>)=>Promise<void>;
};
export async function processSharedLexiconWords(db:SupabaseClient,words:readonly string[],deps:ProcessDeps={}):Promise<ProcessReport>{
 const result:ProcessReport={processed:0,existing:0,cached:0,inserted:0,ambiguous:0,missing:0,errors:0};
 // Per-tick cap is deliberate; no user quotas, no Gemini, no user mutations.
 for(const word of [...new Set(words)].slice(0,5)){
  result.processed++;
  try{
   if(await (deps.alreadyFull??(x=>existingFullEntry(db,x)))(word)){result.existing++;continue;}
   if(await (deps.alreadyCached??(x=>lookupSharedGloss(db,x)))(word)){result.cached++;continue;}
   const lookup=await (deps.dictionary??(x=>lookupPublicTurkish(x,"atlas-prefetch-service")))(word);
   const record=glossaryRecord(word,lookup);
   if(!record){result[lookup.status==="missing"?"missing":"ambiguous"]++;continue;}
   if(deps.persist)await deps.persist(record);
   else if(!(await publishSharedGlossViaLedger(db,record))) {result.cached++;continue;}
   result.inserted++;
  }catch{result.errors++;}
 }
 return result;
}
const queue=new Map<string,number>();
let working=false;
const MAX_QUEUE=6000;
export function queueSentenceLexicon(sentences:readonly string[]):number{
 let added=0;
 for(const word of sentenceTokens(sentences)){
  if(queue.has(word)||queue.size>=MAX_QUEUE)continue;
  queue.set(word,0);added++;
 }
 return added;
}
export function enqueueWordExamples(inputs:readonly WordInput[]):number{
 return queueSentenceLexicon(inputs.flatMap(w=>(w.examples??[]).map(e=>e.sentence)));
}
export function pendingLexiconCount(){return queue.size;}
export async function drainSharedLexiconQueue(config:ServerConfig,deps?:ProcessDeps){
 if(working||!tooltipWriteEnabled(config)||!queue.size)return null;
 working=true;
 const next=[...queue.entries()].filter(([,due])=>due<=Date.now()).slice(0,5).map(([key])=>key);
 if(!next.length){working=false;return null;}
 try {
  const db=quotaClient(config);
  const result:ProcessReport={processed:0,existing:0,cached:0,inserted:0,ambiguous:0,missing:0,errors:0};
  for(const key of next){
   const item=await processSharedLexiconWords(db,[key],deps);
   for(const field of Object.keys(result) as Array<keyof ProcessReport>)result[field]+=item[field];
   // A transient database/provider error must not silently discard queued work.
   if(item.errors)queue.set(key,Date.now()+3_600_000);
   else queue.delete(key);
  }
  return result;
 }finally{working=false;}
}
export async function scanSavedSentences(db:SupabaseClient,limit=5000):Promise<number>{
 let queued=0;
 for(let offset=0;offset<limit;offset+=100){
  const {data,error}=await db.from("words").select("content").order("id").range(offset,offset+99);
  if(error)throw error;
  for(const row of data??[]){
   const examples=Array.isArray(row.content?.examples)?row.content.examples:[];
   queued+=queueSentenceLexicon(examples.map((e:{sentence?:unknown})=>
    typeof e.sentence==="string"?e.sentence:""));
  }
  if((data?.length??0)<100)break;
 }
 return queued;
}
export function startSharedLexiconPrefetch(config:ServerConfig){
 if(!tooltipWriteEnabled(config))return ()=>{};
 const db=quotaClient(config);
 void scanSavedSentences(db).catch(()=>{});
 const timer=setInterval(()=>{void drainSharedLexiconQueue(config).catch(()=>{});},360_000);
 timer.unref?.();
 return ()=>clearInterval(timer);
}
