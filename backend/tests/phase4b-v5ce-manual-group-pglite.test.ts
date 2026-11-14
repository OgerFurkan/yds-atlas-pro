import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const WORD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function asUser<T>(userId: string, action: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  try { return await action(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; " +
    "create schema auth; create table auth.users(id uuid primary key); " +
    "create function auth.uid() returns uuid language sql stable as $$ " +
    "select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; " +
    "grant usage on schema auth to authenticated,anon,service_role;");
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort())
    await db.exec((await Bun.file(new URL(name, migrations)).text()).replace(/^\uFEFF/, ""));
  await db.exec((await Bun.file(new URL("../../docs/architecture/phase4b-v5ce-manual-groups-ADDITIVE-REVIEW-ONLY.sql", import.meta.url)).text()).replace(/^\uFEFF/, ""));
}, 60_000);
beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;");
  await db.query("insert into auth.users(id) values($1),($2)", [ALICE, BOB]);
  await db.query("insert into public.words(id,user_id,word,score) values($1,$2,'Evidence',25),($3,$4,'Other',75)", [WORD,ALICE,OTHER,BOB]);
});
afterAll(async () => { await db.close(); });
describe("v5C-E additive manual-group SQL — PGlite only", () => {
  test("new column is nullable: legacy words retain existing score", async () => {
    const r = await db.query<{score:number;manual_group:string|null}>("select score,manual_group from public.words where id=$1",[WORD]);
    expect(r.rows).toEqual([{score:25,manual_group:null}]);
  });
  test("function is invoker and authenticated-only", async () => {
    const r=await db.query<{invoker:boolean;userExec:boolean;anonExec:boolean}>(`select
      not p.prosecdef as invoker,
      has_function_privilege('authenticated','public.set_word_groups_v7(jsonb)','EXECUTE') as "userExec",
      has_function_privilege('anon','public.set_word_groups_v7(jsonb)','EXECUTE') as "anonExec"
      from pg_proc p where p.oid='public.set_word_groups_v7(jsonb)'::regprocedure`);
    expect(r.rows).toEqual([{invoker:true,userExec:true,anonExec:false}]);
  });
  test("Alice changes only manual label, never score", async () => {
    await asUser(ALICE,async()=> {
      const r=await db.query<{n:number}>("select public.set_word_groups_v7($1::jsonb) as n",[JSON.stringify([{id:WORD,group_name:'learned'}])]);
      expect(r.rows[0]?.n).toBe(1);
    });
    const r=await db.query<{score:number;manual_group:string|null}>("select score,manual_group from public.words where id=$1",[WORD]);
    expect(r.rows).toEqual([{score:25,manual_group:'learned'}]);
  });
  test("cross-owner group mutation rolls back in full", async () => {
    await asUser(ALICE,async()=> {
      await expect(db.query("select public.set_word_groups_v7($1::jsonb)",[
        JSON.stringify([{id:WORD,group_name:'review'},{id:OTHER,group_name:'learned'}]),
      ])).rejects.toThrow();
    });
    const r=await db.query<{id:string;manual_group:string|null}>("select id,manual_group from public.words order by id");
    expect(r.rows.every((x)=>x.manual_group===null)).toBe(true);
  });
  test("duplicate IDs, invalid group and empty input reject", async () => {
    await asUser(ALICE,async()=> {
      for (const payload of [[], [{id:WORD,group_name:'bad'}],
        [{id:WORD,group_name:'hard'},{id:WORD,group_name:'review'}]])
        await expect(db.query("select public.set_word_groups_v7($1::jsonb)",[JSON.stringify(payload)])).rejects.toThrow();
    });
  });
  test("legacy score-writing privilege is STILL open: this is NOT a cutover", async () => {
    const r=await db.query<{canUpdate:boolean}>(`select has_table_privilege('authenticated','public.words','UPDATE') as "canUpdate"`);
    expect(r.rows[0]?.canUpdate).toBe(true);
  });
});
