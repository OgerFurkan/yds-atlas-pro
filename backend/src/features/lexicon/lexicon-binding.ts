import type { SupabaseClient } from "@supabase/supabase-js";
import type { WordInput } from "@yds-atlas/shared";
import { HttpError } from "../../shared/errors";
import type { ServerConfig } from "../../config/env";
import { quotaClient } from "../../shared/supabase";
import { lexicalIdentity } from "./lexicon-identity";

/** No browser-supplied pool id can be accepted without comparing its server-owned revision. */
export async function verifyUserWordLexiconBinding(
  config:ServerConfig, input:WordInput, admin?:SupabaseClient,
): Promise<void>{
  if(!input.lexicon)return;
  if(!input.partOfSpeech || !input.meanings?.[0] || !input.examples?.length)
    throw new HttpError(409,"Havuz bağlantısı için eksiksiz tür, anlam ve örnek gerekli.","LEXICON_BINDING_INCOMPLETE");
  // Legacy/unbound words must not create a privileged Supabase client.
  const db=admin ?? quotaClient(config);
  const {data,error}=await db.from("atlas_lexicon_entry_revisions")
    .select("entry_id,revision,content")
    .eq("entry_id",input.lexicon.entryId).eq("revision",input.lexicon.revision).maybeSingle();
  if(error)throw error;
  if(!data)throw new HttpError(409,"Kelime havuzu sürümü artık mevcut değil.","LEXICON_VERSION_MISSING");
  const source=data.content as {word:string;partOfSpeech:string;meanings:string[];
    examples:Array<{sentence:string;translation:string;difficulty:string}>};
  const requested=lexicalIdentity(input.word,input.partOfSpeech,input.meanings?.[0]??"");
  const original=lexicalIdentity(source.word,source.partOfSpeech,source.meanings[0]);
  const sameIdentity=requested.wordKey===original.wordKey&&
    requested.partOfSpeech===original.partOfSpeech&&requested.senseKey===original.senseKey;
  const expected=source.examples.map(e=>[e.sentence,e.translation,e.difficulty]);
  // Allow private supplemental examples, never a forged sixth graded example.
  // The canonical five still must match the server-owned pool revision exactly.
  const actual=(input.examples??[]).filter(e=>e.difficulty).map(e=>[e.sentence,e.translation,e.difficulty]);
  if(!sameIdentity||JSON.stringify(actual)!==JSON.stringify(expected))
    throw new HttpError(409,"Havuz referansı ile düzenlenen içerik uyuşmuyor. Kaydı gözden geçir.","LEXICON_BINDING_MISMATCH");
}
