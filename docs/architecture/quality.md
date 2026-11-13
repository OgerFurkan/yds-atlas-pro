# Quality and validation

From repository root:

```powershell
bun run build
bun test backend/tests frontend/tests/unit
bun run --cwd=frontend test:e2e
node scripts/quality/repository-audit.mjs
```

GitHub Actions will run these checks on pull requests and on main.

The audit lists large source files, feature imports inside shared code,
tracked backup artifacts and tracked sensitive `.env` files.

## Gemini capacity

Gemini quotas are applied per Google Cloud project, not per API key. New keys
in the same project do not raise project limits. Keep all keys in backend-only
secrets and observe per-project RPM, TPM and daily quotas before increasing traffic.
