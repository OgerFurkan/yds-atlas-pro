# Yayın ve ortam yönetimi

LOCAL sentetik geliştirme ortamıdır. PRE ayrı Supabase projesi ve sabit staging bağlantılarıyla yayın provasını yürütür. PROD gerçek hesap ve veri ortamıdır. Uzak değişiklikler ürün sahibi onayına ve [güncel yayın engellerine](ai/current-status.md) bağlıdır.

## Ortam kimliği

Frontend ve Bun API aynı `ATLAS_HOSTED_IDENTITIES` eşlemesini alır. PRE ve PROD için web origin, API origin, Supabase proje ve değerlendirme veritabanı kimliği ayrıdır. Frontend `VITE_ATLAS_ENV`, API `ATLAS_ENV` ile ürün ortamını seçer. Vercel deployment türü bu seçimi belirlemez. PRE projesinin sabit URL'leri kendi kaydıyla eşleşmelidir.

Vercel ve Render yapılandırmaları repo kökündedir. Public frontend değişkenleri `frontend/.env.example` üzerinden, API değişkenleri `backend/.env.example` üzerinden belgelenir. Supabase secret, değerlendirme veritabanı şifresi ve Gemini anahtarları yalnız backend secret alanına girer. Hosted veritabanı bağlantısı dar kapsamlı değerlendirme rolü ve `sslmode=verify-full` kullanır. [Backend yapılandırması](backend.md).

## Yayın, migration ve geri dönüş

1. Sabit kaynak fingerprint'i ve kilit dosyasıyla [merkezi release profilini](architecture/quality.md) doğrula. Test sonuçları, migration listesi ve önceki uygulama sürümü kanıtını sakla.
2. Ürün sahibi PRE geçişini onayladığında proje kimliği, origin, Auth yönlendirmeleri ve `/api/ready` durumunu doğrula. PRE testlerinde kullanıcı izolasyonu, değerlendirme, hesap/çevrimdışı akış ve görev verisi kontrollerini çalıştır.
3. Önceki uygulama ve yeni şema uyumluluğunu değerlendir. Şemayla uyumlu geri dönüş veya ileri düzeltme seç. DB restore ayrı hedef, veri kaybı değerlendirmesi ve açık onay gerektirir. [Recovery ve rollback](architecture/recovery-operations.md).
4. PRE kabulünden sonra PROD için ayrıca onay al. Bağımsız yedek/witness, alarm, gerçek restore, Auth ve TLS koşulları kapanmadan canlı trafik açılmaz.

`/api/health` süreç sağlığını, `/api/ready` bağımlılık durumunu bildirir. Ayrıntılı operasyon görünümü ürün sahibi, canlı oturum ve MFA ister. AI davranışı ve sağlayıcı tanıları için [backend](backend.md) geçerlidir.
