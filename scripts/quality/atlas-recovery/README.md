# Atlas Recovery

Windows PowerShell 5.1 giriş noktası [atlas-recovery.ps1](../atlas-recovery.ps1). Bu sürüm sentetik LOCAL PostgreSQL kabulünü ve doğrulanmış sentetik paketlerin izole restore işlemini destekler. STAGING modları bağlantı veya kimlik bilgisi istemeden durur.

## Kullanım

Depo kökünde normal Windows PowerShell ile çalıştırın. İmajlar Docker Desktop önbelleğinde bulunmalıdır.

```powershell
.\scripts\quality\atlas-recovery.ps1 -Mode Compatibility
.\scripts\quality\atlas-recovery.ps1 -Mode Compatibility -FormatName LegacyV7
.\scripts\quality\atlas-recovery.ps1 -Mode Compatibility -FormatName LegacyV8
.\scripts\quality\atlas-recovery.ps1 -Mode Compatibility -WithPostgrest
.\scripts\quality\atlas-recovery\tests\contracts.ps1
```

İlk komut beş eklentili genel V8 sözleşmesini PostgreSQL 17.11 üzerinde çalıştırır. Eski biçimler önceki katalog düzenini .018 imajında sınar. PostgREST seçeneği .019 üzerinde RAM'de restore edilen hedefe bağlanır ve iki sentetik hesabın satır izolasyonunu kontrol eder. Bu seçenek Node.js ve yerel PostgREST v16.5 imajı gerektirir. RAM modları kalıcı paket açmaz.

Kalıcı kabul için aynı Windows kullanıcısıyla yönetici PowerShell açın. [SHA-256 listesini](SHA256SUMS) bağımsız inceleme kaydıyla karşılaştırın. Aşağıdaki komut yeni sentetik kimlikler kullanır ve başlattığı sürecin çıkış kodunu denetler.

```powershell
$ErrorActionPreference = 'Stop'
$tool = '.\scripts\quality\atlas-recovery.ps1'
$list = '.\scripts\quality\atlas-recovery\SHA256SUMS'
foreach ($line in Get-Content -LiteralPath $list) {
    if ($line -cnotmatch '\A([0-9A-F]{64})  (atlas-recovery(?:\.ps1|/[a-zA-Z0-9./-]+))\z') {
        throw 'Gecersiz SHA-256 listesi.'
    }
    $expected = $Matches[1]
    $path = Join-Path '.\scripts\quality' $Matches[2]
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $expected) {
        throw "SHA-256 uyusmazligi: $path"
    }
}
$session = [guid]::NewGuid().ToString('N')
$package = [guid]::NewGuid().ToString('N')
$exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$args2 = @('-NoProfile','-NonInteractive','-File',$tool,'-Mode','Acceptance',
           '-SessionId',$session,'-PackageId',$package)
$process = Start-Process -FilePath $exe -WorkingDirectory (Get-Location).Path -ArgumentList $args2 -NoNewWindow -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Atlas Recovery LOCAL kabul basarisiz. ExitCode=$($process.ExitCode)" }
```

Kabul ayrı süreçlerde oluşturma ve restore yapar. Paketi ve güven kaydını sonraki inceleme için bırakır. Kalıcı adımlar sabit NTFS, BitLocker, korumalı ACL ve aynı kullanıcıya bağlı DPAPI gerektirir.

## Paket sözleşmeleri

| FormatName | Manifest başlığı            | PostgreSQL imajı                          | Paket yolu                                                    |
| ---------- | --------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| ImageV2    | atlas-recovery-v8-image-v2  | .019 sabit index ve linux/amd64 manifesti | `D:\AtlasV8SyntheticImageV2-<SessionId>\atlas-v8-<PackageId>` |
| LegacyV8   | atlas-recovery-v8           | .018 sabit index ve linux/amd64 manifesti | `D:\AtlasV8Synthetic-<SessionId>\atlas-v8-<PackageId>`        |
| LegacyV7   | atlas-recovery-v7-synthetic | .018 sabit index ve linux/amd64 manifesti | `D:\AtlasV7Synthetic-<SessionId>\atlas-v7-<PackageId>`        |

Sırasıyla `%LOCALAPPDATA%\AtlasV8SyntheticImageV2Trust-<SessionId>`, `AtlasV8SyntheticTrust-<SessionId>` ve `AtlasV7Trust-<SessionId>` kullanılır. DPAPI ve HMAC için aynı kullanıcı ve özgün güven alanı gerekir. Biçimi açıkça seçin ve asıl kimlikleri kullanın.

```powershell
.\scripts\quality\atlas-recovery.ps1 -Mode Verify -FormatName ImageV2 -SessionId $session -PackageId $package
.\scripts\quality\atlas-recovery.ps1 -Mode Restore -FormatName ImageV2 -SessionId $session -PackageId $package
```

LegacyV7/V8 biçimleri okuma ve restore içindir. Uyuşmazlık halinde paketi düzeltme adı altında dönüştürmeyin veya yeniden imzalamayın.

