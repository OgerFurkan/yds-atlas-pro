# YDS Atlas Pro çalışma kuralları

- Uygulama Türkçe bir YDS kelime öğrenme ürünüdür. Marka: turuncu, lacivert/mavi ve gözlüklü kurt Atlas. Kullanıcının referansından üretilen maskot `frontend/public/brand/atlas-mascot.png` dosyasındadır.
- Özellik bazlı klasör yapısını koru. UI, hook, model, veri ve veri erişimini ayrı dosyalara ayır. Dosyalar `kebab-case`, React bileşenleri `PascalCase`, fonksiyonlar `camelCase` olmalı.
- Uygulama girişi `frontend/src/main.tsx`, uygulama kabuğu `frontend/src/app/App.tsx`. İkinci bir App dosyası oluşturma.
- Stilleri Tailwind CSS ile yaz. Mevcut shadcn/Radix bileşenlerini `frontend/src/shared/ui/` içinden kullan; aynı kontrolün tekrarını feature içinde yazma. Global CSS tema ve temel stiller içindir.
- Formlarda React Hook Form ve Zod, bildirimlerde React-Toastify, ikonlarda Lucide kullanılıyor. Rehberlerde Driver.js kullanılıyor. Yeni kütüphaneyi somut ihtiyaç varsa ekle.
- Kod biçimlendirme Biome ile yapılır: `bun run format`, `bun run format:check`. Gerekli değişiklikleri `bun run build`, `bun run lint` ve değişiklikle ilgili testlerle doğrula.
- Oyun kuralları ve kabul edilen puan hesabı `docs/learning-game.md` içinde. Oyun motoru saf fonksiyonlardan oluşur; görünümlerden ve depolamadan ayrı tutulmalıdır.
- Misafir kullanımında localStorage, giriş yapılınca Bun API üzerinden Supabase kullanılır. Auth Supabase'tir; x-user-id ile kimlik doğrulama yapma. Gemini yalnızca backend'den çağrılır; gizli anahtarları VITE_ alanlarına koyma. Canlı proje henüz bağlanmadı; kurulum docs/backend.md içindedir. Başlangıç setini AI veya Cambridge verisi gibi sunma.
- Ekranları telefon ve masaüstü için kontrol et. Depolanan cevaplar ve sonuçlar yenilemede korunmalı; sonuç kaydını yeniden denemek aynı puanı iki kere eklememeli.

Mimari harita: `docs/architecture.md`.



