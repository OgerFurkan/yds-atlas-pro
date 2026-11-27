# Bun workspace ve Playwright profil sınırları

Durum kabul edildi.

## Karar

`frontend/` ve `backend/` Bun workspace kökleri olarak kalır. `frontend/dist` Vercel çıktı sözleşmesi ve `frontend` GitHub Actions çalışma dizinidir. Render kökten `backend/Dockerfile` kullanır. Dockerfile workspace manifestlerini sabit yollarla kopyalar; TypeScript, Vite, Vercel ve gerçek servis koşusu aynı kökleri kullanır. `apps/web` ve `apps/api` adları bu sözleşmelere eşzamanlı değişiklik gerektirir. Mevcut feature ve shared ayrımı aynı sahipliği sağlar.

Backend domain'leri HTTP bileşimi üzerinden bağlanır. Kelime erişimi ve eşlemesi `words/word-service`, Inspector izinleri `feedback/inspector-service`, AI erişimi `ai/gemini`, `ai/gemini-request` ve `ai/gemini-keys` girişlerinden tüketilir. Çalışan yetki veya transaction sınırları yerinde kalır. Uygulamalar arası gerçek ortaklık `@yds-atlas/shared` paketinin `exports` alanından açılır. Repository audit doğrudan workspace geçişlerini, private shared paket yollarını, web shared katmanından feature/app importlarını ve statik runtime döngülerini denetler. Kalan feature işbirlikleri ADR 0001 sahiplik kurallarına göre değerlendirilir.

Web günlük hedef, ilerleme kaydı ve İstanbul tarih fonksiyonları hesap, dashboard ve oyun tarafından tüketildiği için `frontend/src/shared/lib` altındadır. Browser depolama sözleşmesi web workspace'inde kalır. Aynı telaffuz kontrolü Inspector, oyun ve kütüphanede `frontend/src/shared/ui/pronunciation-buttons.tsx` dosyasından kullanılır.

Altı Playwright yapılandırma dosyası komut uyumluluğu için giriş noktasıdır. Ortak runner varsayımları `frontend/config/playwright/base.ts`, loopback ağ ayarları `frontend/config/playwright/loopback.ts`, otomatik Auth guard fixture'ı `frontend/config/playwright/test-fixtures.ts` içindedir. Cloud profili tablet kapsamını, guest mobil ve masaüstünü, geliştirme profilleri farklı Vite modlarını, demo etkileşimli oturumu ve Inspector kendi test seçimini korur. [Güncel profil ve çıktı tablosu](../../tests/README.md)

Recovery giriş noktası ve tarihsel V3–V8 doğrulama araçları, checksum ve scheduler yollarıyla birlikte yerinde kalır. Supabase CLI 12 migration'ı mevcut `supabase/migrations/` yolundan keşfeder. Uzak ayar veya lockfile değişikliği gerekmez.
