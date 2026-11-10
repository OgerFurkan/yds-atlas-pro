import type { GuideStep } from "@/shared/ui/guided-tour";

export const setupGuide: GuideStep[] = [
  {
    id: "intro",
    target: "#task-intro",
    title: "Bu, Günlük Görev'in hazırlık ekranı",
    description:
      "Her gün hedeflediğin kadar kelime çalışırsın. Önce kelimelerini seçer, sonra kaçlı gruplarla çalışacağını belirlersin. Bu rehberde hiçbir gerçek kaydın değişmez.",
  },
  {
    id: "source",
    target: "#task-sources",
    title: "Kelimeler nereden gelecek?",
    description:
      "Hazır liste ile hemen başlayabilirsin. Kütüphanem, daha önce eklediğin kelimeleri kullanır. Kendi listem ise çalışmak istediğin kelimeleri yazman içindir.",
  },
  {
    id: "starter",
    target: "#source-selection",
    title: "Hazır liste: en hızlı başlangıç",
    description:
      "Bu 20 kelimenin anlamları ve örnekleri hazır. Göreve başlarken yeni kelimeler kütüphanene eklenir. Aynı kelime ikinci kez oluşturulmaz.",
  },
  {
    id: "library",
    target: "#source-selection",
    title: "Kütüphanenden çalışmak",
    description:
      "Burada öğrenme aşamasındaki hazır kelimelerini görürsün. Anlamı veya örnekleri eksik kayıtları kütüphanede tamamlayabilirsin. Öğrenilmiş kelimeler yeni öğrenme görevine alınmaz.",
  },
  {
    id: "typing",
    target: "#import-text",
    title: "Kendi listeni yaz",
    description:
      "Örnek bir liste yazıyoruz. Her satıra bir İngilizce kelime ekle; virgül ve noktalı virgül de kullanabilirsin. Örnekteki benifit yazımını birazdan düzelteceğiz.",
  },
  {
    id: "check",
    target: "#import-check",
    title: "Yazımı birlikte kontrol edelim",
    description:
      "Yazımı kontrol et düğmesine bas. Şüpheli yazımlar önerileriyle birlikte gösterilir; böylece hatalı bir kelimeyi fark etmeden eklemezsin.",
    action: true,
  },
  {
    id: "correct",
    target: "#import-suggestion",
    title: "Doğru öneriyi seç",
    description:
      "Benifit yerine Benefit yazılmalı. Vurgulanan Benefit önerisine tıkla. Emin olmadığın kelimelerin yazımını kendin de onaylayabilirsin.",
    action: true,
  },
  {
    id: "accept",
    target: "#import-accept",
    title: "İncelediğin listeyi hazırla",
    description:
      "Listeyi kullan düğmesine bas. Normal kullanımda kelimeler kütüphanene eklenir. Bu denemede yalnızca nasıl yapıldığını göreceksin; kayıt yapılmaz.",
    action: true,
  },
  {
    id: "target",
    target: "#task-target",
    title: "Kaç kelime çalışacaksın?",
    description:
      "Bu sayı günlük hedefinden gelir. İstersen bu görev için değiştirebilirsin. Yeterli hazır kelimen yoksa daha kısa bir görev seçeneği de görünür.",
  },
  {
    id: "batch",
    target: "#task-batch-10",
    title: "Grup büyüklüğünü dene",
    description:
      "10'lu gruplar düğmesine tıkla. 20 kelimeyi 10'lu seçersen iki grup, 5'li seçersen dört grup çalışırsın. Her grup aynı öğrenme adımlarından geçer.",
    action: true,
  },
  {
    id: "summary",
    target: "#task-summary",
    title: "Son kontrol ve başlama",
    description:
      "Burada seçtiğin kelime sayısını ve grup düzenini görürsün. Günlük göreve başla ile çalışmaya geçersin. Hazırlık artık tamam; Oyunu dene düğmesiyle kartları ve soruları da uygulayarak öğrenebilirsin.",
  },
];
