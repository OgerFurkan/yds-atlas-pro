import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Cutover rehearsal in isolated PGlite only. No user or remote database used.
 * The PRE-CUTOVER baseline is intentionally kept as a separate independent fixture.
 */
const db = new PGlite();
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const WA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function asRole<T>(role: "authenticated" | "service_role", owner: string,
  op: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  try { return await op(); } finally { await db.exec("reset role"); }
}

beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; " +
    "create schema auth; create table auth.users(id uuid primary key); " +
    "create function auth.uid() returns uuid language sql stable as $$ " +
    "select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; " +
    "grant usage on schema auth to authenticated,anon,service_role;");
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(f => f.endsWith(".sql")).sort()) {
    await db.exec((await Bun.file(new URL(name,migrations)).text()).replace(/^\uFEFF/, ""));
  }
  await db.exec(`grant usage on schema public to service_role;
    grant all on public.learning_sessions, public.learning_results, public.words,
      public.word_review_schedules, public.daily_word_completions,
      public.completed_goal_days, public.profiles to service_role;`);
  for (const name of [
    "phase4b-v3-atomic-completion-DRAFT.sql",
    "phase4b-v5a-session-writer-REVIEW-ONLY.sql",
    "phase4b-v5cc-goal-writer-REVIEW-ONLY.sql",
    "phase4b-v5cc-ledger-cutover-REVIEW-ONLY.sql",
  ]) {
    await db.exec(await Bun.file(new URL(`../../docs/architecture/${name}`, import.meta.url)).text());
  }
}, 60_000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;");
  await db.query("insert into auth.users(id) values ($1),($2)", [A,B]);
  await db.query("insert into public.profiles(user_id,daily_goal) values($1,20),($2,20)", [A,B]);
  await db.query("insert into public.words(id,user_id,word,score) values($1,$2,'Alpha',0),($3,$4,'Beta',0)",
    [WA,A,WB,B]);
});
afterAll(async()=>await db.close());

describe("v5C-C POST-CUTOVER rehearsal: secured progress ledger",()=>{
  test("authenticated no longer owns direct insert to ledger/progress/milestone",async()=>{
    const r=await db.query<{
      a:boolean;b:boolean;c:boolean;d:boolean;e:boolean;
    }>(`select
      has_table_privilege('authenticated','public.learning_results','INSERT') as a,
      has_table_privilege('authenticated','public.daily_word_completions','INSERT') as b,
      has_table_privilege('authenticated','public.completed_goal_days','INSERT') as c,
      has_table_privilege('authenticated','public.learning_sessions','UPDATE') as d,
      has_function_privilege('authenticated','public.set_daily_goal(integer)','EXECUTE') as e`);
    expect(r.rows[0]).toEqual({a:false,b:false,c:false,d:false,e:false});
  });
  test("authenticated cannot manufacture a daily completion",async()=>{
    await asRole("authenticated",A,async()=>{
      await expect(db.query("insert into public.daily_word_completions(user_id,day,word_id) values($1,current_date,$2)",
        [A,WA])).rejects.toThrow();
    });
  });
  test("authenticated cannot manufacture a milestone",async()=>{
    await asRole("authenticated",A,async()=>{
      await expect(db.query("insert into public.completed_goal_days(user_id,day,goal) values($1,current_date,20)",
        [A])).rejects.toThrow();
    });
  });
  test("service writer updates only the owner passed by server",async()=>{
    await asRole("service_role", "", async()=>{
      const r=await db.query<{goal:number}>("select public.set_daily_goal_v6($1,10) as goal",[A]);
      expect(r.rows[0]?.goal).toBe(10);
    });
    expect((await db.query<{daily_goal:number}>("select daily_goal from public.profiles where user_id=$1",[A])).rows[0]?.daily_goal).toBe(10);
    expect((await db.query<{daily_goal:number}>("select daily_goal from public.profiles where user_id=$1",[B])).rows[0]?.daily_goal).toBe(20);
  });
  test("service writer records milestone only when actual daily rows meet threshold",async()=>{
    await asRole("service_role","",async()=>{
      const r1=await db.query("select public.set_daily_goal_v6($1,10)",[A]);
      expect(r1.rows).toHaveLength(1);
    });
    expect((await db.query("select * from public.completed_goal_days where user_id=$1",[A])).rows).toHaveLength(0);
    await db.query("insert into public.daily_word_completions(user_id,day,word_id) " +
      "select $1,(now() at time zone 'Europe/Istanbul')::date,gen_random_uuid() from generate_series(1,10)",[A]);
    await asRole("service_role","",async()=>{
      await db.query("select public.set_daily_goal_v6($1,10)",[A]);
    });
    expect((await db.query("select * from public.completed_goal_days where user_id=$1",[A])).rows).toHaveLength(1);
  });
  test("service-only writer is not accessible to user or anon",async()=>{
    const r=await db.query<{a:boolean;b:boolean;c:boolean}>(`select
      has_function_privilege('authenticated','public.set_daily_goal_v6(uuid,integer)','EXECUTE') as a,
      has_function_privilege('anon','public.set_daily_goal_v6(uuid,integer)','EXECUTE') as b,
      has_function_privilege('service_role','public.set_daily_goal_v6(uuid,integer)','EXECUTE') as c`);
    expect(r.rows[0]).toEqual({a:false,b:false,c:true});
    await asRole("authenticated",A,async()=>{
      await expect(db.query("select public.set_daily_goal_v6($1,10)",[A])).rejects.toThrow();
    });
  });
  test("manual word score editing stays permitted until groups are split",async()=>{
    await asRole("authenticated",A,async()=>{
      const r=await db.query<{score:number}>("update public.words set score=80 where id=$1 returning score",[WA]);
      expect(r.rows[0]?.score).toBe(80);
    });
  });
});
