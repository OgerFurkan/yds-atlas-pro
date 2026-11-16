import { hasCompleteTierSet, type AiWordListResponse } from "@yds-atlas/shared";
import type { RequestContext } from "../../shared/supabase";
import type { ServerConfig } from "../../config/env";
import { quotaClient } from "../../shared/supabase";
import { databaseError, HttpError } from "../../shared/errors";
import { lexicalIdentity } from "./lexicon-identity";
import { validateLexicalCandidate } from "./lexicon-content-validator";
import { telemetryEvent } from "../admin/telemetry";

const normalize = (word: string) => word.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en");
const valid = (word: string) => /^[a-z]+(?:[ '-][a-z]+)*$/.test(word) && word.length <= 120;

type PoolRow = {
  id:string;word_key:string;part_of_speech:string;sense_key:string;revision:number;
  status:string;content:Record<string,unknown>;
};

/** Exclusion is derived from the authenticated user's RLS-scoped library on the server.
 * The browser-supplied exclude list is supplementary and never authorizes access. */
export async function recommendLexiconWords(
  ctx: RequestContext,config: ServerConfig,count: number,excludedWords: string[],
): Promise<AiWordListResponse> {
  if(!Number.isSafeInteger(count)||count<1||count>5)
    throw new HttpError(400,"Bir defada 1–5 kelime önerilebilir.","INVALID_COUNT");
  const excluded=new Set(excludedWords.map(normalize).filter(valid));
  for(let offset=0;offset<20000;offset+=500){
    const {data,error}=await ctx.db.from("words").select("word")
      .order("id").range(offset,offset+499);
    databaseError(error);
    for(const word of data??[])excluded.add(normalize(word.word));
    if((data?.length??0)<500)break;
    if(offset===19500)throw new HttpError(503,"Kütüphane filtreleme kapasitesi aşıldı.","RECOMMEND_EXCLUSION_LIMIT");
  }
  const db=quotaClient(config);
  // Only reviewed pool entries, no Gemini fallback or AI quota on this route.
  // The SQL function performs exclusion and bounded indexed selection; no full table dump.
  const {data,error}=await db.rpc("atlas_lexicon_recommend_v1",{
    p_excluded:[...excluded],p_count:Math.min(30,Math.max(count*4,count)),
    p_seed:crypto.randomUUID(),
  });
  databaseError(error);
  const suggestions:AiWordListResponse["suggestions"]=[];
  const selected=new Set<string>();
  for(const row of (data??[]) as PoolRow[]){
    if(suggestions.length===count)break;
    try {
      if(row.status!=="human_reviewed"||!valid(row.word_key)||excluded.has(row.word_key)||selected.has(row.word_key))continue;
      const c=row.content;
      const identity=lexicalIdentity(String(c.word),String(c.partOfSpeech),(c.meanings as string[])[0]);
      if(identity.wordKey!==row.word_key||identity.partOfSpeech!==row.part_of_speech||identity.senseKey!==row.sense_key)continue;
      if(!hasCompleteTierSet(c.examples as Parameters<typeof hasCompleteTierSet>[0]))continue;
      validateLexicalCandidate(c as Parameters<typeof validateLexicalCandidate>[0]);
      selected.add(row.word_key);
      suggestions.push({
        ...(c as unknown as AiWordListResponse["suggestions"][number]),
        lexicon:{entryId:row.id,revision:row.revision,contractVersion:1},
      });
    }catch { /* malformed/quarantined content never becomes a recommendation */ }
  }
  if(!suggestions.length){
    void telemetryEvent(config,ctx.userId,"recommend_empty","recommend");
    throw new HttpError(409,"Havuzda sana uygun, editoryal onaylı kelime kalmadı. Kendi kelimeni ekleyebilir veya AI ile yeni kelime oluşturabilirsin.","LEXICON_POOL_EMPTY");
  }
  void telemetryEvent(config,ctx.userId,"recommend_pool_hit","recommend");
  return {suggestions,provider:"Lexicon",model:"atlas-human-reviewed-pool-v1",dictionarySources:[]};
}
