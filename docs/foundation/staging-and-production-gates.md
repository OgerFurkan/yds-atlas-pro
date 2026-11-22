# F2–F3 staging, release and G2/G3 combined risk plan

## Read-only baseline / hard STOP
- main 567f57a9a893991ba67a46b72443114347a1aee8; GitHub branch metadata shows protected=false and rulesets empty. Never merge to main before an independently verified gate and explicit production approval.
- Production Vercel id prj_ajhYxGMBqPILxdCbPLjQyKClatl9, active READY dpl_5UfGT5VRygdD8QEZgVZ8aG8hYkqe at main SHA. Staging Vercel id prj_OcTSD4BAGSCKo6EVuAvicphykfSr, READY dpl_GFsjHPR7qeFDC8a8ChCLwPC4ENzD at 567f57a9, deployment target null.
- Render production id srv-dbq3eejrjlhs73b4gnc0, branch main, autoDeploy=yes; staging id srv-dbs3l6gae00c73diut30, autoDeploy=no and last known backend SHA 47a55fe4a0ab3c9207acd744a59a5b8806efa2f7, old staging branch. Frontend and backend do not match: STAGING_RELEASE_BLOCKED.
- Supabase staging project mxsjocfbsquveeuogspe; production desanpeigzzuimmtxesx. Although separate projects exist, **Render API backend credential/DB provenance cannot be verified from public frontend JS or service metadata**. Thus no signed-in staging write, no synthetic users, no staging redeploy before secure provenance and user-confirmed Render workspace.
- Render workspace discovery is read-only; the connector explicitly requires user's selection for service operations. Never infer or choose a workspace, never use trigger_deploy to redeploy an old configured branch and claim SHA alignment. All DB schema/migration/secret changes forbidden.
- Vercel team is Hobby; existing project may auto-build on feature-branch pushes. No extra project and no paid upgrade. Check free quotas and domain/origin/CORS before any optional controlled staging deploy.

## Candidate manifest and freeze
The read-only node scripts/release/staging-manifest.mjs validates strict nonsecret staging Vercel/Render/Supabase IDs, exact equal frontend/backend 40-character commit SHA, full deploy IDs and 64-character DB migration fingerprint. It does NOT query live services. Must compare with live provider sources and stage the same *tested* candidate; new SHA invalidates old acceptance. Releasing mismatched frontend/backend or an unverified API-to-DB path is STOP, not a PASS.

## G1 GitHub branch protection (authorized conditionally)
Required-check names must be stable at the exact PR HEAD and real CI success. GitHub ruleset/protection pre-image snapshot and verified rollback must precede changes. This connector has read access but no branch-protection/ruleset write operation; admin-style endpoint may 403. **G1 BLOCKED / NOT_CHANGED** until actual supported free enforcement and rollback can be proven; no weak placeholder protection. Test failure should demonstrably block synthetic PR merge without merging. A green job alone does not enforce main.

## Combined G2+G3 production security authorization — ANALYSIS ONLY
**G2 Render PROD:** Current main autoDeploy=yes means a main update may start an unapproved production backend deploy. No API writer is currently exposed by the connected Render tool; dashboard service settings or documented REST service PATCH with explicitly scoped token and confirmed workspace would require separate PO authorization and tool capability. Before a later change: record service ID, branch, autoDeploy setting, actual active deploy ID/SHA, config and supported Free-plan method; examine whether editing settings itself triggers deploy, then turn off autoDeploy only with explicit PO GO and read back, observe no deployment. Rollback is to restore recorded value, **but turning autoDeploy back on may deploy the latest unapproved main SHA**; verify release freeze first. Do not perform G2 here.

**G3 Vercel PROD:** Git-linked production project may create auto production deployments and PR previews. The available Vercel project-update API can change selected settings but **must not be invoked in this authorization**. For later PO review, snapshot project ID/team/production branch/active deployment, preview policy, Git ignored-build hooks, aliases, target, Hobby quota and exact supported API/dashboard field. Assess whether setting a Git/deployment-ignore rule can cause new builds, change protection or exceed quota; avoid environment/domain/alias/active deployment changes. Rollback is restoring the exact recorded trigger setting after verifying it will not unexpectedly publish another SHA; never use promote/rollback as a substitute for a settings revert without a separate release decision. No G3 writing here.

**One future decision:** PM reviews G2 and G3 together and requests one separate operation-specific PO approval with exact endpoints/fields, before/after evidence, 0 TL and rollback. Production merge/deploy remains BLOCKED with or without G1. Main push/merge, real DB writes, production service settings and secrets remain untouched.

## Independent acceptance classification
- PR CI build/unit/fake-cloud = CODE_CONTRACT only. Local Docker/GoTrue and real staging Auth/RLS/browser/device/axe/visual/timeout/performance/rollback must be measured, not inferred.
- Existing staging misalignment and backend DB provenance mean signed-in UAT and candidate freeze are BLOCKED. No env changes to bypass the problem.
- Visual golden baseline is explicitly skipped until reviewed baseline; axe lacks locked dependency/baseline; neither receives a false PASS.
- F1–F3 Builder technical completion is a report for PM second review; not PM_ACCEPTED, not PRODUCTION_GO.
