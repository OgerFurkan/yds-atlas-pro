# YDS Atlas Pro

YDS ve YÖKDİL kelime çalışması için React web uygulaması ve Bun API. Misafir çalışması tarayıcıda, oturumlu kullanıcı verisi Supabase’de tutulur. Puanlı değerlendirmeyi sunucu tamamlar.

| Alan                            | Sorumluluk                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `frontend/`                     | Vite web uygulaması. Giriş `src/main.tsx`, uygulama kabuğu `src/app/App.tsx`. |
| `backend/`                      | Bun API. Sunucu girişi `src/index.ts`, HTTP bileşimi `src/app.ts`.            |
| `packages/shared/`              | Uygulamalardan bağımsız şema, sözleşme ve saf öğrenme motoru.                 |
| `tests/`                        | Uygulama ve çalıştırıcıya göre testler, sentetik veriler ve yardımcılar.      |
| `scripts/quality/`, `supabase/` | Kalite profilleri, Recovery ve sabit migration geçmişi.                       |

## LOCAL başlangıç

[.node-version](.node-version) ve [package.json](package.json) içindeki Node ve Bun sürümlerini kullanın.

```sh
bun install --frozen-lockfile
bun run dev
```

Misafir deneyimi `http://localhost:5173` adresinde çalışır. Hesap akışı için `bun run dev:api` ve ayrı LOCAL Supabase yapılandırması gerekir. [Katkı kılavuzu](CONTRIBUTING.md) · [Backend kurulumu](docs/backend.md)

```sh
bun run quality:quick
bun run quality:local --synthetic-schema
bun run quality:release --synthetic-schema --online-advisories
```

Release profili mevcut LOCAL Chromium ve izole sentetik PostgreSQL/Auth/PostgREST ile Windows Recovery kapılarını çalıştırır. [Test profilleri](tests/README.md) · [Kalite kapıları](docs/architecture/quality.md)

LOCAL, PRE ve PROD kimlikleri ayrıdır. Yayın ve Recovery ayrı yetkilendirme ile yürütülür. [Mimari](docs/architecture/overview.md) · [Yayın](docs/deployment.md) · [Recovery](docs/architecture/recovery-operations.md) · [Çalışma kuralları](AGENTS.md)
