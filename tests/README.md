# Test suites

Run these commands from the repository root. The source workspaces retain
production code and tool configuration. Test files live under `tests/`.
See the [file inventory](inventory.md) for names and coverage intent.

| Location                                           | Command                 | Boundary                                                          |
| -------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `backend/{auth,database,learning,api,ai,lexicon}/` | `bun run test:api`      | Bun API, synthetic providers and Postgres policies in PGlite      |
| `frontend/unit/`                                   | `bun run test:unit`     | Models, repositories, storage and account synchronization         |
| `frontend/e2e/`                                    | `bun run test:e2e`      | Desktop and mobile Chromium against a local build                 |
| `frontend/contracts/`                              | `bun run test:cloud`    | Desktop and mobile Chromium with intercepted Auth and API traffic |
| `frontend/dev/cold-start.spec.ts`                  | `bun run test:dev`      | Cold Vite startup and spellcheck                                  |
| `frontend/dev/local-fixture-library.spec.ts`       | `bun run test:fixtures` | Synthetic library data and score-free review                      |
| `**/*.node.test.mjs`                               | `bun run test:node`     | Native Node 24 VM, type stripping and source contracts            |

Run `bun run build:test` before E2E. The local browser builds ignore Vite credentials
from the environment. Append `--list` to a Playwright command to
check discovery without launching a browser. The browser configs stay in
`frontend/config/playwright/` to start Vite and resolve the installed Playwright
version. Backend legacy `.mjs` contracts run under Bun. Some inspect source
text or load isolated source with dependency stubs. Use executable API and
database tests for authorization and persistence guarantees.

`bun run test` runs both Bun groups with the same discovery as CI. The historical
Gemini regression uses the two immutable commits from the local Git history.
Use a full checkout for this suite. `bun run test:coverage` reports their
loaded TypeScript and JavaScript files. Browser paths, SQL policy execution
and production files never imported by these groups lie outside that
percentage. Compare coverage with the same test selection and Bun version.

Keep synthetic data in local test fixtures. The cloud-contract suite uses
HTTP mocks. The isolated Supabase integration test is opt-in and needs the
previously isolated loopback database plus dedicated synthetic Auth and writer
credentials. PGlite checks policies and SQL with no external connection.
Real staging acceptance and application rollback are described
in the [quality guide](../docs/architecture/quality.md).

## Tarayıcı profilleri ve çıktılar

| Profil           | Giriş                    | Yerel hedef                                     |
| ---------------- | ------------------------ | ----------------------------------------------- |
| Guest            | `bun run test:e2e`       | LOCAL misafir preview, masaüstü ve telefon      |
| Cloud            | `bun run test:cloud`     | Loopback HTTP mock, masaüstü, tablet ve telefon |
| Cold development | `bun run test:dev`       | Soğuk Vite ve sözlük başlangıcı                 |
| Fixtures         | `bun run test:fixtures`  | Sentetik kütüphane fixture’ı                    |
| Inspector        | `bun run test:inspector` | Cloud içinden yalnız Inspector                  |
| Demo             | `bun run test:demo`      | İsteğe bağlı etkileşimli masaüstü demosu        |

Her doğrudan Playwright koşusu `.artifacts/playwright/<profil>/<run-id>/results` dizinine yazar. Cold development ve fixture profillerinin Vite önbelleği aynı run dizininde ayrıdır. Merkezi kalite çalıştırıcısı `.artifacts/quality/` altındaki koşu dizinlerini `ATLAS_BROWSER_RESULTS_DIR` ve `VITE_TEST_CACHE_DIR` ile sağlar. Düz coverage çıktısı `.artifacts/coverage` dizinindedir. HTML rapor gerekirse `PLAYWRIGHT_HTML_OUTPUT_DIR` ile aynı çalışma alanına yönlendirilir.

Önizleme build’leri mevcut `frontend/node_modules` altındaki yolları, hosted build `frontend/dist` yolunu kullanır. Geçici veritabanları ve kalite logları işlem bazlı dizinlerde kalır. Kapanmış koşuların ihtiyaç duyulan kanıtlarını merkezi arşive aldıktan sonra yalnız sahipliği bilinen eski run dizinini temizleyin. Aktif koşular, doğrulanmış kanıtlar ve Recovery paketleri bu temizliğin dışındadır.