Tarihsel gerçek `manifest.json` arşivlerinin özgün doğrulama ve restore araçları yerinde korunuyor. `format=3` için `staging-backup.ps1`, `format=4` için paketi üreten V4/V5 aracı, `format=5` için `staging-backup-recovery-v6.ps1` ve bağımsız kaydedilmiş manifest hash'i gerekir. Yeni sentetik giriş bu gerçek arşivleri açmaz.

## Mimari ve bakım

- `recovery.config.json` imaj kimliklerini, süreleri, paket biçimlerini ve modül özetlerini tutar. Giriş yapılandırmayı, kapsayıcı da Bash/SQL dosyalarını kullanmadan önce doğrular.
- `security.ps1` alt süreç süresi ve çıktı koruması, BitLocker, ACL, reparse point ve DPAPI/HMAC işlevlerini içerir. `packages.ps1` manifest, makbuz, atomik yayımlama ve negatif paket testlerini tek yerde tutar.
- `docker.ps1` yerel Docker kanalını, OCI index ve platform manifestini ve gerçek kapsayıcı kimliğini ayrı kontrol eder. Ağsız, salt okunur, RAM sınırlı, log kapalı ve pull yasak PostgreSQL kapsayıcılarını yönetir. PostgREST sadece restore hedefinin ağ ad alanına ve loopback'e bağlanır.
- `runtime/` ortak exported snapshot yaşam döngüsünü, sequence ve global metadata karşılaştırmasını ve sabit SQL sorgularını içerir. Eklenti TOC kaydı doğrulanmış sürüm/şema/sahip alanlarıyla yeniden üretilir. Diğer TOC kayıtlarının sırası korunur. V6 özeti ve tarihsel katalog eşitliği zorunludur.
- `tests/` sentetik fixture'ları, negatif RAM kabulünü, makbuz sözleşmesini ve PostgREST sürücüsünü içerir. Bir modül değişince yapılandırmadaki özetini, ardından girişteki yapılandırma özetini güncelleyin. İlgili RAM testlerini ve yönetici kabulünü tekrar çalıştırın. Son olarak bağımsız yayımlanacak SHA-256 listesini yenileyin.
- Yeni giriş eski araçlardan kod yüklemez. Eski paketlerin tarihsel katalog sözleşmesi için iki sabit sorgu bilinçli olarak tutulur.

Yalnızca bu README değiştiğinde `SHA256SUMS` içindeki `atlas-recovery/README.md` satırını güncelleyin. Listenin yeni SHA-256 değerini bağımsız inceleme kaydında belgeleyin. Çalışma anında doğrulanan yapılandırma ve modül hash'leri bu belgeye bağlı değildir.

## Hata yönetimi

| Sonuç                             | İşlem                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `arguments` veya `staging_locked` | Modu, biçimi ve kimlikleri kullanım sözleşmesiyle karşılaştırın.                            |
| `recovery_code`                   | Kaynak ve yapılandırma hash'lerini inceleme kaydıyla karşılaştırın.                         |
| `storage_encryption`              | Windows hesabı, BitLocker, NTFS, ACL ve fiziksel yolları doğrulayın.                        |
| `runtime`                         | Yerel Docker bağlamı, tam digest, platform, swap ve core dump koşullarını kontrol edin.     |
| `package_verification`            | Özgün biçimi, kimlikleri ve bağımsız makbuzu kontrol edin. Paket dosyalarını değiştirmeyin. |
| `compatibility` veya `restore`    | Sabit hata sınıfını ve sentetik test aşamasını kaydedin. İzole sentetik hedefte inceleyin.  |
| `.pending-*` kaldı                | Tamamlanmamış alanı yayımlamayın. Temizlik belirsizse ACL koruması altında inceleyin.       |

## Dosya düzeni

```text
scripts/quality/
├── atlas-recovery.ps1
├── atlas-recovery/
│   ├── README.md
│   ├── SHA256SUMS
│   ├── docker.ps1
│   ├── packages.ps1
│   ├── recovery.config.json
│   ├── security.ps1
│   ├── runtime/
│   │   ├── archive.sh
│   │   ├── history-legacy.sql
│   │   ├── history.sql
│   │   ├── postgres.sh
│   │   ├── run.sh
│   │   ├── sequences.sql
│   │   └── summary.sql
│   └── tests/
│       ├── contracts.ps1
│       ├── general-fixture.sql
│       ├── legacy-checks.sh
│       ├── legacy-fixture.sql
│       ├── postgrest.mjs
│       └── regression.sh
├── repository-audit.mjs
├── staging-backup.ps1
├── staging-backup-logical-v4.ps1
├── staging-backup-logical-v5.ps1
├── staging-backup-logical-v5.1.ps1
├── staging-backup-recovery-v6.ps1
├── staging-backup-v6-catalog-diagnose.ps1
├── staging-backup-v6-local-compat.ps1
└── staging-restore-diagnose.ps1
```

