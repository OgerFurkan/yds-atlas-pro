# Günlük Görev

Uygulamanın ana kelime öğrenme oyunudur. Ana sayfadaki günlük hedef düğmesi ve Öğren > Günlük Görev menüsünden açılır. Atlas AI rotası olarak adlandırılmaz.

## Hazırlık

Hedef varsayılan 20 kelimedir; 10–100 arasında 10'un katlarıyla ayarlanabilir. Ana sayfadaki “Hedefi düzenle” penceresi günlük hedefi, hazırlık ekranındaki seçim ise o görevin kelime sayısını belirler.

Üç kelime kaynağı vardır:

1. **Hazır liste:** 20 kelime, Türkçe anlamlar ve her kelime için Türkçe çevirili beş özgün İngilizce örnek.
2. **Kütüphanem:** Anlamı ve en az beş kullanılabilir örneği olan, henüz öğrenilmemiş kayıtlar.
3. **Kendi listem:** Kullanıcı liste yazar, yazım denetimini çalıştırır, önerileri inceler ve listeyi kullanır. Yeni kayıtlar kütüphaneye eklenir; tekrarlar atlanır. Eksik bilgiler kütüphaneden tamamlanır.

Kullanıcı 5'li veya 10'lu gruplar seçer. Görevin özeti hedefi, hazır kelimeleri ve grup sayısını gösterir. Yetersiz kelime varsa kısa görev açıkça ayrı bir seçenek olarak sunulur.

Hazır setin 100 cümlesi ve çevirileri editoryal içeriktir; Cambridge alıntısı veya canlı AI çıktısı değildir. Sözlük bağlantıları yalnızca ilgili sayfayı açar.

## Her grup

1. **Keşfet:** Atlas markalı kart, iki yüz arasında 3B dönüş animasyonuyla çevrilir. Tekrar tıklanarak ön yüze dönülür; azaltılmış hareket tercihinde animasyon kullanılmaz. İlk çevirme tamamlanınca anlam, Verb/Noun gibi kelime türü, CEFR, kullanım notu, telaffuz ve çevrilmiş örnek görünür. Odak kelime İngilizcede ve Türkçe çeviride kalın/eğik vurgulanır. Türkçe karşılığın cümledeki çekimli biçimi, örnek verisindeki isteğe bağlı translationFocus alanında tutulur. Eski kayıtlar, aynı örnek ve çeviriyle eşleşiyorsa başlangıç setinin vurgusunu kullanır. Kartta “Tekrar göreyim” yoktur; kullanıcı “Bir sonraki kelime” ile ilerler.
2. **Eşleştir:** Gruptaki kelimeler en fazla beşli setlerde Türkçe anlamlarıyla eşleştirilir. Bu alıştırma genel değerlendirme puanını değiştirmez.
3. **Anlamı bul:** Kullanıcı kelimenin Türkçe anlamını seçer. Çeldiriciler öncelikle grup dışındaki kelimelerden seçilir. Yanlış cevaptan sonra doğru anlam ve kullanım açıklanır; kelime yeniden sorulur.
4. **Bağlamda öğren:** Örnek cümlede boş bırakılan kelime bulunur. Çeldiriciler öncelikle grup dışındaki kelimelerden seçilir. Yanlışlar başka örnekle yeniden sorulur. Bütün kelimeler doğru yapıldığında sonraki gruba geçilir.

Doğru geri bildirimi yeşil, yanlış geri bildirimi kırmızıdır. Yanlış cevapta seçilen ve doğru yanıt karşılaştırılır. Her ikisinde kullanım notu, tam örnek, Türkçe çeviri ve telaffuz kontrolleri gösterilir. Sıraya ekleme gibi oyun motoru ayrıntıları kullanıcıya yazılmaz.

## Genel değerlendirme

Bütün gruplar bitince üç aşama başlar:

1. **Eşleştir:** En fazla beş İngilizce kelime ile karıştırılmış Türkçe karşılıkları iki sütunda gösterilir. İki taraftan da başlanabilir. Doğru çift yeşille sabitlenir; yanlış çift kırmızıyla ve doğru karşılıklarıyla açıklanır. Kullanıcı “Yeniden dene” ile devam eder. Yanlış deneme, karıştırılan her iki kelimenin değerlendirmesine bir kez işlenir. Aynı Türkçe anlama sahip kelimeler ayrı setlere alınır. Bütün çiftler tamamlanmadan sonraki sete geçilmez.
2. **Anlamı hatırla:** Bütün kelimeler birer kez sorulur.
3. **Cümlede kullan:** Bütün kelimeler bağlam sorusunda birer kez sorulur.

Anlam ve bağlam aşamalarındaki yanlışlar tekrar edilmez. Doğru yanıttan sonra “Zor hatırladım / Hatırladım / Kolay hatırladım” geri bildirimi alınır; renkleri sırasıyla kırmızı, amber ve yeşildir.

Kullanıcıya oyun sırasında veya sonuç ekranında sayısal kelime puanı ve hesaplama gösterilmez. Sonuç ekranı üç öğrenme grubunu, kelimeleri ve anlamlarını gösterir. Puan, kütüphanede görülebilir.

### Dahili puan kuralları

