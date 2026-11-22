import type { WordInput } from "@yds-atlas/shared";
import { wordKey } from "../model/word-normalization";

/** Editor-reviewed starting corrections for examples visible in the PO's QA screenshots.
 * Never auto-writes a user's records. The explicit library upgrade flow may use them.
 */
const EXAMPLES: Record<string, readonly (readonly [string, string, string])[]> = {
  subsequent: [
    [
      "We had a subsequent meeting on Monday.",
      "Pazartesi günü sonraki bir toplantı yaptık.",
      "sonraki",
    ],
    ["The subsequent day was sunny.", "Ertesi gün güneşliydi.", "Ertesi"],
    [
      "Subsequent tests showed better results.",
      "Sonraki testler daha iyi sonuçlar gösterdi.",
      "Sonraki",
    ],
    [
      "The initial findings were inconclusive, whereas subsequent analyses revealed a consistent pattern.",
      "İlk bulgular kesin değildi, oysa sonraki analizler tutarlı bir örüntü ortaya koydu.",
      "sonraki",
    ],
    [
      "Any subsequent amendments to the regulation must be evaluated in light of their potential socioeconomic consequences.",
      "Yönetmelikte yapılacak sonraki tüm değişiklikler, olası sosyoekonomik sonuçları ışığında değerlendirilmelidir.",
      "sonraki",
    ],
  ],
  mitigate: [
    ["Trees can mitigate summer heat.", "Ağaçlar yaz sıcağını hafifletebilir.", "hafifletebilir"],
    ["This medicine may mitigate the pain.", "Bu ilaç ağrıyı hafifletebilir.", "hafifletebilir"],
    [
      "Better planning can mitigate the risks of flooding.",
      "Daha iyi planlama sel risklerini azaltabilir.",
      "azaltabilir",
    ],
    [
      "Although renewable energy cannot eliminate emissions overnight, it can significantly mitigate the long-term effects of climate change.",
      "Yenilenebilir enerji emisyonları bir gecede ortadan kaldıramasa da iklim değişikliğinin uzun vadeli etkilerini önemli ölçüde hafifletebilir.",
      "hafifletebilir",
    ],
    [
      "Policymakers must assess whether targeted subsidies can mitigate the disproportionate burden of inflation on low-income households.",
      "Politika yapıcılar hedefli sübvansiyonların enflasyonun düşük gelirli haneler üzerindeki orantısız yükünü hafifletip hafifletemeyeceğini değerlendirmelidir.",
      "hafifletip",
    ],
  ],
  deteriorate: [
    ["The weather may deteriorate tonight.", "Hava bu gece kötüleşebilir.", "kötüleşebilir"],
    ["The road began to deteriorate.", "Yol bozulmaya başladı.", "bozulmaya"],
    [
      "Without regular maintenance, the building will deteriorate quickly.",
      "Düzenli bakım yapılmazsa bina hızla yıpranacaktır.",
      "yıpranacaktır",
    ],
    [
      "If preventive measures are delayed, environmental conditions may deteriorate to the point where recovery becomes prohibitively expensive.",
      "Önleyici tedbirler gecikirse çevresel koşullar, iyileştirmenin aşırı pahalı hâle geldiği noktaya kadar kötüleşebilir.",
      "kötüleşebilir",
    ],
    [
      "Despite initial improvements, relations between the two countries continued to deteriorate as disagreements over trade intensified.",
      "Başlangıçtaki iyileşmelere rağmen iki ülke arasındaki ilişkiler, ticaret konusundaki anlaşmazlıklar yoğunlaştıkça kötüleşmeye devam etti.",
      "kötüleşmeye",
    ],
  ],
  facilitate: [
    ["Maps facilitate travel.", "Haritalar seyahati kolaylaştırır.", "kolaylaştırır"],
    ["Good notes facilitate learning.", "İyi notlar öğrenmeyi kolaylaştırır.", "kolaylaştırır"],
    [
      "The new system will facilitate communication between departments.",
      "Yeni sistem bölümler arasındaki iletişimi kolaylaştıracak.",
      "kolaylaştıracak",
    ],
    [
      "International cooperation can facilitate the exchange of scientific data, thereby accelerating research on emerging diseases.",
      "Uluslararası iş birliği, bilimsel veri alışverişini kolaylaştırarak yeni ortaya çıkan hastalıklarla ilgili araştırmaları hızlandırabilir.",
      "kolaylaştırarak",
    ],
    [
      "By reducing administrative obstacles, the reforms are expected to facilitate access to education in underserved regions.",
      "İdari engelleri azaltan reformların, yeterince hizmet almayan bölgelerde eğitime erişimi kolaylaştırması beklenmektedir.",
      "kolaylaştırması",
    ],
  ],
  supplant: [
    [
      "An app may supplant a paper calendar.",
      "Bir uygulama kâğıt takvimin yerini alabilir.",
      "yerini alabilir",
    ],
    [
      "A new leader will supplant the old one.",
      "Yeni bir lider eskisinin yerini alacak.",
      "yerini alacak",
    ],
    [
      "Digital payments are beginning to supplant cash in some cities.",
      "Dijital ödemeler bazı şehirlerde nakdin yerini almaya başlıyor.",
      "yerini almaya",
    ],
    [
      "While automation may supplant certain repetitive tasks, it is unlikely to eliminate the need for human judgment in complex decisions.",
      "Otomasyon bazı tekrarlanan görevlerin yerini alabilse de karmaşık kararlarda insan muhakemesine duyulan ihtiyacı ortadan kaldırması pek olası değildir.",
      "yerini alabilse",
    ],
    [
      "Alternative energy technologies are increasingly expected to supplant fossil-fuel-based systems as storage costs decline.",
      "Depolama maliyetleri düştükçe alternatif enerji teknolojilerinin fosil yakıta dayalı sistemlerin yerini giderek daha fazla alması beklenmektedir.",
      "yerini giderek daha fazla alması",
    ],
  ],
  dismiss: [
    ["The boss may dismiss the worker.", "Patron çalışanı işten çıkarabilir.", "işten çıkarabilir"],
    ["Do not dismiss her idea.", "Onun fikrini hemen göz ardı etme.", "göz ardı etme"],
    [
      "The judge decided to dismiss the case because there was not enough evidence.",
      "Yargıç yeterli kanıt olmadığı için davayı düşürmeye karar verdi.",
      "davayı düşürmeye",
    ],
    [
      "The committee refused to dismiss the concerns raised by researchers, despite pressure to accelerate the approval process.",
      "Komite, onay sürecini hızlandırma baskısına rağmen araştırmacıların dile getirdiği endişeleri göz ardı etmeyi reddetti.",
      "göz ardı etmeyi",
    ],
    [
      "Courts may dismiss a claim when the available evidence fails to establish a sufficient legal basis.",
      "Mahkemeler, mevcut kanıtlar yeterli hukuki dayanak oluşturmadığında bir iddiayı reddedebilir.",
      "reddedebilir",
    ],
  ],
};
const TIERS = ["easy", "easy", "medium", "yds", "yds"] as const;
export const CURATED_LEGACY_WORDS = Object.freeze(Object.keys(EXAMPLES));

export function curatedLegacyExamples(word: string): WordInput | null {
  const items = EXAMPLES[wordKey(word)];
  if (!items || items.length !== 5) return null;
  return {
    word,
    examples: items.map(([sentence, translation, focus], index) => ({
      sentence,
      translation,
      translationFocus: [focus],
      difficulty: TIERS[index],
      source: "Atlas editoryal · 2026-11-20",
    })),
  };
}
