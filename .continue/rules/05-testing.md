---
name: Atlas Pro - Testing Standards
alwaysApply: false
globs: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"]
description: Apply when writing or reviewing automated tests.
---

- Inspect configured test frameworks and package scripts. Do not assume Vitest, Playwright or Bun are installed.
- Cover happy path, empty state, error handling, keyboard navigation, repeated actions, responsive behavior and persistence when relevant.
- Keep tests deterministic: isolate network/AI calls, avoid flaky sleeps and clean up test data.
- Report which tests actually ran, which could not run and what remains a manual validation item.
