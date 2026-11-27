# Step 4 Recovery ve operasyon

## Ortam ve kimlik

LOCAL, migration ve sentetik fixture ile yeniden oluşturulur. Kalıcı LOCAL yedekleme veya alarm işi yoktur. PRE ve PROD aynı Atlas Recovery sözleşmesini kullanır. Proje kimliği, DB rolü, servis yapılandırması, saklama hedefi ve anahtar gözetimi her ortamda ayrıdır. Ürün sahibi, hedefi doğrular ve kurtarma sonrası trafik açma kararını verir.

Yönetilen plan bu çalışmada sorgulanmadı. Ücretsiz plan için resmi öneri düzenli mantıksal export ve ayrı fiziksel arıza alanında saklamadır. Otomatik günlük yönetilen yedekler ücretli planlar içindir. PITR veya yeni proje bu paketin operasyon varsayımı değildir. Supabase CLI 3.1.0 sabit kalır. Changelog'daki 3.4.0 yeni proje yapılandırması mevcut config.toml dosyasını değiştirmez. PostgreSQL 17.11, sabit PostgREST ve Auth imajları LOCAL sözleşmesini temsil eder. Hosted sürüm ve ürün konfigürasyonu PRE'de ayrıca doğrulanır. [Yedekler](https://supabase.com/docs/guides/platform/backups) · [CLI kurtarma](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) · [Proje klonlama](https://supabase.com/docs/guides/platform/clone-project) · [Changelog](https://supabase.com/changelog).

## Bütün sistem kapsamı

| Bileşen                      | Saklanacak ve doğrulanacak kanıt                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL schema ve veriler | Tutarlı snapshot, dump, dizin manifesti, tablo içeriği ve veri bütünlüğü.                                                                          |
| Migration geçmişi            | Sürüm kontrollü mevcut SQL ve DB migration kayıtları. Hosted kayıtla uyum PRE'de doğrulanır.                                                       |
| Roller, grant, RLS ve RPC    | Rol metadata ve ACL öncesi/sonrası karşılaştırması, ayrı hesapların gerçek erişim testi. Rol parolaları ayrı kasadan yeniden sağlanır.             |
| Extension ve sequence        | Kaynak sürüm/sahiplik planı, hedef extension önkoşulları ve sequence durumları.                                                                    |
| Auth                         | Hesap ve oturum kayıtları, eski token reddi, refresh iptali. İmza anahtarları ve OAuth/redirect yapılandırması ayrı.                               |
| Storage                      | Kodda kullanılan bucket istemcisi bulunmadı. Storage devreye girerse DB metadata ve gerçek nesneler için ayrı checksum ve kurtarma kanıtı gerekir. |
| Vault                        | DB yedeği ciphertext'i taşır. Platform şifreleme anahtarı ayrı bağımlılık. Atlas HMAC zarfı bu anahtarın yerine geçmez.                            |
| Global Lexicon ve işler      | Canonical kayıtlar, revision geçmişi ve iki kuyruk için restore fingerprint kontrolü. İşler kabulden önce durur.                                   |
| Bağımsız silme kararları     | Dump dışı imzalı sıra ve bağımsız monotonic son baş. Onay alınamazsa trafik kapalı.                                                                |
| Uygulama sürümü              | Frontend/backend release kimliği, kaynak ve lockfile hash'i, Bun/Node/sabit imajlar.                                                               |
| Servis konfigürasyonu        | Auth, network, TLS, AI sağlayıcısı ve servis kimliği sözleşmeleri. Değer ve anahtar kasası ayrı.                                                   |

[Yedek kapsamı](https://supabase.com/docs/guides/platform/backups) · [Vault şifreleme modeli](https://supabase.com/docs/guides/database/vault).

## Backup ve saklama

Atlas Recovery mevcut capture transaction, snapshot, ayrı pending dizini, hash, HMAC receipt, dosya flush ve atomik dizin taşıma zincirini kullanır. ScheduledSynthetic, yalnız önceden hazırlanmış sentetik SessionId kabul eder, yeni işlem kimliği üretir ve aynı oturumda eşzamanlı Create'i mutex ile reddeder. Windows beklenmeyen sahip kaybını algılarsa o girişim durur. Yeni deneme ayrı PackageId kullanır. Önceki mühürlü paket korunur. Başarılı işlemde ayrı güven dizinine imzalı zaman kanıtı yazılır. Host tarafındaki komutlar var olan timeout mekanizmasını kullanır. Ağ çağrısı ve gerçek görev kaydı bu modun parçası değildir.

PROD için çalışma sözleşmesi, mevcut araçta doğrulanmış ortam/proje ve yetkili snapshot kaynağı, bağımsız depoya kopya, doğrulanmış makbuz ve izleme entegrasyonu tamamlanınca etkinleşir. Zamanlayıcı için ayrı minimum yetkili hizmet hesabı, korumalı alanda çalışma, çakışmayı reddetme, hard timeout, en fazla bir sonraki kontrollü deneme ve exit code ile olay bildirimi gerekir. Windows Task Scheduler üzerinde kayıt ancak onayla ve güvenli hizmet hesabıyla yapılır. Kişisel bilgisayar kapalıyken zamanlayıcı veya yerel izleyici çalışmaz. PROD için sürekli çalışan görev sahibi ve farklı arıza alanından heartbeat zorunludur. Devre dışı bırakmak için zamanlayıcı işi durdurulur, çalışmakta olan işlem ve son geçerli makbuz doğrulanır.

Retention dry-run, yalnız kimliği ve doğrulama zamanı önceden doğrulanmış paketlerden aday listesi çıkarır. En yeni geçerli paket saklanır. Aday listesi otomatik silme yetkisi vermez. Diskte önerilen uyarı %75, kritik eşik %90'dır. Yeni snapshot, doğrulama ve önceki paket için ölçülmüş alan yoksa capture başlamadan kapasite kararı gerekir. Farklı diskler aynı cihazda olduğunda fiziksel felaket gözetimi eksik kalır.

| Politika               | PRE önerisi                                           | PROD önerisi                                                              |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| RPO ve backup          | 48 saat, günlük veya release öncesi                   | 24 saat, en geç 24 saatte bir doğrulanmış export                          |
| RTO hedefi             | 1 iş günü                                             | 4 saat, onay ve erişim doğrulaması dahil                                  |
| Retention ve doğrulama | En az 2 sağlam paket, 7 gün. Her release öncesi prova | En az 3 sağlam paket, 30 gün. Haftalık bütünlük, aylık ayrı hedef restore |
| Maksimum yedek yaşı    | 48 saat                                               | 24 saat                                                                   |

Sayılar ilk politika önerisidir. Gerçek veri hacmi, transfer hızı ve +1 sağlam kopya kapasitesi ölçülmeden SLA verilmez.

## Anahtar ve silme kararları

Windows DPAPI CurrentUser makbuz anahtarı, kullanıcı ve cihaz bağlamına bağımlıdır. Taşınabilir zarf, standart AES-256-GCM ve PBKDF2-SHA256 ile anahtar kimliği, ortam ve proje bağlamını doğrular. Güçlü rastgele parola ve zarf ayrı fiziksel arıza alanlarında korunur. Eski doğrulanmış paketlerin anahtarları retention bitene kadar eski keyId ile tutulur. Yeni kimliğe rotasyon, yeni zarf ve tekrar doğrulama gerektirir. Gerçek DPAPI dosyası okunmadı, zarf testi rastgele sentetik anahtarla ayrı süreçte yapıldı. Gerçek ikinci cihaz, DPAPI yeniden bağlama ve Vault şifreleme anahtarı kabulü açık.

Silme kararının HMAC zinciri, sahip, artan sıra ve bağımsız son baş doğrulanmadan eski yedek erişime açılmaz. Eski geçerli bir baş tek başına yeterli değildir. Aynı cihazdaki sentetik witness, bağımsız PROD saklama kanıtı sayılmaz. Üretim yayını öncesinde eski arşivin rollback alanı dışında tek yönlü ilerleyen yetkili son baş gerekir. Yoksa restore kapalı tutulur. Gerçek hesap silme önceki kilidini korur.

## Health, log ve alarm

- GET /api/health, mevcut liveness sözleşmesidir. Sağlayıcı arızasında restart döngüsü başlatmaz.
- GET /api/ready, salt okunur PostgreSQL ping'i ve Auth health probunu eşzamanlı çalıştırır. Tek uçuş ve kısa cache kullanır. Genel yanıt sadece hazır veya kullanılamaz durumudur.
- GET /api/control/operations, canlı oturum, ürün sahibi ve sunucu tarafı MFA şartlarıyla sürüm 1 görünümü verir. API sayıları ve sabit gecikme kovaları süreç belleğinde tutulur. İstek yolu, sorgu, credential veya kullanıcı bilgisi metrik etiketi olmaz. Ortam ve release kimliği ile mevcut Gemini tanısı kullanılır. Ölçülmeyen disk, Recovery ve kuyruk verisi null döner.
- Mevcut yapılandırılmış hatalar correlation ID, kod ve HTTP durumunu taşır. Alarm sözleşmesi ayrıca ortam, severity, zaman, dar olay türü ve durum taşır. Teslim arızası ayrı sonuçtur. Cooldown, çakışma ve recovery bildirimi mock testindedir. Bağımsız izleyici, güvenli sink, restart sonrası durable alarm state ve Recovery aktarımı PROD yayını için açıktır.

## İşletim runbook'ları

1. **Servis kesintisi.** Dış canary, liveness ve readiness kaydını karşılaştır. Arızalı dependency için son sürüm, SQL/TLS ve Auth rotasını kontrol et. Canlı süreçte bağımlılık arızası için restart zorlamadan önce etkisini ölç.
2. **Yanlış ortam veya güvenlik olayı.** İşi durdur, ortam/proje ve kaynak fingerprint'ini kontrol et. Token ve veri içermeyen olay kaydını koru. Yetki iptali ve anahtar rotasyonu ürün sahibi kararına bağlıdır.
3. **Yedek başarısızlığı veya bozulma.** Son doğrulanmış paketi koru. Alan, makbuz ve bağımsız kopya durumuna bak. Yanlış kimlik veya integrity hatasında otomatik yeniden deneme yapma. Yalnız görev sahibi sentetik pending alanlarını temizler.
4. **Restore.** Ayrı hedef kullan. Paket, extension sürümü, rol, grant, constraint, sequence, Auth, RLS/RPC ve tenant canary doğrula. Güncel silme kararını uygula ve eski token'ların reddini doğrula. Sonuç ve ürün sahibi onayı gelene kadar trafik kapalıdır.
5. **Başarısız release ve rollback.** Önce uygulama artefact sürümünü ve mevcut DB şemasıyla uyumunu doğrula. Mevcut kullanıcı yazılarını koruyabilen geri dönüş veya ileri düzeltmeyi seç. DB restore gerekiyorsa ayrı hedef ve veri kaybı kararı gerekir. Yarım migration için uygulanan migration kaydı ve şema farkı incelenir. Otomatik down migration çalıştırılmaz.
6. **Cihaz ve anahtar kaybı.** Zarf ve parola ayrı emanetçilerden alınır. Ortam ve keyId bağımsız kayıttan eşleştirilir. Yanlış parola veya imza durumunda durulur. Korunan yedek kopyasına ürün sahibi onayıyla ayrı hedefte doğrulama uygulanır.

Sentetik komutlar mevcut Atlas Recovery girişindeki Compatibility ve ScheduledSynthetic modları ile merkezi quality profilleridir. Kısa restore provası `python tests/backend/database/isolated-services.py --allocate-ports --restore-only` komutudur. Release, mevcut 24 kapıyı korur ve gerçek servis kapısında restore kanıtını zorunlu tutar. Sabit Recovery imaj provası ayrı kapıyla toplam 25 kapıdır. Yeni Node ve Bun sözleşmeleri mevcut envanterlerine girer.

## Açık kabul ve Step 5 envanteri

P0 gözlenmedi. Gerçek PROD snapshot kaynağı ve zamanlayıcı, bağımsız depolama/witness, gerçek Vault ve fiziksel anahtar geri kazanımı, sürekli alarm teslimi ve hosted kabulü P1 yayın engelleridir. LOCAL korumalı disk üzerinde zamanlanmış paket yayını, disk dolması ve kesinti enjeksiyonu bu Windows oturumunun mevcut yükseltilmiş yetkisi olmadan açık kalır. Kapasite ve kuyruk telemetrisi ile ölçülmüş hosted RPO/RTO açıktır. Sürüm uyumluluğu ve ileri düzeltme sözleşmesi statik runbook kapsamındadır. Gerçek release, veritabanı rollback ve restore uygulanmadı.

Step 5 adayları, mevcut Biome uyarıları, tarihsel Recovery girişlerinin sadeleştirme envanteri ve tekrar eden operasyon belgeleridir. Tarihsel paket uyumluluğu ve önceki manifest kanıtları saklanır.

## Step 4 hedefli kapanış

| Bulgu                     | Kanıt ve sınır                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ortam ve snapshot yetkisi | Sentetik publication sözleşmesi önceden seçili ortam, proje, aktif keyId, görev ve işlem kimliğini bağlar. PRE/PROD snapshot, zamanlayıcı ve bağımsız depolama adaptörleri kilitlidir.                                                                                                                                                                                                          |
| Çakışma ve yayın          | Windows sentetik publisher kilidi SessionId'den bağımsızdır. ScheduledSynthetic, doğrulanmış manifest ve history'ye bağlı imzalı backup-event yazılmadan paketi görünür yapmaz. VerifyScheduled hem mevcut paket doğrulamasını hem v2 event imzasını ister. Önceki paketler değişmez.                                                                                                           |
| Retention ve aktarım      | Sınırlı sentetik adaptör eski ve yeni keyId'leri aynı ortam/proje anahtar halkasından doğrular. Retention dry-run her paketin imzalı makbuzunu ve AES-GCM ile korunan arşivini tekrar doğrular. BitLocker cihaz dışına taşınmaz. Gerçek aktarım adaptörü için bağımsız depolama, yönetilen anahtar ve büyük arşivde sınırlandırılmış streaming kabulü gerekir.                                  |
| Taşınabilir güven         | Mevcut PBKDF2/AES-GCM zarfı ile aynı HMAC anahtarı bağımsız süreçte açılarak önceki biçimdeki makbuz ve sürümlü kayıt doğrulanır. Yalnız rastgele sentetik parola anonim stdin ile verilir. Çocuk süreç anahtar veya parola yazmaz. Gerçek DPAPI export, yeni kullanıcıya bağlama ve fiziksel cihaz kabulü açık.                                                                                |
| Vault                     | Sabit Recovery imajı extension/katalog ve anahtar yokken fail-closed kontrolünü yapar. Mevcut imaj provasında Vault server key hazırlanmadığı için ciphertext/key recovery NOT_RUN. Atlas HMAC zarfı Vault ciphertext kanıtı olarak sayılmaz.                                                                                                                                                   |
| Silme ve restore          | Monotonic taban ve kimlik doğrulanmadan eksik, eski veya başka ortam witness reddedilir. Önceki gerçek izole Auth/PostgREST replay provası release'te korunur. PROD monotonic otoriteye erişim ve kalıcı saklama sağlanana kadar trafik açma kapısı kapalıdır.                                                                                                                                  |
| Arıza enjeksiyonu         | Mock depo ENOSPC, yarım ciphertext, makbuz yazım hatası, kesilen capture ve manifest arızasında önceki geçerli paketi korur. Windows mutex testi eşzamanlı ve abandoned sahipliği doğrular. Bu testler BitLocker disk veya gerçek elektrik kesintisi kabulü değildir.                                                                                                                           |
| Operasyon API             | Owner, canlı oturum ve MFA mevcut kapıdan geçer. Readiness tek uçuş ve 2,8 saniye üst sınır kullanır. Tooltip ve Lexicon durumları en fazla 100 satırlık örneklemedir. Eksik ölçüm ve ayrı fiziksel depo kapasitesi null kalır.                                                                                                                                                                 |
| Durum aktarımı            | İsteğe bağlı ATLAS_RECOVERY_STATUS_FILE ve ATLAS_RECOVERY_STATUS_PUBLIC_KEY, Ed25519 imzalı, sürümlü ve en fazla 15 dakikalık gözlemi doğru hosted projeye bağlar. Backend yalnız doğrulama anahtarı taşır. Dosya konumu için servis hesabına ayrılmış yerel dizin gerekir. Varsayılan değer yoktur.                                                                                            |
| Alarm                     | Olay türü başına en fazla iki bekleyen kayıt tutulur. Teslim sırasında recovery ve recovery sırasında yeni arıza sırasıyla işlenir. Timeout sonrası aynı correlation ID ile retry ve checkpoint geri yükleme mock ile sınanır. Checkpoint yazıcısı atomik ve senkron olmalı, sink correlation ID'ye göre idempotent davranmalıdır. Backpressure sonucu üretici tarafından yeniden işlenmelidir. |
| Release ve rollback       | Sentetik karar matrisi şema uyumlu sürümü seçer. Uyum yoksa ileri düzeltme gerekir. Uygulama rollback'i geçerli kullanıcı yazılarını korur ve DB restore başlatmaz.                                                                                                                                                                                                                             |

Korumalı disk provaları için yönetici olarak açılmış Windows PowerShell, doğrulanmış BitLocker depolama alanı ve sadece görev için oluşturulacak yeni sentetik SessionId gerekir. Aynı sahip altında Initialize, ScheduledSynthetic ve VerifyScheduled sırası izlenir. Bu oturum otomatik yükseltilmez. Yükseltilmiş prova Windows korumaları değiştirilmeden, var olan gerçek paketlere dokunulmadan yürütülür.

Gelecekte zamanlayıcı kurulumunda servis hesabı ve onaylı ortam/proje bağları bağımsız doğrulanır. Yalnız tek görev sahibi çalıştırılır. Devre dışı bırakma görev tetikleyicisini durdurur, süren işi ve son mühürlü paketi denetler. Kişisel bilgisayarın kapalı olması, bağımsız depolama ve alarm teslimi olmaması PROD yayın engelidir. LOCAL sürekli scheduler gerektirmez.

### Koşu kanıtı

Windows release `FAIL` (1), 24/25 kapı PASS. Geçmeyen kapılar recovery-contracts. Sentetik capture 880 ms, restore ve erişim kabulü 4112 ms. 99 Node senaryosu, dört operasyon API testi, HMAC/format ve Windows mutex hedefli kontrolleri geçti. Loopback mock, sınırlı kuyruk örneklemesini ve imzalı dosyadan durum aktarımını doğruladı. Korumalı disk yayını mevcut Windows oturumunda BLOCKED. Vault ciphertext/key recovery NOT_RUN. Step 4 LOCAL kabulü önerilmez.

Bütünleşik koşu sonrası mutex fixture platformunu OS ortam değişkeni yerine sistem API’sinden alır. Güncel pinlerle temiz ortamda hedefli Recovery kapısı geçti. Test edilen fingerprint `e5d4d147ecc7cfc3f5c22a32a946124094aa6c1ebeea8425823aa631e5d2d930`. Bu kanıt ve güncel durum satırı koşudan sonra eklendi.

## Step 4 son güvenilirlik kapısı

- İmzalı Recovery durumu v2, son girişimi son doğrulanmış paketten ayrı taşır. Son girişim başarısız veya süre sınırını aşmışsa eski sağlam paket korunur ve durum failed olur. Bilinmeyen girişim veya tamamlanmamış süresi ölçülemeyen girişim unknown kalır. v1 doğrulanmaya devam eder. Kalıcı üretici, aynı proje kilidi altında atomik ve güvenilir girişim journal'ı sağlamalıdır.
- Capture ve cleanup hataları ayrı güvenli kodlarla döner. Alarm üreticisi aynı olay zamanı ile en fazla iki kez dener. Teslim veya backpressure sonucu ve olay zamanı çağırana iletilir. Alarm checkpoint v2, tamamlanan toparlanma olayının sırasını da korur. Zamanı bilinmeyen boş v1 checkpoint yeniden eşik belirlemek için yetkili kaynak gerektirir.
- İzole restore provası, güncel ve kapsamı doğru witness kanıtını PostgreSQL hedefi tanıtılmadan ve Auth/PostgREST başlatılmadan önce doğrular. Eksik, eski imzalı ve başka ortam witness reddedilir. Hosted ortamda bağımsız monoton kaynak ve gerçek aktivasyon onayı açık yayın koşuludur.
- Sabit Supabase imajı, iki rastgele sentetik Vault anahtarı ve iki tek kullanımlık PostgreSQL kümesi ile sınanır. Yanlış anahtar restore edilen ciphertext'i açamaz. Özgün sentetik anahtar aynı ciphertext'i açar. Anahtarlar ağsız konteynerin tmpfs alanında kalır. Gerçek Vault anahtarı, DPAPI export/import ve fiziksel ikinci cihaz kabulü ayrı kalır.
- 16 MiB sınırı sentetik adaptöre aittir. PRE'de güvenli büyük arşiv streaming, hedef izolasyonu ve restore provası gerekir. PROD'da ek olarak bağımsız fiziksel saklama, witness gözetimi, kesintisiz çalıştırıcı ve dış alarm teslimi gerekir.

### Korumalı disk provası için ayrı onay

Amaç, yalnız yeni sentetik paket için BitLocker, özel ACL, DPAPI makbuzu ve yayın sonu doğrulamasını birlikte sınamaktır. Geçerli oturum, yöneticilik kontrolünde BLOCKED döndü. Aşağıdaki komutlar, ürün sahibi ayrı onay verdikten sonra aynı yetkili Windows hesabıyla açılmış yönetici PowerShell'de repo kökünden çalıştırılır.

```powershell
$session = '3a695cbac73d4c8e89d8f6b3fade7b6b'
$package = [guid]::NewGuid().ToString('N')
$tool = '.\scripts\quality\atlas-recovery.ps1'
powershell.exe -NoProfile -NonInteractive -File $tool -Mode Initialize -SessionId $session
if ($LASTEXITCODE -ne 0) { throw 'Sentetik depo olusturulamadi.' }
powershell.exe -NoProfile -NonInteractive -File $tool -Mode ScheduledSynthetic -SessionId $session -PackageId $package
if ($LASTEXITCODE -ne 0) { throw 'Sentetik paket yayinlanamadi.' }
powershell.exe -NoProfile -NonInteractive -File $tool -Mode VerifyScheduled -SessionId $session -PackageId $package
if ($LASTEXITCODE -ne 0) { throw 'Sentetik paket veya olay dogrulanamadi.' }
```

İzole hedefler `D:\AtlasV8SyntheticImageV2-3a695cbac73d4c8e89d8f6b3fade7b6b` ve `%LOCALAPPDATA%\AtlasV8SyntheticImageV2Trust-3a695cbac73d4c8e89d8f6b3fade7b6b`. Bu yollar zaten varsa durulur. D:, güven alanının birimi ve sistem birimi sabit NTFS, tam şifreli ve BitLocker koruması açık olmalıdır. Araç sahipliği ve kalıtımı kapalı ACL'yi denetler. ACL veya şifreleme değişikliği yapılmaz.

Beklenen kanıt initialized, scheduled_synthetic ve scheduled_verified PASS kayıtlarıdır. Yalnız doğrulanmış sentetik SessionId ve PackageId'nin dosya listesi, sahipliği ve reparse kontrolü doğrulandıktan ve kanıt korunduktan sonra ürün sahibi geçici paketi ve eşleşen receipt, backup-event ve DPAPI fixture dosyalarını temizler. Yalnız açık adlarla doğrulanmış dosyalar ve boş görev dizinleri temizlenir. Beklenmeyen dosyada işlem durur.

### Son koşu

Windows release `PASS` (0), 25/25 kapı PASS. Sentetik capture 862 ms, restore ve erişim kabulü 4688 ms. Hedefli Node envanteri 101, operasyon API 5, temiz ortam Windows mutex, izole restore witness ve sabit imaj Vault testleri geçti. Korumalı disk provası BLOCKED. Step 4 LOCAL kabulü önerilmez.

Test fingerprint `28a37f4fb43ab88cdd77511ac879a1a3413c756e61396b346f789fcb3af1829d`. Koşu sonrası farklar iki belge, sonuç kaydı ve PowerShell komutlarının exit code denetimiyle sınırlıdır.

### Ürün sahibi korumalı disk kanıtı

27 Kasım 2026 tarihli Step 5 başlangıç bildiriminde SessionId `3a695cbac73d4c8e89d8f6b3fade7b6b`, PackageId `ca435aec67e14de7b849d7937272b726`. Initialize, ScheduledSynthetic, VerifyScheduled ve PROTECTED DISK PROBE PASS. Bildirilen backup süresi 2834 ms. Bu prova Step 5 koşusunda tekrarlanmadı ve oturum korundu.
