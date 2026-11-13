# YDS Atlas Pro architecture

YDS Atlas Pro is a Bun workspace: a React/TypeScript frontend, a Bun HTTP backend,
shared contracts, and Supabase-backed account data.

## Module boundaries

```text
app/                  Application assembly and navigation
features/<name>/      Feature-owned components, hooks, model, api
shared/               Reusable UI, APIs, i18n and utilities
backend/src/          Authenticated routes, AI provider and server logic
backend/tests/        Security and business rule regression tests
```

Dependency direction: `app -> features -> shared`. Shared modules must never import from
app or features. Feature-to-feature imports should be reviewed and minimized.

## Domain rules

- Never trust client-provided user IDs or quotas. The server verifies auth and ownership.
- Never expose Gemini or Supabase secret keys in frontend source or `VITE_*` variables.
- Preserve data formats and session revisions when changing local/cloud persistence.
- Preserve bounded retries and honest error reporting for Gemini 429/503 responses.
- Keep daily-plan gameplay independent of UI widgets when possible.
- Keep translations in `shared/i18n/locales/{tr,en}`. Add both languages together.

## Refactoring policy

Avoid wholesale rewrites. Add coverage, move a single cohesive domain, run the full
regression suite, and review the diff before merging. Delete code only after verifying
that no runtime, test, import, or deployment configuration uses it.
