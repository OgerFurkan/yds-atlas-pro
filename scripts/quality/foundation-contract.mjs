#!/usr/bin/env node
// Offline repository contract only; never call this provider/runtime PASS.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const checks=[
 ["local PG17",()=>/^\s*major_version\s*=\s*17\s*$/m.test(read("supabase/config.toml"))],
 ["local seed exists",()=>fs.existsSync(path.join(root,"supabase/seed.sql"))],
 ["throwaway local email confirmations",()=>/^\s*enable_confirmations\s*=\s*false\s*$/m.test(read("supabase/config.toml"))],
 ["Docker non-root",()=>/^USER bun$/m.test(read("backend/Dockerfile"))],
 ["Docker Bun pinned",()=>/FROM oven\/bun:1\.3\.5/.test(read("backend/Dockerfile"))],
 ["no CI production deploy",()=>!/vercel deploy --prod|render deploy|supabase db push/i.test(read(".github/workflows/saas-quality.yml"))],
 ["hardcoded loopback for tenant smoke",()=>/127\.0\.0\.1:54321/.test(read("scripts/local/supabase-tenant-smoke.mjs"))],
 ["staging schema fingerprint required",()=>/STAGING_DB_MIGRATIONS_SHA256/.test(read("scripts/release/staging-manifest.mjs"))],
 ["three browser engines",()=>["Desktop Chrome","Desktop Firefox","iPhone 13"].every(x=>read("frontend/playwright.qa.config.ts").includes(x))],
];
const results=checks.map(([name,fn])=>{let ok=false;try{ok=fn()}catch{} return{name,status:ok?"PASS":"FAIL"}});
console.log(JSON.stringify({kind:"OFFLINE_SOURCE_CONTRACT_ONLY",results},null,2));
if(results.some(x=>x.status==="FAIL"))process.exitCode=1;
