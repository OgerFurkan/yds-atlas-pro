import {
  type CefrLevel,
  type WordEntry,
  wordEntrySchema,
} from "../../../packages/shared/src/index";

export const fixtureSource = "LOCAL sentetik test fixture";
const date = "2026-01-01T00:00:00.000Z";
const tiers = ["easy", "easy", "medium", "yds", "yds"] as const;
const mockTranslationFocus: Record<string, readonly string[]> = {
  Assess: [
    "değerlendiririz",
    "değerlendirebilir",
    "değerlendirir",
    "değerlendirir",
    "değerlendirmek",
  ],
  Reliable: ["güvenilirdir", "Güvenilir", "güvenilir", "Güvenilir", "güvenilir"],
  Evidence: ["Kanıt", "kanıtı", "kanıt", "kanıtlar", "kanıtlar"],
  Decline: ["azalabilir", "azalır", "azalmaya", "azalmaya", "azalabilir"],
};

const samples: ReadonlyArray<{
  word: string;
  meaning: string;
  pos: string;
  cefr: CefrLevel;
  usage: string;
  examples: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    word: "Assess",
    meaning: "değerlendirmek",
    pos: "Verb",
    cefr: "B2",
    usage: "assess a risk / assess whether",
    examples: [
      ["We assess each answer.", "Her yanıtı değerlendiririz."],
      ["Can you assess this risk?", "Bu riski değerlendirebilir misin?"],
      [
        "Doctors assess the patient before recommending treatment.",
        "Doktorlar tedavi önermeden önce hastayı değerlendirir.",
      ],
      [
        "Researchers assess whether the improvement persists after the initial intervention.",
        "Araştırmacılar iyileşmenin ilk müdahaleden sonra sürüp sürmediğini değerlendirir.",
      ],
      [
        "To assess the policy fairly, analysts must account for regional differences.",
        "Analistler politikayı adil biçimde değerlendirmek için bölgesel farklılıkları hesaba katmalıdır.",
      ],
    ],
  },
  {
    word: "Reliable",
    meaning: "güvenilir",
    pos: "Adjective",
    cefr: "B1",
    usage: "a reliable source / reliable evidence",
    examples: [
      ["This clock is reliable.", "Bu saat güvenilirdir."],
      ["We need a reliable car.", "Güvenilir bir arabaya ihtiyacımız var."],
      [
        "The library offers reliable information about local history.",
        "Kütüphane yerel tarih hakkında güvenilir bilgi sunar.",
      ],
      [
        "A reliable estimate requires data collected under comparable conditions.",
        "Güvenilir bir tahmin, benzer koşullarda toplanmış veriler gerektirir.",
      ],
      [
        "Although the method is inexpensive, it may not produce reliable results in remote areas.",
        "Yöntem ucuz olsa da uzak bölgelerde güvenilir sonuçlar vermeyebilir.",
      ],
    ],
  },
  {
    word: "Evidence",
    meaning: "kanıt",
    pos: "Noun",
    cefr: "B2",
    usage: "Sayılamaz isim: evidence of / evidence that.",
    examples: [
      ["We found evidence.", "Kanıt bulduk."],
      ["She showed us the evidence.", "Bize kanıtı gösterdi."],
      [
        "There is little evidence that the new rule improved attendance.",
        "Yeni kuralın katılımı artırdığına dair çok az kanıt var.",
      ],
      [
        "The available evidence suggests that early intervention can reduce long-term costs.",
        "Mevcut kanıtlar erken müdahalenin uzun vadeli maliyetleri azaltabileceğini gösteriyor.",
      ],
      [
        "Unless further evidence emerges, the relationship should be interpreted with caution.",
        "Yeni kanıtlar ortaya çıkmadıkça ilişki ihtiyatla yorumlanmalıdır.",
      ],
    ],
  },
  {
    word: "Decline",
    meaning: "azalmak",
    pos: "Verb",
    cefr: "B2",
    usage: "decline by a percentage / decline over time",
    examples: [
      ["Prices may decline soon.", "Fiyatlar yakında azalabilir."],
      ["Sales usually decline in winter.", "Satışlar genellikle kışın azalır."],
      [
        "The number of visitors began to decline after the holiday.",
        "Ziyaretçi sayısı tatilden sonra azalmaya başladı.",
      ],
      [
        "If demand continues to decline, firms may reduce their investment in new equipment.",
        "Talep azalmaya devam ederse firmalar yeni ekipmana yaptıkları yatırımı azaltabilir.",
      ],
      [
        "Birth rates can decline even when access to public services improves.",
        "Kamu hizmetlerine erişim iyileşse bile doğum oranları azalabilir.",
      ],
    ],
  },
  {
    word: "Maintain",
    meaning: "sürdürmek",
    pos: "Verb",
    cefr: "B2",
    usage: "maintain a balance / maintain standards",
    examples: [
      ["Try to maintain your pace.", "Temponu sürdürmeye çalış."],
      ["We maintain regular contact.", "Düzenli iletişimimizi sürdürüyoruz."],
      [
        "Small businesses struggle to maintain stable prices during shortages.",
        "Küçük işletmeler kıtlık dönemlerinde istikrarlı fiyatları sürdürmekte zorlanır.",
      ],
      [
        "To maintain public trust, institutions must publish clear information about their decisions.",
        "Kurumlar kamu güvenini sürdürmek için kararları hakkında açık bilgi yayımlamalıdır.",
      ],
      [
        "Ecosystems can maintain their functions despite moderate changes in species composition.",
        "Ekosistemler tür bileşimindeki ılımlı değişimlere rağmen işlevlerini sürdürebilir.",
      ],
    ],
  },
  {
    word: "Adapt",
    meaning: "uyum sağlamak",
    pos: "Verb",
    cefr: "B2",
    usage: "adapt to new conditions",
    examples: [
      ["Plants adapt to the cold.", "Bitkiler soğuğa uyum sağlar."],
      ["I can adapt to change.", "Değişime uyum sağlayabilirim."],
      [
        "It took the students a month to adapt to the new schedule.",
        "Öğrencilerin yeni programa uyum sağlaması bir ay sürdü.",
      ],
      [
        "Species that cannot adapt to rapid warming may lose much of their habitat.",
        "Hızlı ısınmaya uyum sağlayamayan türler yaşam alanlarının büyük kısmını kaybedebilir.",
      ],
      [
        "The capacity to adapt often depends on how quickly information reaches local communities.",
        "Uyum sağlama kapasitesi çoğu zaman bilginin yerel topluluklara ne kadar hızlı ulaştığına bağlıdır.",
      ],
    ],
  },
  {
    word: "Benefit",
    meaning: "yarar",
    pos: "Noun",
    cefr: "B1",
    usage: "a benefit of something / for the benefit of someone",
    examples: [
      ["This is a clear benefit.", "Bu açık bir yarardır."],
      ["Better sleep is one benefit.", "Daha iyi uyku yararlardan biridir."],
      [
        "A major benefit of cycling is that it reduces traffic.",
        "Bisiklete binmenin önemli bir yararı trafiği azaltmasıdır.",
      ],
      [
        "The main benefit of early screening is that it allows treatment to begin before symptoms worsen.",
        "Erken taramanın temel yararı, belirtiler kötüleşmeden tedavinin başlamasını sağlamasıdır.",
      ],
      [
        "Whether the benefit outweighs the cost depends on how widely the program is adopted.",
        "Yararın maliyetten ağır basıp basmadığı programın ne kadar yaygın benimsendiğine bağlıdır.",
      ],
    ],
  },
  {
    word: "Reduce",
    meaning: "azaltmak",
    pos: "Verb",
    cefr: "B1",
    usage: "reduce something by a stated amount / reduce something to a target",
    examples: [
      ["Please reduce the volume.", "Lütfen sesi azalt."],
      ["We want to reduce waste.", "Atığı azaltmak istiyoruz."],
      [
        "Taking the train can reduce the cost of commuting.",
        "Trene binmek işe gidip gelme maliyetini azaltabilir.",
      ],
      [
        "Improved insulation can reduce energy consumption without making homes less comfortable.",
        "Daha iyi yalıtım, evlerin konforunu düşürmeden enerji tüketimini azaltabilir.",
      ],
      [
        "Measures intended to reduce inequalities are more effective when local needs are considered.",
        "Eşitsizlikleri azaltmayı amaçlayan önlemler, yerel ihtiyaçlar dikkate alındığında daha etkilidir.",
      ],
    ],
  },
  {
    word: "Prevent",
    meaning: "önlemek",
    pos: "Verb",
    cefr: "B1",
    usage: "prevent something / prevent someone from doing something",
    examples: [
      ["Hats help prevent sunburn.", "Şapkalar güneş yanığını önlemeye yardımcı olur."],
      ["The lock can prevent theft.", "Kilit hırsızlığı önleyebilir."],
      [
        "Regular checks can prevent small faults from becoming serious.",
        "Düzenli kontroller küçük arızaların ciddileşmesini önleyebilir.",
      ],
      [
        "Governments may need to coordinate their efforts to prevent water shortages during prolonged droughts.",
        "Hükûmetlerin uzun süreli kuraklıklarda su kıtlığını önlemek için çabalarını koordine etmesi gerekebilir.",
      ],
      [
        "Even strict rules cannot prevent every accident unless they are consistently enforced.",
        "En katı kurallar bile tutarlı biçimde uygulanmadıkça her kazayı önleyemez.",
      ],
    ],
  },
  {
    word: "Approach",
    meaning: "yaklaşım",
    pos: "Noun",
    cefr: "B2",
    usage: "an approach to a problem / a flexible approach",
    examples: [
      ["I like your approach.", "Yaklaşımını beğeniyorum."],
      ["We tried a new approach.", "Yeni bir yaklaşım denedik."],
      [
        "Her approach to teaching gives students more time to ask questions.",
        "Öğretime yaklaşımı öğrencilere soru sormak için daha fazla zaman tanır.",
      ],
      [
        "An approach that works in densely populated cities may be impractical in rural areas.",
        "Yoğun nüfuslu şehirlerde işe yarayan bir yaklaşım kırsal bölgelerde uygulanabilir olmayabilir.",
      ],
      [
        "The proposed approach would enable hospitals to share resources without losing their independence.",
        "Önerilen yaklaşım hastanelerin bağımsızlıklarını kaybetmeden kaynak paylaşmasını sağlayacaktır.",
      ],
    ],
  },
  {
    word: "Contribute",
    meaning: "katkıda bulunmak",
    pos: "Verb",
    cefr: "B2",
    usage: "contribute to a result / contribute something to a project",
    examples: [
      ["Everyone can contribute.", "Herkes katkıda bulunabilir."],
      ["I want to contribute to the project.", "Projeye katkıda bulunmak istiyorum."],
      [
        "Several local farms contribute to the school meal program.",
        "Birkaç yerel çiftlik okul yemek programına katkıda bulunuyor.",
      ],
      [
        "Reliable transport networks contribute to economic growth by connecting workers with employers.",
        "Güvenilir ulaşım ağları çalışanları işverenlerle buluşturarak ekonomik büyümeye katkıda bulunur.",
      ],
      [
        "Even modest investments can contribute to substantial improvements if they are carefully targeted.",
        "Dikkatle yönlendirildiklerinde sınırlı yatırımlar bile önemli iyileşmelere katkıda bulunabilir.",
      ],
    ],
  },
  {
    word: "Require",
    meaning: "gerektirmek",
    pos: "Verb",
    cefr: "B1",
    usage: "require effort / require someone to do something",
    examples: [
      ["These plants require water.", "Bu bitkiler su gerektirir."],
      ["The files require a password.", "Dosyalar bir parola gerektirir."],
      [
        "Both positions require experience with children.",
        "Her iki pozisyon da çocuklarla çalışma deneyimi gerektirir.",
      ],
      [
        "Accurate comparisons require the same measurements to be taken at each site.",
        "Doğru karşılaştırmalar her sahada aynı ölçümlerin yapılmasını gerektirir.",
      ],
      [
        "Efforts to restore damaged wetlands often require cooperation among several institutions.",
        "Zarar görmüş sulak alanları onarma çabaları çoğu zaman birkaç kurum arasında iş birliği gerektirir.",
      ],
    ],
  },
  {
    word: "Increase",
    meaning: "artırmak",
    pos: "Verb",
    cefr: "B1",
    usage: "increase something by an amount / increase access to something",
    examples: [
      ["Please increase the light.", "Lütfen ışığı artır."],
      ["They want to increase sales.", "Satışları artırmak istiyorlar."],
      [
        "The school plans to increase the number of afternoon classes.",
        "Okul öğleden sonraki derslerin sayısını artırmayı planlıyor.",
      ],
      [
        "Expanding internet access can increase participation in education among people who live far from universities.",
        "İnternet erişimini genişletmek üniversitelerden uzakta yaşayanların eğitime katılımını artırabilir.",
      ],
      [
        "Policies designed to increase productivity should also consider workers' health.",
        "Üretkenliği artırmak üzere tasarlanan politikalar çalışanların sağlığını da dikkate almalıdır.",
      ],
    ],
  },
  {
    word: "Determine",
    meaning: "belirlemek",
    pos: "Verb",
    cefr: "B2",
    usage: "determine the cause / determine whether",
    examples: [
      ["We must determine the cause.", "Nedeni belirlemeliyiz."],
      ["Can you determine the size?", "Boyutu belirleyebilir misin?"],
      [
        "Doctors ran several tests to determine the source of the pain.",
        "Doktorlar ağrının kaynağını belirlemek için birkaç test yaptı.",
      ],
      [
        "Further studies are needed to determine whether the findings apply to different populations.",
        "Bulguların farklı nüfus grupları için geçerli olup olmadığını belirlemek için daha fazla çalışma gerekiyor.",
      ],
      [
        "The availability of clean water can determine where settlements develop.",
        "Temiz suyun bulunabilirliği yerleşimlerin nerede gelişeceğini belirleyebilir.",
      ],
    ],
  },
  {
    word: "Significant",
    meaning: "önemli",
    pos: "Adjective",
    cefr: "B2",
    usage: "a significant change / significant differences",
    examples: [
      ["That was a significant change.", "Bu önemli bir değişimdi."],
      ["The cost is significant.", "Maliyet önemli."],
      [
        "The team made significant progress despite the delays.",
        "Ekip gecikmelere rağmen önemli ilerleme kaydetti.",
      ],
      [
        "A significant proportion of the population still lacks access to affordable transport.",
        "Nüfusun önemli bir bölümü hâlâ uygun fiyatlı ulaşıma erişemiyor.",
      ],
      [
        "Researchers identified significant differences in outcomes between urban and rural schools.",
        "Araştırmacılar kent ve kırsal bölge okullarının sonuçları arasında önemli farklılıklar belirledi.",
      ],
    ],
  },
  {
    word: "Expand",
    meaning: "genişletmek",
    pos: "Verb",
    cefr: "B2",
    usage: "expand a service / expand access",
    examples: [
      ["We can expand the room.", "Odayı genişletebiliriz."],
      ["They plan to expand the shop.", "Dükkânı genişletmeyi planlıyorlar."],
      [
        "The library will expand its services to nearby villages.",
        "Kütüphane hizmetlerini yakın köylere genişletecek.",
      ],
      [
        "Public investment can expand access to health care in areas that private clinics do not serve.",
        "Kamu yatırımı özel kliniklerin hizmet vermediği bölgelerde sağlık hizmetlerine erişimi genişletebilir.",
      ],
      [
        "Institutions seeking to expand their programs may need to recruit staff before they can accept more students.",
        "Programlarını genişletmek isteyen kurumların daha fazla öğrenci kabul etmeden önce personel alması gerekebilir.",
      ],
    ],
  },
  {
    word: "Preserve",
    meaning: "korumak",
    pos: "Verb",
    cefr: "B2",
    usage: "preserve something for future generations",
    examples: [
      ["We should preserve old maps.", "Eski haritaları korumalıyız."],
      ["Trees help preserve the soil.", "Ağaçlar toprağın korunmasına yardımcı olur."],
      [
        "The museum works to preserve photographs of the town.",
        "Müze kasabanın fotoğraflarını korumak için çalışıyor.",
      ],
      [
        "Conservation programs can preserve biodiversity while supporting the livelihoods of nearby communities.",
        "Koruma programları çevredeki toplulukların geçim kaynaklarını desteklerken biyolojik çeşitliliği koruyabilir.",
      ],
      [
        "To preserve digital records, organizations must regularly update their storage systems.",
        "Kuruluşlar dijital kayıtları korumak için depolama sistemlerini düzenli olarak güncellemelidir.",
      ],
    ],
  },
  {
    word: "Establish",
    meaning: "kurmak",
    pos: "Verb",
    cefr: "B2",
    usage: "establish an institution / establish a network",
    examples: [
      ["They want to establish a club.", "Bir kulüp kurmak istiyorlar."],
      ["We can establish a new team.", "Yeni bir ekip kurabiliriz."],
      [
        "The volunteers raised money to establish a community garden.",
        "Gönüllüler bir topluluk bahçesi kurmak için para topladı.",
      ],
      [
        "Several universities decided to establish a shared archive to make historical documents easier to consult.",
        "Birkaç üniversite, tarihî belgelerin incelenmesini kolaylaştırmak için ortak bir arşiv kurmaya karar verdi.",
      ],
      [
        "Countries that establish independent review bodies may improve public confidence in official decisions.",
        "Bağımsız inceleme kurumları kuran ülkeler resmî kararlara duyulan güveni artırabilir.",
      ],
    ],
  },
  {
    word: "Efficient",
    meaning: "verimli",
    pos: "Adjective",
    cefr: "B2",
    usage: "an efficient process / energy-efficient equipment",
    examples: [
      ["This machine is efficient.", "Bu makine verimlidir."],
      ["Our new system is efficient.", "Yeni sistemimiz verimli."],
      [
        "An efficient bus service makes it easier to reach the city centre.",
        "Verimli bir otobüs hizmeti şehir merkezine ulaşmayı kolaylaştırır.",
      ],
      [
        "An efficient irrigation system can maintain crop yields while using substantially less water.",
        "Verimli bir sulama sistemi çok daha az su kullanarak mahsul verimini sürdürebilir.",
      ],
      [
        "Identifying the most efficient procedure requires measuring both the time and the resources each option consumes.",
        "En verimli işlemi belirlemek her seçeneğin harcadığı zamanı ve kaynakları ölçmeyi gerektirir.",
      ],
    ],
  },
  {
    word: "Outcome",
    meaning: "sonuç",
    pos: "Noun",
    cefr: "B2",
    usage: "the outcome of an event / a positive outcome",
    examples: [
      ["We hope for a good outcome.", "İyi bir sonuç umuyoruz."],
      ["What was the outcome?", "Sonuç neydi?"],
      [
        "The outcome of the meeting surprised everyone in the room.",
        "Toplantının sonucu odadaki herkesi şaşırttı.",
      ],
      [
        "The outcome depends partly on whether local authorities can sustain the program after funding ends.",
        "Sonuç kısmen, finansman bittikten sonra yerel yönetimlerin programı sürdürüp sürdüremeyeceğine bağlıdır.",
      ],
      [
        "Because the outcome was measured only once, the researchers could not draw conclusions about long-term effects.",
        "Sonuç yalnızca bir kez ölçüldüğü için araştırmacılar uzun vadeli etkiler hakkında çıkarım yapamadı.",
      ],
    ],
  },
];

function fixtureId(index: number) {
  return `f17e0000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export const readyDayWords: WordEntry[] = samples.map((sample, index) =>
  wordEntrySchema.parse({
    id: fixtureId(index + 1),
    word: sample.word,
    meanings: [sample.meaning],
    usageNote: sample.usage,
    partOfSpeech: sample.pos,
    cefr: sample.cefr,
    examples: sample.examples.map(([sentence, translation], slot) => ({
      sentence,
      translation,
      difficulty: tiers[slot],
      source: fixtureSource,
      ...(mockTranslationFocus[sample.word] && {
        translationFocus: [mockTranslationFocus[sample.word][slot]],
      }),
    })),
    createdAt: date,
    updatedAt: date,
  }),
);

export const incompleteDayWords = readyDayWords.slice(0, 4).map((word, index) => ({
  ...word,
  id: fixtureId(101 + index),
  meanings: [],
  examples: [],
}));

/**
 * LOCAL scenario: the same 20 ready words, with the first five already learned.
 * It keeps the same IDs so loading another variant never duplicates records.
 */
export const partiallyLearnedDayWords: WordEntry[] = readyDayWords.map((word, index) =>
  index < 5 ? { ...word, score: 90 } : word,
);