Öğrenme turları puanı değiştirmez. Yeni görevlerde kelimenin son değerlendirmesi önceki puana eklenmez; o görevde ölçülen bilgiye göre 0–100 arasında yeniden hesaplanır. Böylece art arda görev yaparak puan biriktirmek, eksik öğrenilmiş bir kelimeyi öğrenilmiş göstermez.

| Aşama      |                                                                  Katkı |
| ---------- | ---------------------------------------------------------------------: |
| Eşleştirme | Hatasız 20; kelimenin karıştığı her yanlış çift için 10 düşer, en az 0 |
| Anlam      |                                       Doğruysa en fazla 30; yanlışsa 0 |
| Bağlam     |                                       Doğruysa en fazla 50; yanlışsa 0 |

Doğru anlam ve bağlam yanıtlarına hatırlama katsayısı uygulanır: zor 0,60; hatırladım 0,85; kolay 1,00. Son toplam bir kez tam sayıya yuvarlanır. Hatasız eşleştirme ve iki kolay doğru yanıt 100; iki normal doğru yanıt 88; iki zor doğru yanıt 68 verir. Anlamı yanlış olan kelime en fazla 70, bağlamı yanlış olan kelime en fazla 50 alabilir.

Önceki sürümden yarım kalmış v2 görevler eski iki değerlendirme aşaması ve eski puan kurallarıyla tamamlanır: anlam doğru +20/yanlış −50, bağlam doğru +40/yanlış −30; doğru cevapta zor −10, normal 0, kolay +20; önceki puanla toplam 0–100'e sınırlandırılır. Yeni v3 görevler eşleştirmeyle başlar. Aynı depolama anahtarı korunur ve eski kayıtlar silinmez.

- 0–39: Zorlanılan.
- 40–79: Tekrar gerektiren.
- 80–100: Öğrenilen.

Grup ayrı bir veri alanı olarak tutulmaz; daima güncel puandan türetilir.

## Sonuçlar, günlük hedef ve seri

Genel değerlendirme bittiğinde sonuçlar otomatik kaydedilir. Kaydetme başarısız olursa hata ve yeniden deneme düğmesi görünür. Mutlak puan yazıldığı için yeniden denemek aynı puanı iki kez eklemez. Silinen kayıtlar tekrar oluşturulmaz.

Günlük ilerleme, o gün tamamlanan görevlerdeki benzersiz kelimeleri sayar. Günlük hedef tamamlanınca gün başarı kaydına eklenir. Günlük seri ve rekor bu günlerden hesaplanır. Henüz tamamlanmamış bugün, dünkü seriyi hemen sıfırlamaz; arada tamamlanmadan geçmiş bir gün varsa seri yeniden başlar. Tarihler Europe/Istanbul'a göredir.

Oturum sırası, cevap, geri bildirim, eşleştirme seti/sütun sırası/seçimler/hatalar ve kelime anlık görüntüleri tarayıcıda saklanır. Ara verilebilir ve yenilemeden sonra devam edilebilir.

## İki ayrı etkileşimli rehber

- **Hazırlık rehberi:** 11 adım. Kaynaklar, hazır liste, kütüphane, animasyonla örnek liste yazma, yazım denetimi, düzeltme önerisine tıklama, listeyi kullanma, hedef, grup seçimi ve görev özeti.
- **Oyunu dene:** 28 adım. İlerleme, kartı iki yöne çevirme, kelime bilgisi, ses dinleme, çevrilmiş örnek, sonraki kelime, kasıtlı yanlış deneme, açıklama, yeniden deneme, doğru yanıt, bağlam, eşleştirmeyi uygulama ve üç aşamalı genel değerlendirme.

Rehberlerde Driver.js ile ekran karartılır ve ilgili alan vurgulanır. Hazır liste ve kütüphane açıklamalarında sekme çubuğu ile açıklama aynı odak alanındadır; seçili sekme görünür kalır. Eylem adımlarında devam için gerçek kontrole tıklamak gerekir; hareketli işaret gerçek eylem düğmesinin merkezine bağlanır; işaretin ucu animasyon sırasında yerinden kaymaz. Kullanıcı rehberi kapatabilir. Azaltılmış hareket tercihi dikkate alınır. Rehberler kütüphaneyi, gerçek oturumu ve günlük seriyi değiştirmez.

## Telaffuz ve entegrasyon sınırları

UK/US ses URL'si varsa o dosya oynatılır. Yoksa cihazın SpeechSynthesis sesi kullanılır; en-GB/en-US aksanının bulunması cihazın yüklü seslerine bağlıdır. Kontrol oynatma sırasında durdurma durumuna dönüşür; hata görünür olarak bildirilir. Rehber, telaffuz adımından ancak sesin end/ended olayıyla ilerler. Kullanıcının durdurması adımı tamamlamaz. Ses hatasında yeniden deneme ve açıkça seçilen sessiz devam seçeneği vardır.

Supabase Auth ve Bun API ile hesap, kelime ve görev/sonuç kaydı eklenmiştir; canlı proje yapılandırması sonraki bağlantı aşamasındadır. Gemini kelime önerileri ayrı bir inceleme akışındadır. Canlı sözlük, AI kelime seçimi ve serbest bağlam seçeneklerinin tam anlamsal doğrulaması sonraki aşamadır. [Kurulum ve sınırlar](backend.md).
