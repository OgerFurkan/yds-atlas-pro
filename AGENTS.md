# YDS Atlas Pro çalışma kuralları

Türkçe YDS/YÖKDİL kelime öğrenme ürünü. Mevcut [marka varlıklarını](docs/mascot.md) koru.

## Çalışma

- Önce [güncel durum](docs/ai/current-status.md) ve göreve özel kaynakları oku. Tarihsel raporları yalnız ilgili kanıt gerektiğinde aç. Çalışma sonunda güncel durumu bir kez güncelle.
- Aynı sohbet içinde yalnız değişen ya da görev için gerekli kaynakları oku. Tamamlanmış analizleri gereksiz yere tekrarlama.
- İzinli işleri tek pakette tamamla. Belirsiz kaynakları ve önceki değişiklikleri koru. Uzak veya geri alınamaz işlemlerde ürün sahibinin geçerli yetkisini doğrula.
- Her görevde bağımsız inceleme için gerekli teslim dosyalarını tek ZIP olarak sun ve doğrudan dosya bağlantısını ver. Windows’ta hedef, `[Environment]::GetFolderPath('DesktopDirectory')` ile bulunan Masaüstü altındaki `YDS-Atlas-Teslimler/` klasörüdür. Gizli değerleri, tokenları, parolaları, API anahtarlarını ve gerçek .env dosyalarını ZIP'e ekleme.
- [Yol haritasını](docs/ai/current-status.md) izle. Sonraki adıma ürün sahibi onayıyla geç. Premium UI/UX, kapsamlı Atlas Control Center ve yeni öğrenme özellikleri ayrı ürün kapsamıdır.

## Kod ve veri

- React ve Bun modüler monolitinde UI, hook, model ve veri erişimi özellik sınırlarına göre ayrılır. Dosyalar kebab-case, bileşenler PascalCase, fonksiyonlar camelCase. Frontend girişi `frontend/src/main.tsx`, tek kabuk `frontend/src/app/App.tsx`.
- Tailwind ve `frontend/src/shared/ui/` kontrollerini yeniden kullan. Global CSS tema, font ve temel stiller içindir. Formlarda React Hook Form ve Zod, bildirimlerde React-Toastify, ikonlarda Lucide, rehberlerde Driver.js kullan. Yeni bağımlılık için somut ihtiyaç gerekir.
- Misafir verisi localStorage'da, hesap verisi Bun API üzerinden Supabase'de tutulur. Supabase Auth kimliğini doğrula. `x-user-id` üzerinden kimlik verme. Gemini backend'de kalır. `VITE_` alanlarına secret yazma.
- Başlangıç verisini AI veya Cambridge içeriği gibi sunma. Oyun motoru saf fonksiyonlar kullanır. Yenileme kayıtlı yanıtları korur. Tekrarlanan sonuç yazımı çift puan üretmez.
- Masaüstü, tablet, telefon ve uygulama istemcileri aynı API ve veri kurallarına uyar. Depolama ve kilitleme platform adaptöründe kalır. [Platform sözleşmesi](docs/architecture/overview.md#cross-platform-product-standard-ek-f).

- Yerleşim ve import sınırları için [workspace kararını](docs/adr/0002-workspaces-and-test-profiles.md) izle. İki uygulama ortak sözleşmeleri `@yds-atlas/shared` public exportlarından alır. Tarayıcı çıktılarını [test profillerinin](tests/README.md#tarayıcı-profilleri-ve-çıktılar) run dizininde tut.
- Yeni dosya açmadan önce mevcut domain sahibini ve tekrar kullanılabilir kodu kontrol et. [Mimari kurallar](docs/architecture/overview.md#refactoring-policy) feature girişlerini, büyük dosya incelemesini ve görev sonu kontrolünü tanımlar.

- Büyük işlevsel modüller için sahiplik gerekçesi ve incelenmiş büyüme sınırı gerekir. Merkezi denetim yanlış yerleşen ve emekli olduğu doğrulanan kaynakları yakalar. Yeni domain erişimi için mevcut dar public girişleri kullan.

## Doğrulama

- Biome biçimini ve ilgili tip, lint, build ve regresyonları doğrula. Görünüm değişikliğinde telefon ve masaüstünü kapsa. [Merkezi kalite profilleri](docs/architecture/quality.md).
- Yetki, ortam ve veri sözleşmeleri için [backend](docs/backend.md), [öğrenme](docs/learning-game.md), [yayın](docs/deployment.md) ve [Recovery](docs/architecture/recovery-operations.md) belgelerini kullan.
