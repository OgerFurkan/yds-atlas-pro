# Staging-applied migration ledger — review-only Git snapshot

This folder contains a byte-for-byte copy of a migration **already applied** to the **separate** Supabase staging project `mxsjocfbsquveeuogspe` on 2026-11-15. This is not a new migration request and not a production release.

- Database migration version: `20261115180300`
- Migration name: `atlas_privileged_writers_v3_v5_v6_staging_additive`
- File: `20261115180300_atlas_privileged_writers_v3_v5_v6_staging_additive.sql`
- Original recorded UTF-8 content: **19,229 bytes**
- SHA-256: `8da8e6deef451dd8ca3b14e871626d5fa4ef7df95b1442302d99514584f011d3`
- Database-recorded MD5: `d18778e21a275b9113b40e95b05445fb`
- Three original function source Git blobs: v3 `fa41affe209e5469c280cafd5808c217f6679e7d`, v5 `7d3f592ac7e462afa07f51f6e418c21d91d79a15`, v6 `d154a53605a7c01e2c2238927cd5348e7dfe7234`.

## Why not in `supabase/migrations` yet?

This is a **non-executing ledger snapshot** because the existing isolated PGlite baseline tests load every SQL file in `supabase/migrations` and simulate a separate role/permission environment. Adding this staging-specific guarded migration there without updating those test fixtures would break the quality gate. The staging SQL also rejects pre-existing functions to prevent accidental replay; it is not designed to be run twice.

**P0 still open:** synchronize the active migration history into `supabase/migrations` with an explicit, reviewed fixture/test adaptation and CI proof, and avoid any automatic production migration/deploy. This ledger is not a substitute for that work.

## What is already proven

The real staging database migration registry returned the same byte count, SHA-256 and MD5 as this file. The installed v3/v5/v6 functions are `SECURITY INVOKER`, `service_role`-only, and leave the old client-write privileges intact. Real PostgreSQL 17 cutover was rehearsed locally in disposable Docker. No real-account end-to-end acceptance or breaking privilege cutover has been performed.

## Security scope

No credentials, no inserts/updates/deletes to user tables, no production/main change, no merge, no migration invocation, no deployment flags. Only the documentation snapshot, this README, an offline checksum verifier, and an isolated CI step are part of the review PR.
