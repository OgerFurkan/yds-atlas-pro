---
name: Atlas Pro - Backend Standards
alwaysApply: false
globs: ["backend/**", "**/supabase/functions/**"]
description: Apply to API, backend, Edge Functions and data changes.
---

- Determine the actual backend runtime, framework and data stores from the repository before proposing code.
- Validate user input, guard authorization boundaries, use safe error responses and avoid leaking stack traces or secrets.
- Design explicit request/response contracts, timeouts, retries, rate limits and idempotency for AI or external API calls.
- Distinguish external API failure from malformed data; preserve user work on transient errors.
- No schema migrations, privilege changes, data deletion or deployment without explicit human approval.
- Include a local verification procedure and relevant failure cases for every changed endpoint.
