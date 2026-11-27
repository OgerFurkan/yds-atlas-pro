import { useState } from "react";
import type { WordLibraryPageProps } from "../components/word-library-page";
import { hasAtlasTiers } from "../model/tiered-examples";

export function useLibraryMaintenance({
  words,
  automaticLegacyRepair,
  accountId,
  onNotify,
}: Pick<WordLibraryPageProps, "words" | "automaticLegacyRepair" | "accountId" | "onNotify">) {
  const [autoConsent, setAutoConsent] = useState(false);
  const legacyCandidatesExist = words.some(
    (word) => !hasAtlasTiers(word.examples) && !word.lexicon,
  );
  const mayAutoRepair = automaticLegacyRepair && autoConsent && !!accountId;
  function enableAutoRepair() {
    if (
      !accountId ||
      !window.confirm(
        "Bu işlem için eksik eski örnekleri tamamlamak istiyor musun? Mevcut anlamların, örneklerin ve puanların korunacak.",
      )
    )
      return;
    setAutoConsent(true);
    onNotify.success("Kütüphane tamamlama etkinleştirildi. İşlem kontrollü biçimde başlayacak.");
  }
  return { autoConsent, legacyCandidatesExist, mayAutoRepair, enableAutoRepair };
}