`repository-audit.mjs` CI tarafından çağrılır. Tarihsel gerçek yedekler için V3–V6 araçları özgün konumlarında tutulur. V6 LOCAL uyumluluk aracı katalog tanı aracını, katalog tanı aracı da V6 recovery kaynağını aynı dizinden yükler. Format 4 üretim ve tanı varyantlarını koruyun. Bunları sadeleştirmek için üretici sürüm eşlemesi ve bağımsız restore kanıtı gerekir.

## V7, V8 ve prototip kaynak arşivi

Dokuz eski kaynak dosyası `D:\AtlasRecoverySourceArchive\39d078da65c0470db312a153b467d274` altında ayrı LOCAL kaynak arşivinde tutulur. Aşağıdaki özgün yollar depo köküne görelidir. Arşiv içindeki konumu ve beklenen SHA-256 değerini belirlemek için taşıma sırasında kaydedilen geri dönüş haritasını kullanın.

| Grup           | Özgün yollar                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V7             | `scripts/quality/atlas-recovery-v7.ps1`, `scripts/quality/atlas-recovery-v7/workflow.sh`                                                                                                                            |
| V8             | `scripts/quality/atlas-recovery-v8.ps1`, `scripts/quality/atlas-recovery-v8/workflow.sh`, `scripts/quality/atlas-recovery-v8/postgrest.mjs`                                                                         |
| LOCAL prototip | `scripts/quality/local-recovery-prototype.ps1`, `scripts/quality/local-recovery-prototype-postgrest.mjs`, `scripts/quality/local-recovery-prototype/run.sh`, `scripts/quality/local-recovery-prototype/history.sql` |

Eski uygulama kaynaklarına geri dönmek gerektiğinde:

1. Arşive yetkili Windows hesabıyla erişin. Arşiv ve hedef için sabit NTFS, etkin BitLocker, korumalı ACL ve fiziksel yolları doğrulayın. Yeniden ayrıştırma noktası, doğrulanamayan koruma veya yol çakışması varsa durun.
2. Dokuz dosyanın tamamını geri dönüş haritasıyla eşleştirin ve arşivdeki SHA-256 değerlerini taşıma kaydıyla karşılaştırın. Yol veya hash uyuşmazlığında durun.
3. Dosyaları özgün göreli yollarıyla ayrı, korumalı bir LOCAL çalışma kopyasına kopyalayın. Var olan bir hedef dosyanın üzerine yazmayın. Arşiv kopyasını koruyun ve hedefteki dokuz hash'i yeniden doğrulayın.
4. Eski zinciri incelemek için aynı `scripts/quality/` düzenindeki V6 recovery, katalog tanı ve LOCAL uyumluluk kaynaklarının hash'lerini eski araçlardaki sabit değerlerle karşılaştırın. Uyuşmazlık varsa zinciri çalıştırmayın.

Desteklenen eski sentetik paketleri doğrulamak veya restore etmek için birleşik girişteki `LegacyV7` ve `LegacyV8` biçimlerini kullanın. Kaynak arşivi eski uygulamanın incelenmesi veya geri alınması içindir.

## Kapsam sınırları

Vault eklenti ve katalog restore'u ayrı bir kontroldür. Vault anahtarı ve şifreli içerik kurtarması, otomatik yedekleme ve farklı bilgisayarda DPAPI makbuzu kurtarma doğrulanmadı. Rol parolaları, GoTrue, Storage dosyaları ve sağlayıcı ayarları bu PostgreSQL kabulünün kapsamı dışındadır. Gerçek STAGING kullanımı ayrı yetki, TLS ve bakım kanıtı, gerçek katalog kabulü, Vault anahtar prosedürü ve rollback planı gerektirir.

## Paket 2B silme kararı provası

`powershell -NoProfile -File scripts/quality/atlas-recovery.ps1 -Mode Compatibility -WithDeletionLedger` yalnız sentetik kimlikler kullanır. HMAC zinciri veri kümesini, sıra numarasını, önceki imzayı, işlem ve hesap UUID'sini bağlar. Makbuzlar özel ACL ve CreateNew/Flush ile tutulur. DPAPI CurrentUser anahtarı ve ayrı baş onayı dump'ın dışındadır. Kayıp onaydan sonra aynı talep yeniden doğrulanabilir. Beklenmeyen sıra, sahip, eksik kayıt, bozulma veya eski baş provayı durdurur. Tam uygulama şeması ve GoTrue/PostgREST denemesi [kalite belgesindeki](../../../docs/architecture/quality.md) izole servis koşusudur.

Prova aynı Windows cihazındaki iki ayrı dizini kullanır. Ürün için bağımsız tesis/hesapta tek yönlü ilerleyen onay, bağımsız saklama, denetlenebilir erişim, anahtar rotasyonu ve farklı makinede yetkili kurtarma gerekir. Aynı dizinler eski sürüme dönerse güncellik kanıtı kaybolur. Kararlar geri dönülebilen tüm yedeklerden uzun saklanmalıdır. Vault anahtarı, Auth sağlayıcı yapılandırması, Storage nesneleri, gerçek saklama politikası ve otomatik yedek henüz doğrulanmadı. Ürün silme ve doğrulanmamış hedefe trafik açma kapalı kalır.
