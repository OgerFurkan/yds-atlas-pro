# Mimari ve dosya haritası

## Çalışma alanları

- `frontend/`: React, TypeScript, Vite, Tailwind CSS v4.
- `packages/shared/`: Kelime, oyun/oturum ve AI için ortak Zod şemaları; saf değerlendirme hesabı ve puan grupları.
- `backend/`: Bun HTTP API, doğrulanmış Supabase Auth bağlamı, RLS altında veri erişimi ve güvenli Gemini çağrıları. Mevcut SQLite veritabanı açılmaz/değiştirilmez.
- `supabase/`: CLI 3 yapılandırması ve PostgreSQL/RLS/RPC migration'ı.

## Frontend

```text
src/
  main.tsx                         React girişi
  index.css                        Tema, fontlar ve temel stiller
  app/
    App.tsx                        Ekran kompozisyonu ve feature bağlantıları
    components/
      app-header.tsx               Masaüstü/mobil gezinme, Öğren menüsü
      app-footer.tsx
    hooks/
      use-hash-screen.ts           URL hash'i ile ekran eşitleme
      use-notify.ts                React-Toastify üzerinden tipli bildirim portu
  features/
    dashboard/
      components/                  Ana sayfa, hedef penceresi ve günlük seri
      model/
        daily-progress.ts          Günlük hedef sabitleri ve çalışma kaydı
        date.ts                    İstanbul saat diliminde tek tarih kaynağı
        streak.ts                  Günlük seri ve hafta görünümü
    word-library/
      api/
        word-repository.ts         Repository portu (yerel veya HTTP adaptörü)
        local-word-repository.ts   Misafir için localStorage adaptörü
        spellcheck.ts              Worker'a yazım denetimi istekleri
        word-api.ts                Hesaplar için Bun HTTP adaptörü
      components/                  Form, içe aktarma incelemesi, liste/kartlar
      data/starter-vocabulary.ts   20 kelime ve çevirili 100 editoryal örnek
      hooks/
        use-word-library.ts        Repository ile ekranlar arasındaki bağlantı
        use-word-library-view.ts   Arama, filtre ve sıralama durumu
        use-word-selection.ts      Seçim durumu
        use-word-spellcheck.ts     Yazım denetimi ve öneri akışı
      model/                       Form, görünüm, yazım tipi ve normalizasyon
      workers/                     Arayüzü durdurmadan Hunspell denetimi
    learning-game/
      components/                  Kurulum, ilerleme, kart/soru, sonuç görünümleri
      hooks/use-setup-guide.ts     Hazırlık rehberi adımları
      model/
        game-session.ts            Sürümlü oturum şeması ve tipleri
        game-engine.ts             Soru, sıra, tekrar, aşama ve puan fonksiyonları
        game-setup.ts              Aday, hedef ve grup hesapları
        game-progress.ts           İlerleme yüzdesi
        game-storage.ts            Oturum doğrulama ve kalıcılık
        setup-guide.ts             Hazırlık rehberi metinleri
        play-guide.ts              Oyun rehberi metinleri
  shared/
    brand/atlas-logo.tsx           Maskotla uyumlu kitap/pusula amblemi
    hooks/use-prefers-reduced-motion.ts
    ui/                            shadcn/Radix kontrolleri ve Driver.js rehber adaptörü
    lib/                           cn, depolama, depolama anahtarları, regex ve bildirim tipleri
    api/                           Supabase Auth istemcisi ve Bearer HTTP istemcisi
tests/
  unit/                            Oyun, görünüm ve normalizasyon testleri
  e2e/                             Playwright ile masaüstü/mobil kullanıcı akışları
```

Yeni özellikleri `features/<özellik>/` altında aç. İş kurallarını JSX dosyalarına taşıma. Birden fazla özelliğin kullandığı görsel kontroller `shared/ui/`, uygulamaya özgü gezinme `app/` içinde kalır. Veri erişimi repository/provider sınırındadır; JSX içinde doğrudan HTTP isteği yapılmaz.

## Araçlar

shadcn bileşenleri resmi CLI'dan alınmış ve marka temasıyla uyarlanmıştır. Konfigürasyon `frontend/components.json` dosyasında, alias `@/shared/ui` olarak tanımlıdır. Tailwind Vite eklentisi `frontend/vite.config.ts` içindedir.

Biome biçimlendirir; Oxlint React/TypeScript kontrollerini yapar. Playwright üretim derlemesini `4173` portunda açar; backend gerektirmez. Sözlük dosyaları kendi lisanslarıyla `frontend/public/dictionaries/` içinde dağıtılır.



## Hesap, API ve AI

- `features/auth/`: Ayrı `/#login` sayfası; `auth-form` görünümü ve `use-auth-form` işlem hook'u, hesap penceresi ve Supabase oturum yaşam döngüsü. Giriş sayfası bulut bootstrap'ından önce gösterilir; şifre yenileme API erişimine bağımlı değildir.
- `features/account/`: Hesap bootstrap'ı, kullanıcıya göre önbellek, bulut veri portları ve revision sırası.
- `features/word-library/api/ai-word-api.ts`: Gemini önerisi için HTTP adaptörü.
- `features/word-library/components/ai-word-assist.tsx`: Kaydetmeden önce öneri inceleme.
- `backend/src/app.ts`: HTTP yönlendirmesi, doğrulama, Origin ve güvenli hata sınırı.
- `backend/src/features/words/`: RLS altında kelime işlemleri.
- `backend/src/features/learning/`: Oturum, hesap/ilerleme ve sunucuda sonuç hesabı.
- `backend/src/features/ai/`: Gemini sağlayıcısı; anahtar, JSON Schema, zaman aşımı ve içerik kontrolü.
- `backend/src/shared/`: Auth bağlamı, boyut sınırlı JSON okuma ve hata eşleme.
- `backend/tests/`: Auth/API/Gemini sözleşmeleri ve PGlite üzerinde gerçek PostgreSQL/RLS testleri.
- `frontend/tests/cloud/`: Yapılandırılmış hesap akışları için masaüstü/mobil HTTP mock testleri.

Frontend Supabase'i yalnızca Auth için kullanır. Veri istekleri kullanıcı JWT'siyle Bun API'ye gider; normal Supabase veri istemcisi RLS'yi atlamaz. Server secret key ayrı istemcide yalnızca AI kotası içindir. Sonuç SQL işlemi idempotenttir. Kurulum, tablolar ve doğrulama sınırları: [backend.md](backend.md).



Deploy kaynakları: repo kökünde vercel.json ve render.yaml; Bun API için backend/Dockerfile ve .dockerignore. Ücretsiz deneme sırası ve gereken erişimler [deployment.md](deployment.md) içinde.

