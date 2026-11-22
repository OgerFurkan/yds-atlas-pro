#!/usr/bin/env node
// Nonsecret staging-only provenance. Does not deploy, access DB or expose credentials.
const e=process.env;
const sha=x=>/^[a-f0-9]{40}$/.test(x??"");
const hash=x=>/^[a-f0-9]{64}$/.test(x??"");
if(e.ATLAS_RELEASE_ENV!=="STAGING" ||
 e.STAGING_SUPABASE_PROJECT_ID!=="mxsjocfbsquveeuogspe" ||
 e.STAGING_VERCEL_PROJECT_ID!=="prj_OcTSD4BAGSCKo6EVuAvicphykfSr" ||
 e.STAGING_RENDER_SERVICE_ID!=="srv-dbs3l6gae00c73diut30" ||
 !sha(e.STAGING_FRONTEND_SHA) || !sha(e.STAGING_BACKEND_SHA) ||
 e.STAGING_FRONTEND_SHA!==e.STAGING_BACKEND_SHA ||
 !hash(e.STAGING_DB_MIGRATIONS_SHA256) ||
 !/^dpl_[A-Za-z0-9]+$/.test(e.STAGING_FRONTEND_DEPLOY_ID??"") ||
 !/^dep-[a-z0-9]+$/.test(e.STAGING_BACKEND_DEPLOY_ID??"")) {
 console.error("BLOCKED: staging candidate not aligned/frozen, or provenance missing");
 process.exit(2);
}
console.log(JSON.stringify({
 status:"STAGING_METADATA_VALIDATED_NOT_RUNTIME_VERIFIED",
 frontend:{project:e.STAGING_VERCEL_PROJECT_ID,sha:e.STAGING_FRONTEND_SHA,deploy:e.STAGING_FRONTEND_DEPLOY_ID},
 backend:{service:e.STAGING_RENDER_SERVICE_ID,sha:e.STAGING_BACKEND_SHA,deploy:e.STAGING_BACKEND_DEPLOY_ID},
 database:{project:e.STAGING_SUPABASE_PROJECT_ID,migrationsHash:e.STAGING_DB_MIGRATIONS_SHA256}
},null,2));
