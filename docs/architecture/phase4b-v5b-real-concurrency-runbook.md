# Phase 4B v5B — real PostgreSQL race acceptance (local candidate)

**Scope**: Run only with Docker Desktop. Does not modify staging, production, source schema, Git, or existing containers. No V5B SQL migration is created or applied.

## Why

PGlite uses a single database engine; it validated logic and rollback, but it cannot establish that independent PostgreSQL backends actually wait for each other's row locks. This script uses two separate `Bun.SQL` connection pools (one connection each) against an ephemeral PostgreSQL 16 Docker container.

## Safety boundaries

- `phase4b-v5b-run-local.ps1` requires exact Git HEAD `740d5228bffd29b5c32bedda7479e3cdf244ac38`, a clean worktree except the three new v5B files, and a functioning Docker engine.
- It starts a **randomly named** `postgres:16-alpine` container, with **no host mounts**, and publishes an automatically allocated port on **127.0.0.1 only**.
- A random password is generated only for this process. It never reads staging credentials, `.env`, `DATABASE_URL`, or `SUPABASE_URL`.
- It creates only a fresh `atlas_v5b_isolated` database in the new container and loads existing migration history plus the REVIEW-ONLY v3/v4/v5A SQL into this isolated disposable database.
- It requires two *distinct* PostgreSQL backend PIDs to be observed waiting for a real lock before releasing a blocker transaction. A sequential or inconclusive run fails.
- It asserts same-session v3 RPC replay applies **one** result, SRS update, score and daily word count; and a v5 save CAS race yields **one** revision-2 winner and **one** rejected stale update.
- In `finally`, the runner stops **only its own temporary container** and restores temporary environment variables.
- This is a *local verification aid*, not a production or staging certification. It does not prove application-level HTTP behavior, network retry semantics, or all race interleavings.

## Usage

From Windows PowerShell in the verified Smart Plan branch:

```powershell
& "C:\Users\furka\OneDrive\Desktop\YDS Atlas Pro - Smart Plan\scripts\quality\phase4b-v5b-run-local.ps1"
```

If Docker Desktop is absent or not running, the runner stops before modifying anything. Do **not** repoint it at a remote database; it rejects nonlocal connection hosts. Don't change `REVIEW_WRITE_V3_ENABLED` and do not apply SQL to Supabase.

Expected output includes both `PASS: Both independent PostgreSQL backends are blocked on a real row lock.` messages, both race results, and a final acceptance PASS. If it fails, preserve the output and do not commit the v5B candidate.
