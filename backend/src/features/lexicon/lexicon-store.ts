import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LexiconEntry, LexiconStore } from "./lexicon-resolver";

/** Service-role ONLY. Never reuse an authenticated client's Supabase connection. */
export function lexiconStore(db: SupabaseClient): LexiconStore {
  const table = "atlas_lexicon_entries";
  return {
    async findCandidates(wordKey) {
      const {data,error} = await db.from(table)
        .select("id,word_key,part_of_speech,sense_key,revision,status,content,provenance")
        .eq("word_key",wordKey)
        .in("status",["machine_validated","human_reviewed"])
        .limit(30);
      if(error)throw error;
      if((data??[]).length===30)throw new Error("Lexicon candidate cap exceeded; refuse ambiguous lookup");
      return (data??[]).map(row=>({
        id:row.id,wordKey:row.word_key,partOfSpeech:row.part_of_speech,senseKey:row.sense_key,
        revision:row.revision,status:row.status,content:row.content,provenance:row.provenance,
      })) as LexiconEntry[];
    },
    async claim(lease) {
      const {data,error}=await db.rpc("atlas_lexicon_claim_v1",{
        p_word_key:lease.wordKey,p_pos:lease.partOfSpeech,p_sense_key:lease.senseKey,p_token:lease.token,
      });
      if(error)throw error;
      return data===true;
    },
    async publish(lease,identity,content,provenance) {
      const digest=createHash("sha256").update(JSON.stringify(content)).digest("hex");
      const {data,error}=await db.rpc("atlas_lexicon_publish_v1",{
        p_word_key:lease.wordKey,p_pos:lease.partOfSpeech,p_sense_key:lease.senseKey,
        p_token:lease.token,p_entry_word:content.word,p_entry_pos:identity.partOfSpeech,
        p_entry_sense:identity.senseKey,p_content:content,p_provenance:provenance,p_digest:digest,
      });
      if(error)throw error;
      if(!data)return null;
      const row=Array.isArray(data)?data[0]:data;
      if (!row || row.word_key !== identity.wordKey ||
          row.part_of_speech !== identity.partOfSpeech || row.sense_key !== identity.senseKey)
        throw new Error('Pool publisher returned an unexpected lexical identity');
      return {id:row.id,wordKey:row.word_key,partOfSpeech:row.part_of_speech,
        senseKey:row.sense_key,revision:row.revision,status:row.status,
        content:row.content,provenance:row.provenance} as LexiconEntry;
    },
    async fail(lease,code) {
      // The lease is normally marked ready by publish; conditional update cannot undo that.
      const {error}=await db.from("atlas_lexicon_jobs").update({status:"failed",last_error_code:code,lease_token:null,
        lease_expires_at:null,updated_at:new Date().toISOString()})
        .eq("word_key",lease.wordKey).eq("part_of_speech",lease.partOfSpeech)
        .eq("sense_key",lease.senseKey).eq("lease_token",lease.token).eq("status","generating");
      if(error)throw error;
    },
  };
}
