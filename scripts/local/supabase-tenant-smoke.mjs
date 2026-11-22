#!/usr/bin/env node
// Real LOCAL Auth/JWT + PostgREST RLS. Remote and secret-key targets fail closed.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
const target = new URL(process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321");
if (!["http://127.0.0.1:54321","http://localhost:54321"].includes(target.origin) ||
    target.pathname !== "/" || target.search || target.hash || target.username || target.password)
  throw new Error("BLOCKED: only LOCAL Supabase loopback:54321 is permitted");
const anon = process.env.LOCAL_SUPABASE_ANON_KEY;
if (!anon || anon.startsWith("sb_secret_"))
  throw new Error("BLOCKED: provide LOCAL publishable/anon key, never service role");
const guardFetch = (input, init = {}) => {
  const to = new URL(typeof input === "string" ? input : input.url);
  if (to.origin !== target.origin) throw new Error("BLOCKED: external egress refused");
  return fetch(input, {...init, redirect:"error", signal:AbortSignal.timeout(12000)});
};
const client = () => createClient(target.origin, anon, {
  global:{fetch:guardFetch}, auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
});
const run = randomBytes(8).toString("hex");
const password = "Atlas-Local-Only-" + randomBytes(18).toString("hex") + "!";
async function signup(label) {
  const db = client();
  const {data,error} = await db.auth.signUp({email:"atlas-f1-" + label + "-" + run + "@example.test",password});
  if (error || !data.session?.access_token || !data.user?.id)
    throw new Error("BLOCKED: local signup/session failed; check LOCAL-only email confirmation config");
  return {db,id:data.user.id};
}
function check(label,ok) {
  if (!ok) throw new Error("FAIL: " + label);
  console.log("PASS: " + label);
}
let a,b,aid,bid;
try {
  a=await signup("alpha"); b=await signup("beta");
  check("two distinct GoTrue identities",a.id !== b.id);
  const x=await a.db.from("words").insert({user_id:a.id,word:"AtlasAlpha"+run,score:12,content:{fixture:"LOCAL_SYNTHETIC_F1"}}).select("id").single();
  if (x.error || !x.data?.id) throw new Error("FAIL: owner A write");
  aid=x.data.id;
  const y=await b.db.from("words").insert({user_id:b.id,word:"AtlasBeta"+run,score:34,content:{fixture:"LOCAL_SYNTHETIC_F1"}}).select("id").single();
  if (y.error || !y.data?.id) throw new Error("FAIL: owner B write");
  bid=y.data.id;
  const cross=await b.db.from("words").select("id").eq("id",aid);
  check("cross-tenant SELECT hidden",!cross.error && cross.data?.length===0);
  const update=await b.db.from("words").update({score:99}).eq("id",aid).select("id");
  check("cross-tenant UPDATE blocked",!update.error && update.data?.length===0);
  const spoof=await b.db.from("words").insert({user_id:a.id,word:"Spoof"+run,content:{fixture:"LOCAL_SYNTHETIC_F1"}});
  check("forged owner INSERT rejected",!!spoof.error);
  const own=await a.db.from("words").select("score").eq("id",aid).single();
  check("owner A data remains intact",!own.error && own.data?.score===12);
  const anonymous=await client().from("words").select("id").eq("id",aid);
  check("anonymous read rejected or empty",!!anonymous.error || anonymous.data?.length===0);
  console.log("LOCAL_PROVIDER_AUTH_RLS_PASS: two ephemeral users, local GoTrue, JWT, PostgREST");
} catch(error) {
  console.error(error instanceof Error ? error.message : "FAIL: LOCAL RLS");
  process.exitCode=1;
} finally {
  if(aid && a) await a.db.from("words").delete().eq("id",aid);
  if(bid && b) await b.db.from("words").delete().eq("id",bid);
  // Disposable Auth accounts remain local until separately authorized local reset.
}
