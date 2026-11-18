import { describe, expect, test } from "bun:test";
import { saveWord } from "../src/features/words/word-service";
import type { RequestContext } from "../src/shared/supabase";

const timestamp = "2026-11-18T12:00:00.000Z";
const backup = Array.from({length:5},(_,i)=>({
  sentence: "Original historical example " + (i+1) + " with abandon.",
  translation:"Bu orijinal örnek cümle " + (i+1) + ".",
  translationFocus:["orijinal"],source:"Original content",
}));
const input = {word:"Abandon",score:0,meanings:["terk etmek"],partOfSpeech:"Verb",
  examples:[{sentence:"The workers abandon the unsafe building.",
    translation:"İşçiler güvensiz binayı terk eder.",difficulty:"easy" as const,translationFocus:["terk eder"]}]};

function context(previous: Record<string,unknown>|null){
  const state:{updated?:Record<string,unknown>,inserted?:Record<string,unknown>,filters:[string,unknown][],readFilters:[string,unknown][]}={
    filters:[],readFilters:[],
  };
  const db={
    from(table:string){
      if(table!=="words") throw Error("Wrong table");
      return {
        select(_columns:string){
          return {eq(field:string,value:unknown){state.readFilters.push([field,value]);return this;},
            async maybeSingle(){return {data:previous,error:null};}};
        },
        update(fields:Record<string,unknown>){
          state.updated=fields;
          return {eq(field:string,value:unknown){state.filters.push([field,value]);return this;},
            select(_fields:string){
              return {async maybeSingle(){return {data:{
                ...fields,id:"word-id",created_at:timestamp,updated_at:timestamp,
                word:"Abandon",score:0,manual_group:null,
              },error:null};}};
            }};
        },
        insert(fields:Record<string,unknown>){
          state.inserted=fields;
          return {select(_fields:string){
            return {async maybeSingle(){return {data:{
              ...fields,id:"new-word",created_at:timestamp,updated_at:timestamp,
              word:"Abandon",score:0,manual_group:null,
            },error:null};}};
          }};
        },
      };
    },
  };
  return {ctx:{userId:"owning-user",db:db as unknown as RequestContext["db"]},state};
}

describe("server-owned legacy example backups survive normal user edits",()=>{
  test("preserves the original five examples, enforces owner and optimistic concurrency",async()=>{
    const {ctx,state}=context({content:{legacyExamplesBackup:backup},updated_at:timestamp});
    const saved=await saveWord(ctx,{...input,legacyExamplesBackup:[{sentence:"malicious"}]} as unknown as typeof input,"word-id");
    expect(saved.word).toBe("Abandon");
    const persisted=(state.updated?.content as Record<string,unknown>);
    expect(persisted.legacyExamplesBackup).toEqual(backup);
    expect(persisted.examples).toEqual(input.examples);
    expect(state.readFilters).toContainEqual(["user_id","owning-user"]);
    expect(state.filters).toContainEqual(["user_id","owning-user"]);
    expect(state.filters).toContainEqual(["updated_at",timestamp]);
  });
  test("refuses edits when a historical backup is corrupted",async()=>{
    const {ctx,state}=context({content:{legacyExamplesBackup:[{sentence:"missing translation"}]},updated_at:timestamp});
    await expect(saveWord(ctx,input,"word-id")).rejects.toMatchObject({code:"LEGACY_BACKUP_INVALID"});
    expect(state.updated).toBeUndefined();
  });
  test("refuses to edit an id not owned by the signed-in user",async()=>{
    const {ctx,state}=context(null);
    await expect(saveWord(ctx,input,"word-id")).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(state.updated).toBeUndefined();
  });
  test("a new word never accepts client-supplied legacy backups",async()=>{
    const {ctx,state}=context(null);
    await saveWord(ctx,{...input,legacyExamplesBackup:backup} as unknown as typeof input);
    expect((state.inserted?.content as Record<string,unknown>).legacyExamplesBackup).toBeUndefined();
  });
});
