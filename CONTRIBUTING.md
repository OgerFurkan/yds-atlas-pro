# Contributing to YDS Atlas Pro

## Quick start

Run from the workspace root:

```powershell
bun install
bun run build
bun test backend/tests frontend/tests/unit
bun run --cwd=frontend test:e2e
node scripts/quality/repository-audit.mjs
```

## Where does new code belong?

- `frontend/src/app/`: root composition, routing and global navigation.
- `frontend/src/features/<feature>/components/`: feature UI.
- `frontend/src/features/<feature>/hooks/`: orchestration and React hooks.
- `frontend/src/features/<feature>/model/`: pure business logic and state transitions.
- `frontend/src/features/<feature>/api/`: HTTP, cloud, and persistence adapters.
- `frontend/src/shared/`: code with no dependency on a particular feature.
- `frontend/src/shared/i18n/locales/{tr,en}/`: both languages, grouped by domain.
- `backend/src/`: validated server-side features, quotas and ownership.
- `frontend/tests/` and `backend/tests/`: regression tests.

## Review checklist

1. Functional behavior and account ownership stay unchanged.
2. Build, unit tests and desktop/mobile browser tests pass.
3. Secret keys stay in server environment variables, never in Vite or Git.
4. User-visible copy exists in both locales.
5. A structural change is scoped to one cohesive feature or shared concern.
6. Do not commit local `.bak`, patch, ZIP, or generated test artifacts.

See `docs/architecture/overview.md` and `docs/adr/0001-feature-boundaries.md`.
