/** Durable, private English->Turkish tooltip prewarming.
 * No user sentences/IDs are written to the shared cache. No AI calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../../config/env";
import type { RequestContext } from "../../shared/supabase";
import { quotaClient } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
import { assertAtlasAdmin } from "../admin/admin-service";
import { dictionaryWord, lookupPublicTurkish, type PublicTurkishResult } from "./public-turkish-dictionary";

const TABLE="atlas_sentence_tooltips";
const INTERNAL="atlas-internal-prewarm-worker";
export function extractTooltipTokens(examples:readonly {sentence?:string}[],limit=250):string[]{
  const set=new Set<string>();
  for(const row of examples.slice(0,Math.min(1000,limit*3))){
    const raw=typeof row?.sentence==="string"?row.sentence:"";
    if(raw.length>1400||/[ğüşıöçĞÜŞİÖÇ]/u.test(raw))continue;
    const sentence=raw.replace(/https?:\/\/[^\s]+/gi," ")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi," ");
    for(const match of sentence.matchAll(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g)){
      const word=match[0],at=match.index;
      if(word.length<2||word.length>45||/[A-Z]/.test(word.slice(1)))continue;
      if(sentence.slice(0,at).trim()&&word[0]!==word[0].toLowerCase())continue;
      if(at>0&&/[@/#]/.test(sentence[at-1]))continue;
      const key=word.toLowerCase();
      if(!/^[a-z]+(?:[-'][a-z]+)?$/.test(key))continue;
      set.add(key);if(set.size>=limit)return [...set];
    }
  }
  return [...set];
}
function lemmas(word:string):string[]{
  if(word.length<5||!/^[a-z]+$/.test(word))return [];
  const out:string[]=[];
  if(word.endsWith("ies"))out.push(word.slice(0,-3)+"y");
  else if(word.endsWith("es"))out.push(word.slice(0,-2),word.slice(0,-1));
  else if(word.endsWith("s")&&!word.endsWith("ss"))out.push(word.slice(0,-1));
  if(word.endsWith("ing")&&word.length>6){
    const base=word.slice(0,-3);out.push(base,base+"e");
    if(base.at(-1)===base.at(-2))out.push(base.slice(0,-1));
  }
  if(word.endsWith("ed")&&word.length>5)out.push(word.slice(0,-2),word.slice(0,-1));
  return [...new Set(out)].filter(x=>x.length>=3&&x!==word).slice(0,3);
}
async function enqueueTokens(db:SupabaseClient,tokens:string[]){
  for(let i=0;i<tokens.length;i+=250){
    const {error}=await db.from(TABLE).upsert(
      tokens.slice(i,i+250).map(word_key=>({word_key})),
      {onConflict:"word_key",ignoreDuplicates:true});
    databaseError(error);
  }
}
export async function enqueueTooltipExamples(config:ServerConfig,examples:readonly {sentence?:string}[],db?:SupabaseClient){
  if(!config.ATLAS_TOOLTIP_PREWARM_ENABLED)return 0;
  const tokens=extractTooltipTokens(examples,250);
  if(tokens.length)await enqueueTokens(db??quotaClient(config),tokens);
  return tokens.length;
}
export async function backfillTooltipPage(config:ServerConfig,cursor:string|null,limit=50,db?:SupabaseClient){
  if(!config.ATLAS_TOOLTIP_PREWARM_ENABLED)
    throw new HttpError(404,"Otomatik sözlük hazırlama kapalı.","TOOLTIP_PREWARM_DISABLED");
  const admin=db??quotaClient(config);
  let q=admin.from("words").select("id,content").order("id").limit(Math.max(1,Math.min(limit,50)));
  if(cursor)q=q.gt("id",cursor);
  const {data,error}=await q;databaseError(error);
  const entries=data??[];
  const examples: {sentence:string}[]=[];
  for(const row of entries){
    const current=(row.content as {examples?:unknown}|null)?.examples;
    if(Array.isArray(current))for(const ex of current.slice(0,12))
      if(ex&&typeof ex.sentence==="string")examples.push({sentence:ex.sentence});
  }
  const tokens=extractTooltipTokens(examples,4000);
  await enqueueTokens(admin,tokens);
  return {scanned:entries.length,unique:tokens.length,
    nextCursor:entries.length===Math.max(1,Math.min(limit,50))?entries.at(-1)?.id??null:null,
    done:entries.length<Math.max(1,Math.min(limit,50))};
}
export async function adminBackfillTooltipPage(ctx:RequestContext,config:ServerConfig,cursor:string|null,limit=50,db?:SupabaseClient){
  assertAtlasAdmin(ctx,config);
  return backfillTooltipPage(config,cursor,limit,db);
}
function safeResult(key:string,raw:unknown):PublicTurkishResult|null {
  if(!raw||typeof raw!=="object")return null;
  const x=raw as PublicTurkishResult;
  if(!["ready","choices","missing"].includes(x.status)||!Array.isArray(x.entries)||
    typeof x.word!=="string"||!/^[a-z]+(?:[-'][a-z]+)?$/.test(x.word))return null;
  if(x.entries.length>8||x.entries.some(e=>!e||typeof e.partOfSpeech!=="string"||
    !Array.isArray(e.meanings)||e.meanings.length>8||
    e.meanings.some(m=>typeof m!=="string"||m.length>85)))return null;
  if(x.status==="ready"&&x.entries.length!==1)return null;
  if(x.status==="choices"&&x.entries.length<2)return null;
  if(x.status==="missing"&&x.entries.length!==0)return null;
  if(x.status!=="missing"&&(!x.source||
      x.source.license!=="CC BY-SA 4.0"||
      x.source.licenseUrl!=="https://creativecommons.org/licenses/by-sa/4.0/"||
      !x.source.url.startsWith("https://en.wiktionary.org/wiki/")))return null;
  return x;
}
export async function cachedTooltipBatch(config:ServerConfig,inputs:readonly string[],db?:SupabaseClient){
  if(!config.ATLAS_TOOLTIP_PREWARM_ENABLED)return {} as Record<string,PublicTurkishResult>;
  if(inputs.length>65)throw new HttpError(400,"En fazla 65 kelime.","TOOLTIP_BATCH_TOO_LARGE");
  const words=[...new Set(inputs.map(dictionaryWord))];
  if(!words.length)return {};
  const {data,error}=await (db??quotaClient(config)).from(TABLE)
    .select("word_key,status,result,expires_at").in("word_key",words)
    .in("status",["ready","choices","missing"]).limit(65);
  databaseError(error);
  const map:Record<string,PublicTurkishResult>={};
  for(const row of data??[]){
    if(row.expires_at&&Date.parse(row.expires_at)<=Date.now())continue;
    const r=safeResult(row.word_key,row.result);if(r)map[row.word_key]=r;
  }
  return map;
}
export async function cachedOrLiveTooltip(config:ServerConfig,raw:string,userId:string,
 fetcher:typeof fetch=fetch,db?:SupabaseClient){
  const word=dictionaryWord(raw);
  if(!config.ATLAS_TOOLTIP_PREWARM_ENABLED)return lookupPublicTurkish(word,userId,fetcher);
  const admin=db??quotaClient(config);
  try{const hit=(await cachedTooltipBatch(config,[word],admin))[word];if(hit)return hit;}
  catch{/* Optional cache never blocks the existing dictionary. */}
  const live=await lookupPublicTurkish(word,userId,fetcher);
  const value={status:live.status,result:live,expires_at:new Date(Date.now()+
    (live.status==="missing"?7:90)*86400_000).toISOString(),updated_at:new Date().toISOString()};
  try{
    const updated=await admin.from(TABLE).update(value).eq("word_key",word)
      .neq("status","leased").select("word_key");
    if(!updated.error&&!updated.data?.length)await admin.from(TABLE).upsert(
      [{word_key:word,...value}],{onConflict:"word_key",ignoreDuplicates:true});
  }catch{/* User-facing lookup already succeeded. */}
  return live;
}
async function resolveWord(word:string,fetcher:typeof fetch){
  let result=await lookupPublicTurkish(word,INTERNAL,fetcher);
  if(result.status!=="missing")return result;
  for(const candidate of lemmas(word)){
    const next=await lookupPublicTurkish(candidate,INTERNAL,fetcher);
    if(next.status!=="missing")return next;
  }
  return result;
}
export async function drainTooltipQueue(config:ServerConfig,db?:SupabaseClient,fetcher:typeof fetch=fetch){
  const stats={claimed:0,ready:0,choices:0,missing:0,retry:0};
  if(!config.ATLAS_TOOLTIP_PREWARM_ENABLED)return stats;
  const admin=db??quotaClient(config);
  const {data,error}=await admin.rpc("atlas_tooltip_claim_v1",{p_limit:2});
  databaseError(error);
  for(const job of Array.isArray(data)?data:[]){
    const word=job.word_key,token=job.lease_token;
    if(typeof word!=="string"||typeof token!=="string")continue;
    stats.claimed++;
    try{
      const result=await resolveWord(word,fetcher);
      const {error:writeError}=await admin.from(TABLE).update({
        status:result.status,result,
        expires_at:new Date(Date.now()+(result.status==="missing"?7:90)*86400_000).toISOString(),
        lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString(),
      }).eq("word_key",word).eq("lease_token",token).eq("status","leased");
      databaseError(writeError);
      stats[result.status]++;
    }catch{
      await admin.from(TABLE).update({status:"retry",
        available_at:new Date(Date.now()+15*60_000).toISOString(),
        lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString(),
      }).eq("word_key",word).eq("lease_token",token).eq("status","leased");
      stats.retry++;
    }
  }
  return stats;
}
export function startTooltipPrewarmWorker(config:ServerConfig):()=>void{
  if(!config.ATLAS_TOOLTIP_PREWARM_ENABLED)return ()=>{};
  let busy=false, cursor:string|null=null,done=false;
  const run=async()=>{
    if(busy)return;busy=true;
    try{
      if(!done){const page=await backfillTooltipPage(config,cursor);cursor=page.nextCursor;done=page.done;}
      await drainTooltipQueue(config);
    }catch{/* DB/provider outage: retry on the next timer; no user content logged. */}
    finally{busy=false;}
  };
  const timer=setInterval(()=>{void run();},30_000);timer.unref?.();void run();
  return ()=>clearInterval(timer);
}

