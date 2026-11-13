# ADR 0001 — Feature-first architecture

Status: Adopted

## Decision

Keep the current feature-first layout. Split oversized translation resources into
language/domain modules, preserve typed composition, add CI and an audit, and keep
existing API/data boundaries. Future refactors should move pure logic out of views
incrementally, not create abstract layers without a concrete responsibility.

## Rationale

Full app rewrites can invalidate user progress, cloud sync, AI quotas and learning flows.
Small behavior-preserving changes are easier to review and safely deploy.

## Consequences

A new developer can locate business rules (`model`), persistence (`api`), orchestration
(`hooks`) and rendering (`components`) without guessing. Architecture checks are
introduced as diagnostics before expanding to strict dependency policies.
