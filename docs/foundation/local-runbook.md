# F1 LOCAL — Reproducible but NOT_RUN on user's Windows host

**Scope:** isolated feature checkout, Bun 1.3.5, Node >=20, Docker/WSL2, local Supabase PG17/Auth, synthetic data. No hosted databases, real user data, paid services, secret or env updates.

1. Run node scripts/local/preflight.mjs from the isolated checkout. Inspect Docker context and daemon, not merely the installed CLI; failed prerequisite => BLOCKED.
2. Run bun install --frozen-lockfile; consult bunx supabase --help, then bunx supabase start (LOCAL Docker only). Existing local PG data must be protected. LOCAL Auth email confirmations are disabled in supabase/config.toml to permit throwaway sessions; never push that config to cloud.
3. For a confirmed disposable LOCAL volume only, consult bunx supabase db --help and optionally bunx supabase db reset --local. It destroys only that LOCAL volume and must not be run against linked staging/prod projects. The seed.sql file exists; two users are NOT injected through auth.users SQL.
4. Obtain a local publishable/anon key from LOCAL CLI status. Export ONLY in shell LOCAL_SUPABASE_ANON_KEY (no service role and never in logs, repo or screenshots). Run node scripts/local/supabase-tenant-smoke.mjs. The script refuses non-loopback :54321, blocks external fetch redirects, creates two disposable example.test Auth sessions, checks SELECT/UPDATE/forged INSERT/anonymous RLS and cleans word rows. It leaves local-only test Auth accounts until a separately approved local reset.
5. Run bun run lint, bun run format:check, bun run build, bun test backend/tests frontend/tests/unit, node scripts/quality/foundation-contract.mjs, node --test scripts/release/staging-manifest.test.mjs, and node scripts/quality/repository-audit.mjs. Run existing Chromium e2e/fake cloud and optional multi-engine quality suite after local browser install. Do not treat simulated Gemini or PGlite as real-provider acceptance.
6. Docker contract: separately build/run backend/Dockerfile after confirming local daemon/disk. Check non-root bun/PORT/health and timeouts/cold starts; existing health databaseConfigured is presence-only, not real DB readiness. Vercel Vite build/hash routes are local contract, not Vercel runtime.
7. After recording results, stop only your disposable LOCAL stack using CLI help. Never prune or reset other user containers, volumes, git worktrees, or snapshots.

**Unresolved:** user's actual Windows/WSL2 and Docker engine NOT_VERIFIED, clean reset NOT_RUN, local real Auth/RLS NOT_RUN, Docker runtime NOT_RUN, actual Vercel/Render/Gemini provider integration NOT_RUN.
