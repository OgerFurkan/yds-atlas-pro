# Ücretsiz deneme yayını

Seçilen başlangıç düzeni: frontend Vercel Hobby, Bun API Render Free, veritabanı ve Auth Supabase. Henüz bir canlı proje oluşturulmadı veya yayın yapılmadı.

## Giriş ekranı

Üst menüdeki Giriş yap düğmesi `/#login` sayfasını açar. Giriş başarılı olduğunda kullanıcı geldiği ekrana döner. Kayıt, şifre sıfırlama, şifre görünürlüğü ve misafir olarak devam etme bu sayfadadır. Oturumu olan kullanıcı `/#login` açarsa uygulamaya yönlendirilir. Şifre yenileme bağlantıları aynı sayfada yeni şifre formunu açar.

## Önce frontend

1. Yerel Git deposu `main` dalında hazırlandı ve `origin`, `https://github.com/OgerFurkan/yds-atlas-pro.git` adresine bağlandı. Gönderim için bilgisayarda GitHub kimlik doğrulaması gerekir. `.env` dosyaları, bağımlılıklar ve derleme çıktıları Git dışında tutulur.
2. Vercel'e GitHub hesabınla giriş yap ve repoyu içe aktar.
3. Root Directory repo kökü olmalı. `vercel.json`, kilitli Bun kurulumu, yalnızca frontend derlemesi ve frontend/dist çıktısını tanımlar. Çalışma alanındaki ortak paketler bu sayede bulunur.
4. İlk UI denemesi için Supabase değişkenlerini boş bırakabiliriz. Giriş sayfası görünür; gerçek hesap girişi bağlantı ayarları olmadan çalışmaz. Misafir kullanımında kelime ve oyun kayıtları çalışır.
5. Backend hazır olunca Vercel ortamına VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY ve VITE_API_URL ekleyip yeniden deploy et. VITE_API_URL, Render API adresi olmalıdır.

Hobby kişisel ve ticari olmayan kullanım içindir. Ücretsiz deneme için özel alan adı almak gerekmez.

## Sonra Supabase ve API

1. Supabase projesini Free planında hazırla. Proje URL'si ve publishable key gerekli.
2. [Backend rehberindeki](backend.md) migration ve Auth ayarlarını uygula. Supabase yönetim erişimi için CLI login veya bağlı Supabase aracı gerekir; publishable key tek başına migration uygulamaz.
3. Render'a GitHub hesabınla giriş yap. Repo kökündeki render.yaml üzerinden Blueprint oluştur veya Docker Web Service ekle: Dockerfile backend/Dockerfile, context repo kökü, plan Free.
4. APP_ORIGINS değerine yayınlanan frontend'in tam origin'ini yaz. SUPABASE_URL ve SUPABASE_PUBLISHABLE_KEY aynı projeye ait olmalı. HOST Docker içinde 0.0.0.0'dır; PORT Render tarafından verilir.
5. Render'daki API adresinin /api/health yanıtını kontrol et. Sonra Vercel'in VITE_API_URL değerini bu adresle güncelle.
6. Supabase Auth Site URL ve Redirect URLs alanlarına frontend'in gerçek origin'ini ekle. E-posta doğrulama ve şifre sıfırlamayı canlı ortamda ayrıca dene.

Render Free, 15 dakika trafik olmadığında uyur; ilk istek servis açılana kadar yaklaşık bir dakika sürebilir. Hesap hazırlanırken bağlantı hatası olursa servis açıldıktan sonra Yeniden dene ile devam edilir. Bu nedenle ücretsiz deneme, sürekli hızlı yanıt garantisi taşımaz.

## Gemini'yi en son aç

Google AI Studio'da ücretsiz kotası olan bir proje/model kullan. Render'ın gizli ortam değişkenlerine GEMINI_API_KEY ve SUPABASE_SECRET_KEY ekle. Gizli anahtarları Vercel'in VITE_ değişkenlerine veya GitHub dosyalarına koyma.

AI'nın ücretsiz kotası hesaba, modele ve bölgeye bağlı olarak doğrulanmalıdır. Uygulamadaki günlük 40/dakikalık 5 sınırı sağlayıcı kotasının yerine geçmez. Ücretli kullanım etkinleştirilmeden ücretsiz kota ile canlı deneme yapılır.

## Senden gerekenler

- GitHub kullanıcı adın ve varsa repo URL'si.
- GitHub ile açılmış Vercel ve Render hesapları; hesap şifreleri gerekmez.
- Supabase Project URL ve publishable key; migration için Supabase CLI/araç erişimi.
- Backend aşamasında Supabase secret key ve Gemini API key'i yerel backend/.env veya Render Secrets içine tanımlaman.
- Varsa kullanmak istediğin alan adı; yoksa platform adresleriyle devam edebiliriz.

Docker bu bilgisayarda kurulu olmadığı için image build burada doğrulanmadı. Dockerfile'ın kullandığı production-only workspace kurulumu ve API health yanıtı ayrı geçici klasörde test edilir. Platformdaki Linux image build, GitHub/Render bağlandıktan sonra ayrıca doğrulanır.

Kaynaklar: [Vercel Vite](https://vercel.com/docs/frameworks/frontend/vite), [Vercel Hobby koşulları](https://vercel.com/docs/plans/hobby), [Render Free](https://render.com/docs/free), [Render Blueprint](https://render.com/docs/blueprint-spec), [Gemini fiyat/kota seçenekleri](https://ai.google.dev/gemini-api/docs/pricing).

