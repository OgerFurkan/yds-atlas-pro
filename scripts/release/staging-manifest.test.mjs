import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const script=fileURLToPath(new URL("./staging-manifest.mjs",import.meta.url));
const base={
 ATLAS_RELEASE_ENV:"STAGING",
 STAGING_SUPABASE_PROJECT_ID:"mxsjocfbsquveeuogspe",
 STAGING_VERCEL_PROJECT_ID:"prj_OcTSD4BAGSCKo6EVuAvicphykfSr",
 STAGING_RENDER_SERVICE_ID:"srv-dbs3l6gae00c73diut30",
 STAGING_FRONTEND_SHA:"a".repeat(40),
 STAGING_BACKEND_SHA:"a".repeat(40),
 STAGING_DB_MIGRATIONS_SHA256:"b".repeat(64),
 STAGING_FRONTEND_DEPLOY_ID:"dpl_TEST123",
 STAGING_BACKEND_DEPLOY_ID:"dep-test123",
};
function run(values={}){
 return spawnSync(process.execPath,[script],{
  env:{PATH:process.env.PATH,...values},encoding:"utf8",timeout:5000,
 });
}
test("manifest fails closed without any staging metadata",()=>{
 assert.equal(run().status,2);
});
test("manifest rejects production database/project",()=>{
 assert.equal(run({...base,STAGING_SUPABASE_PROJECT_ID:"desanpeigzzuimmtxesx"}).status,2);
});
test("manifest refuses cross-SHA staging drift",()=>{
 assert.equal(run({...base,STAGING_BACKEND_SHA:"c".repeat(40)}).status,2);
});
test("complete matching synthetic metadata is labelled not runtime verified",()=>{
 const r=run(base);
 assert.equal(r.status,0);
 const value=JSON.parse(r.stdout);
 assert.equal(value.status,"STAGING_METADATA_VALIDATED_NOT_RUNTIME_VERIFIED");
});
