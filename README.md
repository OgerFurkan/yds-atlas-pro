# YDS Atlas Pro

React + TypeScript ile YDS kelime kütüphanesi ve Günlük Görev. Bun workspaces, Tailwind CSS v4, shadcn/Radix, React Hook Form, Zod, React-Toastify ve Biome kullanır.

## Başlat

```sh
bun install
bun run dev
```

Uygulama `http://localhost:5173` adresindedir. **Misafir kullanımı backend olmadan çalışır.** Hesap bağlantısı yapılandırıldığında Supabase Auth ile giriş, Bun API üzerinden kelime/görev/ilerleme kaydı ve Gemini önerileri kullanılabilir. [Bağlantı ve kurulum](docs/backend.md).

Giriş sayfası: `/#login`. Üst menüdeki **Giriş yap** düğmesiyle açılır; kayıt, şifre sıfırlama ve misafir olarak devam etme akışları bu sayfadadır.

## Hazır olanlar

- Turuncu/lacivert marka amblemi ve referanstan uyarlanmış, şeffaf Atlas maskotu.
- Tekli/toplu kelime ekleme; tarayıcıda Hunspell yazım denetimi, öneriler, baş harf ve boşluk düzeltme, tekrarların ayıklanması.
- Kelime düzenleme, arama, CEFR ve puan grubu filtreleri; liste/kart görünümü, seçimli ve toplu silme.
- 20 kelimelik başlangıç seti, Türkçe anlamlar, tür, editoryal CEFR, kullanım notları ve kelime başına Türkçe çevirili 5 özgün İngilizce örnek.
- 5'li/10'lu öğrenme grupları, kartlar, anlam ve bağlam tekrarları, genel test ve hatırlama geri bildirimleriyle puanlandırma.
- Hazırlık ve oyun için vurgulu, uygulamalı iki rehber, ara verme, sayfa yenilemesinden sonra devam, kaydedilmemiş sonuçları koruma.
- Tamamlanmış kelimelere dayanan günlük hedef; 10–100 arasında 10'un katları.

Başlangıç seti dışındaki kelimeler elle girilebilir veya yapılandırılmış hesapta Gemini ile öneri alınıp incelenerek kaydedilebilir. Canlı Cambridge verisi ve sözlükten gelen UK/US ses dosyaları bağlı değildir. Telaffuz için cihazın İngilizce sesleri kullanılabilir. Cambridge bağlantıları yalnızca sözlükte açma bağlantısıdır. Örnekler Cambridge alıntısı değildir.

## Kontroller

```sh
bun run format
bun run format:check
bun run lint
bun run test
bun run build
bun run test:e2e
bun run test:cloud
bun run test:dev
```

Playwright ilk kurulumunda `cd frontend` altında `bunx playwright install chromium` çalıştır. E2E testleri önce derlenmiş `frontend/dist` klasörünü `4173` portunda açar; bu nedenle `bun run build` adımından sonra çalıştırılır. Masaüstü ve mobil projeleri kelime ekleme, yazım önerileri, tam oyun, yenileme ve rehberi kontrol eder. Birim testleri oyun sırası, tekrar, puan, grup sınırları ve normalizasyonu doğrular.

Biome için VS Code ayarları `.vscode/` altındadır. Önerilen eklenti kurulu olduğunda kaydederken biçimlendirme etkinleşir.

## Geliştirme haritası

- [Ücretsiz deneme yayını ve gereken hesaplar](docs/deployment.md)
- [Supabase/Gemini kurulumu ve güvenlik sınırları](docs/backend.md)
- [Mimari ve dosyalar](docs/architecture.md)
- [Oyun akışı ve puan kuralları](docs/learning-game.md)
- [Maskot dosyası ve üretim istemi](docs/mascot.md)
- [Proje çalışma kuralları](AGENTS.md)

Uygulama girişi `frontend/src/main.tsx`, kabuk `frontend/src/app/App.tsx` dosyasıdır. Her özellik `features/<özellik>/` altında bileşen, model ve veri erişimi katmanlarına ayrılır. Ortak UI kaynakları `shared/ui/` içindedir.

## Supabase ve Bun API

`backend/` artık doğrulanmış Supabase oturumuyla çalışan Bun API'dir. SQLite dosyaları korunur ve açılmaz. Migration, RLS politikaları, Auth, atomik/idempotent görev sonuçları ve sunucu üzerinden Gemini bağlantısı hazırdır. Canlı proje ve anahtarlar bu aşamada bağlanmamıştır; yerel PostgreSQL ve HTTP sözleşme testleri kullanılır.

API iskeletini ayrıca incelemek için `bun run dev:api` kullanılabilir; `http://localhost:3000/api/health` sağlık kontrolüdür. Korunan uçlar Supabase Bearer oturumu ister; `x-user-id` kullanılmaz.


Geliştirme regresyonu: "bun run test:dev", Vite önbelleğini zorla yeniden hazırlayan ayrı bir sunucuda ilk yazım kontrolünün rehberi yenilemediğini doğrular. Üretim E2E testleri panel hizası, sekme sınırları, sesin tamamlanmasını bekleme, ses/sözlük hatalarından kurtulma ve Atlas tanıtımını da kontrol eder.





