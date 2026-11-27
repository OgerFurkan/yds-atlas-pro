# YDS Atlas Pro architecture

YDS Atlas Pro is a Bun workspace: a React/TypeScript frontend, a Bun HTTP backend,
shared contracts, and Supabase-backed account data.

## Module boundaries

```text
app/                  Application assembly and navigation
features/<name>/      Feature-owned components, hooks, model, api
shared/               Reusable UI, APIs, i18n and utilities
backend/src/          Authenticated routes, AI provider and server logic
tests/backend/        Security and server behavior regressions
tests/frontend/       Models, browser flows and mock account contracts
```

Dependency direction: `app -> features -> shared`. Shared modules must never import from
app or features. Frontend and backend share portable contracts through the package's
public exports. The [feature dependency policy](../../scripts/quality/architecture-policy.mjs)
lists published capability modules and their consumers. Keep other feature files private.
Use a new public entry only when the owning feature and the contract are clear.

## Domain rules

- Never trust client-provided user IDs or quotas. The server verifies auth and ownership.
- Never expose Gemini or Supabase secret keys in frontend source or `VITE_*` variables.
- Preserve data formats and session revisions when changing local/cloud persistence.
- Preserve bounded retries and honest error reporting for Gemini 429/503 responses.
- Keep daily-plan gameplay independent of UI widgets when possible.
- Keep translations in `shared/i18n/locales/{tr,en}`. Add both languages together.

## Cross-platform product standard (EK F)

PC, tablet and phone clients target both web and installed applications on Windows, macOS, Android and iOS/iPadOS. Each client uses the same backend, API, account data model and rules for learning, scoring and authorization. Keep portable domain transitions and TypeScript/Zod contracts in the existing shared package. The backend authenticates the owner, replays assessment actions and commits the authoritative result. A client may preview progress locally and must distinguish pending work from a confirmed score. [Shared game engine](../../packages/shared/src/game-engine.ts) · [Account contract](../../packages/shared/src/cloud-schema.ts) · [Server assessment replay](../../backend/src/features/learning/learning-service.ts)

| Existing boundary                                                                                                                                                       | Implication for an installed client                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The web game engine already re-exports the shared engine. The word repository accepts asynchronous implementations.                                                     | Reuse the same domain and API contracts. Keep rendering, navigation and OS integrations in the client. [Web game engine](../../frontend/src/features/learning-game/model/game-engine.ts) · [WordRepository](../../frontend/src/features/word-library/api/word-repository.ts)                                                                                                                                                                                                                                                       |
| The web storage journal reads and writes synchronous localStorage. Protected guest writes require Web Locks. Auth persistence selects browser session or local storage. | Provide platform adapters when implementing a client. Keep credentials in the OS-protected credential store and learning data scoped to its owner. Require equivalent atomic writes, stale-write detection and recovery. If storage or serialization guarantees are unavailable, preserve the draft and block the write. [Journal](../../frontend/src/shared/lib/storage.ts) · [Write lock](../../frontend/src/features/word-library/api/local-word-repository.ts) · [Auth storage](../../frontend/src/shared/lib/auth-storage.ts) |
| Account plan protocol 1 carries an owner-scoped revision, ordered day assignments, exclusions and group size.                                                           | Use the same API for installed clients. Preserve legacy device records during explicit reconciliation. Persist pending command IDs in a platform-appropriate store and retry after reconnect. [Account lifecycle and rollout](../ai/account-data-lifecycle.md)                                                                                                                                                                                                                                                                     |

On disconnection, identify the last verified data and any pending work. On reconnect, check owner, session validity and revision before retrying. A lost acknowledgement must allow the same operation to complete once. On conflict, retain both the local intent and the server result for explicit resolution. Account switching or session revocation must prevent a queued write from reaching the next account. Guest data stays device-local until an explicit transfer.

For independently updated clients, evolve APIs additively where possible. Before a breaking change, test the oldest supported client and its saved drafts against the new API. Introduce a versioned transition and a readable upgrade path that preserves local data and blocks incompatible writes.

