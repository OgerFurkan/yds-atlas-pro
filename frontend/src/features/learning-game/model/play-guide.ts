import type { GuideStep } from "@/shared/ui/guided-tour";

export const playGuide: GuideStep[] = [
  {
    id: "progress",
    target: "#game-progress",
    title: "Nerede olduğunu buradan takip et",
    description:
      "Önce kelimeleri keşfeder, sonra anlam ve bağlam sorularını çözersin. Her grup bitince sonraki gruba geçilir. En sonda bütün kelimelerle genel değerlendirme yapılır. Şimdi tek kelimelik bir deneme yapacağız.",
  },
  {
    id: "flip",
    target: "#atlas-card-flip",
    title: "Kartı kendin çevir",
    description:
      "Bu senin Atlas kartın. Ön yüzünde İngilizce kelime var. Karta tıkla; dönerken arka yüzündeki anlamı keşfet.",
    action: true,
  },
  {
    id: "information",
    target: "#word-information",
    title: "Kelimeyi tanı",
    description:
      "Başlığın altında kelime türü ve seviyesi bulunur. Verb fiil, Noun isim demektir. Türkçe anlamın altındaki not, kelimenin hangi anlamda kullanıldığını açıklar.",
  },
  {
    id: "turn-front",
    target: "#atlas-card-flip",
    title: "Kartın önüne geri dön",
    description:
      "Bir kez daha karta tıkla. Anlamı kapatıp İngilizce kelimeye bakarak kendini yoklayabilirsin. Kartı istediğin kadar çevirebilirsin.",
    action: true,
  },
  {
    id: "turn-back",
    target: "#atlas-card-flip",
    title: "Arka yüzü yeniden aç",
    description:
      "Tekrar tıkla ve anlamı aç. Bir kez keşfettiğin kelimenin telaffuzu ve örneği kartın altında kalır.",
    action: true,
  },
  {
    id: "pronounce",
    target: "#word-pronunciation",
    actionTarget: "#pronunciation-uk",
    title: "Telaffuzunu dinle",
    description:
      "UK veya US düğmesine tıkla ve kelimeyi sonuna kadar dinle. Oynatırken düğme durdurma kontrolüne dönüşür. Ses tamamlandığında rehber devam edecek.",
    action: true,
  },
  {
    id: "example",
    target: "#word-example",
    title: "İngilizce ve Türkçe birlikte",
    description:
      "Odak kelime hem İngilizce örnekte hem Türkçe karşılığında kalın ve eğik yazılır. İki cümleyi karşılaştırarak kelimenin bu bağlamdaki kullanımını düşün.",
  },
  {
    id: "next-card",
    target: "#flashcard-next",
    title: "Hazırsan sonraki kelime",
    description:
      "Bir sonraki kelime düğmesine bas. Bu denemede tek kelime olduğu için doğrudan anlam sorusuna geçeceğiz.",
    action: true,
  },
  {
    id: "wrong",
    target: "#choice-wrong",
    title: "Yanlış cevapta ne olur?",
    description:
      "Bu kez nasıl açıklama verildiğini görmek için vurgulanan yanlış seçeneğe tıkla. Bu sadece bir prova.",
    action: true,
  },
  {
    id: "wrong-feedback",
    target: "#answer-feedback",
    title: "Yanlışını açıklamayla öğren",
    description:
      "Kırmızı alan, senin yanıtınla doğru yanıtı karşılaştırır. Anlam, kullanım notu ve çevrilmiş örnek burada birlikte görünür. Bir sonraki adımda kelimeyi yeniden deneyeceğiz.",
  },
  {
    id: "retry",
    target: "#question-next",
    title: "Bir kez daha deneyelim",
    description: "Devam et düğmesine bas ve soruyu yeniden gör.",
    action: true,
  },
  {
    id: "correct",
    target: "#choice-correct",
    title: "Şimdi doğru anlamı seç",
    description: "Expand, burada genişlemek anlamına geliyor. Vurgulanan doğru seçeneğe tıkla.",
    action: true,
  },
  {
    id: "correct-feedback",
    target: "#answer-feedback",
    title: "Doğru cevabın da açıklaması var",
    description:
      "Yeşil alan doğru eşleştirmeyi gösterir. Örneği ve çeviriyi tekrar inceleyebilir, kelimeyi dinleyebilirsin.",
  },
  {
    id: "to-context",
    target: "#question-next",
    title: "Bağlam sorusuna geç",
    description: "Devam et ile kelimeyi bu kez cümle içinde kullanacağız.",
    action: true,
  },
  {
    id: "context",
    target: "#question-sentence",
    title: "Boşluğu anlamdan yola çıkarak doldur",
    description:
      "Cümlenin tümünü oku. Kelimenin yalnızca çevirisini değil, hangi durumda kullanıldığını düşün. Yanlış yanıtta farklı örneklerle çalışmaya devam edersin.",
  },
  {
    id: "context-choice",
    target: "#choice-correct",
    title: "Cümleyi tamamla",
    description: "Vurgulanan Expand seçeneğine tıkla.",
    action: true,
  },
  {
    id: "to-final",
    target: "#question-next",
    title: "Genel değerlendirmeye geç",
    description:
      "Bütün gruplardan sonra üç adım var: önce kelimeleri eşleştir, sonra anlamlarını hatırla ve son olarak cümlede kullan. Şimdi eşleştirmeyle başlayalım.",
    action: true,
  },
  {
    id: "matching-intro",
    target: "#matching-board",
    title: "Genel değerlendirme eşleştirmeyle başlar",
    description:
      "İngilizce kelimeler solda, karışık Türkçe karşılıkları sağda. Her sette en fazla beş çift bulunur. Bu provada tek çiftle deneyeceğiz. Ardından anlam ve bağlam soruları da bilginin ne kadar sağlam olduğunu gösterecek.",
  },
  {
    id: "matching-left",
    target: "#matching-left",
    title: "Önce kelimeyi seç",
    description:
      "Expand kartına tıkla. Seçilen kart maviyle belirginleşir; henüz bir eşleşme yapılmış olmaz.",
    action: true,
  },
  {
    id: "matching-right",
    target: "#matching-right",
    title: "Şimdi Türkçe karşılığını bul",
    description:
      "Genişlemek kartına tıkla. Gerçek görevde seçenekler karışık gelir. Yanlış çift kırmızıyla açıklanır; Yeniden dene ile seçimini düzeltebilirsin.",
    action: true,
  },
  {
    id: "matching-feedback",
    target: "#matching-board",
    title: "Doğru çift yerini buldu",
    description:
      "Yeşil kartlar eşleşti ve yeniden seçilemez. Bütün çiftleri tamamlayınca devam düğmesi açılır. Hatalı denemeler de son öğrenme grubunu belirler; yalnızca hızlı eşleştirmek tek başına yeterli değildir.",
  },
  {
    id: "matching-next",
    target: "#matching-next",
    title: "Anlam sorularına geç",
    description:
      "Bu set tamamlandı. Anlam sorularına geç düğmesine tıkla. Daha fazla kelime olduğunda önce sonraki eşleştirme seti gelir.",
    action: true,
  },
  {
    id: "final-meaning",
    target: "#choice-correct",
    title: "Genel değerlendirme: anlam",
    description: "Kelimenin doğru Türkçe anlamını yeniden seç.",
    action: true,
  },
  {
    id: "confidence",
    target: "#answer-confidence",
    title: "Nasıl hatırladığını söyle",
    description:
      "Zor hatırladım, Hatırladım veya Kolay hatırladım seçeneklerinden birine tıkla. Yanıtların, kelimelerin hangi öğrenme grubunda yer alacağını belirler.",
    action: true,
  },
  {
    id: "final-next",
    target: "#question-next",
    title: "Son bağlam sorusu",
    description: "Devam et ile genel değerlendirmenin son cümlesine geç.",
    action: true,
  },
  {
    id: "final-context",
    target: "#choice-correct",
    title: "Son kez cümlede kullan",
    description: "Doğru kelimeyi seç.",
    action: true,
  },
  {
    id: "final-confidence",
    target: "#answer-confidence",
    title: "Son geri bildirimin",
    description: "Nasıl hatırladığını seç; ardından görevi tamamlayacağız.",
    action: true,
  },
  {
    id: "finish",
    target: "#question-next",
    title: "Sonuçlarını gör",
    description:
      "Devam et düğmesine bas. Gerçek görevde kelimelerin grupları ve günlük ilerlemen otomatik güncellenir. Bu rehber gerçek kütüphaneni etkilemez.",
    action: true,
  },
];