The Atlas Design System shares semantic tokens for typography, color and spacing, and component contracts for state, focus, accessible name and action. The web theme is the existing starting point. Adapt layout, navigation, back behavior and input to the platform. Keep learning outcomes and recovery actions consistent across light/dark themes, orientation changes, touch, keyboard, mouse and screen readers. [Web theme](../../frontend/src/index.css) · [Platform acceptance matrix](quality.md#platform-acceptance-matrix-ek-f)

## Refactoring policy

Keep UI, state ownership, model logic and persistence within the domain that owns
them. Reuse existing behavior before adding components, helpers or dependencies.
Keep production source in its workspace, tests in `tests/`, Playwright configuration
in `frontend/config/playwright/`, and generated output in ignored `.artifacts/`.

The 350-line threshold requires a source-owned rationale and a recorded line baseline. The repository gate rejects unreviewed oversized functional modules and growth beyond a recorded baseline. Keep cohesive locale, schema or data exceptions explicit. The ownership check covers root entry points, the application workspaces, shared packages, tests and fixtures, config, scripts, docs and generated output. Literal lazy imports are resolved and reported separately from eager runtime edges. Computed imports are reported as unresolved. Type-only imports do not create runtime edges.

Backend `src/routes/` contains typed HTTP adapters. `createApp` owns CORS, public readiness, authentication, dispatch order and admission cleanup. Shared browser vocabulary presentation lives under `frontend/src/shared/vocabulary/`. `learning-game/task-storage` and `word-library/library-storage` expose the small browser storage contracts used across features. Remove retired runtime paths after retaining applicable protocol and migration tests.

Add behavior tests and update the canonical documentation for contract changes.
Before delivery, review changed files for unused code, duplicate behavior, import
boundaries and misplaced outputs. Verify dynamic and operational references before
deleting anything. Run [quality profiles](quality.md) proportionate to the change and use
the release profile for release candidates.

## Atlas Control Center ve ortak sözlük

Öğrenci uygulaması ile `#control-center` aynı Bun API ve PostgreSQL verisini kullanır. Yönetim rotası ayrı yüklenir. Sunucu her istekte doğrulanmış kullanıcının UUID'sini tek ürün sahibinin sunucudaki `ATLAS_CONTROL_OWNER_ID` değeriyle karşılaştırır. Ayrıca canlı GoTrue oturumu ve imzalı `aal2` gerekir. Kimlik ayarı yoksa yönetim kapalıdır. TOTP kaydı ve kurtarma kodlarının güvenli teslimi yayın sahibinin operasyonudur.

Manuel ve AI taslakları aynı editörde, aynı kaynak/lisans ve 2 kolay, 1 orta, 2 YDS doğrulamasından geçer. Onay sonrası tek işlem UUID'si ve beklenen revizyonla toplu yayın yapılır. DB işlemi içerik, aktörlü revizyon ve tekrar makbuzunu birlikte yazar. Karantina öğrenci okumasından çıkarır. Onaylı eski revizyona dönüş yeni bir revizyon üretir. Yönetimle ilgili sonraki alanlar aynı kimlik denetimli API altında genişletilir. Premium dashboard ve kapsamlı yönetim merkezi, AGENTS.md içindeki on adımlı temel altyapı programının sonrasına ertelenmiştir.

Inspector ve Smart Tooltip, `atlas_lexicon_entries` kaynağını kullanır. Sözcük yüzeyi, lemma, POS ve anlam ayrı tutulur. Örnek cümle başlık, sayaç, zorluk ve çeviriye sahiptir. Açık kelime kartı bunları değiştirmez. Kısa projeksiyon aynı cümlenin sözcüklerini topluca okur. Aktif değerlendirmede sunucu denetimi vardır. Eşleşme yoksa sözlük bunu gösterir, belirsiz eşleşmede seçenekleri listeler. Ses yalnız kullanıcının seçtiği aksanda başlatılır. Misafirde ve çevrimdışı cihazda ortak sözlük erişimi sınırlıdır. Öğrencinin elde ettiği kelime/sense revizyonu ve geçmiş sınav içeriği kullanıcıya ait bir anlık kayıttır.

Tarihsel `Tooltip` satırları ve kaynak revizyonları korunur. Eski worker ve backfill üretimi kaldırıldı. Editör kaynak UUID, revizyon, digest, lisans, atıf ve doğru anlamı doğruladığında ortak kayda bağlantı kurabilir. Birleştirme kararı verilemeyen satır bekler. Kuyruklar içerik kaynağı olarak okunmaz. Lisanslı kaydın atfını ve kökenini sonraki düzenlemede de koru.

Telefon web arayüzünde Atlas sohbeti sağ altta güvenli ekran kenarlarını gözeten 52 px balondur. Sohbet menüsünden gizlenebilir ve Ayarlar’dan geri getirilebilir. Cihaz tercihi yerel tutulur. Gizleme açık sohbetin metnini ve geçmişini silmez.

### Smart Tooltip okuma ve yerleşim sözleşmesi

Kartın başlığı cümlede seçilen biçimdir. POS ve anlam kanonik anlam kaydından gelir. Ses dosyası ve IPA yalnız kayıt seçilen biçimle eşleşiyorsa kullanılır. Çekimli biçimde Pronounce, kullanıcının seçtiği aksanla ekrandaki sözcüğü seslendirir. Uygun ses bulunamazsa hata görünür. Birden fazla olası anlam varsa seçim kesinleştirilmez.

Hesap istemcisi cümlenin kelimelerini tek toplu okuma ile alır. Aynı tarayıcıdaki yayın bildirimi, pencereye geri dönme ve görünür kart açıkken 60 saniyelik yeniden okuma sunucu projeksiyonunu yeniler. Yenileme hatası yeniden denemeye açılır. Ağ kesintisinde cihazlar arasında eşzamanlı görünürlük garantisi yoktur.

Eski misafir akışı cihazdaki kişisel kelimeleri anlam kaynağı olarak kullanabiliyordu. Mevcut misafir kartı giriş gereksinimini gösterir. İleride misafire okuma açılacaksa ürün sahibi önce herkese gösterilebilir içerik kapsamını onaylar. Aynı kanonik tablodan yalnız onaylı anlamların sınırlı projeksiyonu okunur. Yayından kaldırma, istek sınırı, lisans atfı ve değerlendirme içeriğinin kapsam dışında tutulması iki kimlikle sınanır. Öğrenci tabloları, yönetim RPC'leri ve ayrıcalıklı anahtarlar misafir istemcisinin erişimine açılmaz.

Sözcüğe bağlı kart görünür cümlenin üstünü veya altını, sabit başlığı ve güvenli ekran kenarlarını hesaba katar. Dar dokunmatik ekranda seçili satırın altında yer varsa kısa, kaydırılabilir alt panel kullanılabilir. Kart açıkken kapalı sohbet balonu geçici olarak görünmez. Normal okumada balon sağ alttaki eylemlere yer açar. Bu yerleşim kararları cihazdaki gizleme tercihini değiştirmez.
