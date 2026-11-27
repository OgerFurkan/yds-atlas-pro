import type { useLibraryMaintenance } from "../hooks/use-library-maintenance";
import { LegacyTierUpgrade } from "./legacy-tier-upgrade";
import type { WordLibraryPageProps } from "./word-library-page";
export function LibraryMaintenance({
  words,
  loading,
  loadError,
  automaticLegacyRepair,
  accountId,
  onSaveProtected,
  onNotify,
  maintenance,
}: Pick<
  WordLibraryPageProps,
  | "words"
  | "loading"
  | "loadError"
  | "automaticLegacyRepair"
  | "accountId"
  | "onSaveProtected"
  | "onNotify"
> & { maintenance: ReturnType<typeof useLibraryMaintenance> }) {
  const { autoConsent, legacyCandidatesExist, mayAutoRepair, enableAutoRepair } = maintenance;
  return (
    <>
      {!loading &&
        !loadError &&
        automaticLegacyRepair &&
        accountId &&
        legacyCandidatesExist &&
        !autoConsent && (
          <div
            role="note"
            className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-atlas-muted"
          >
            <span>Eski kelimelerindeki eksik örnekleri bu oturumda tamamla.</span>
            <button
              type="button"
              onClick={enableAutoRepair}
              className="rounded-md border border-atlas-line bg-card px-3 py-1.5 font-semibold text-atlas-ink hover:bg-muted focus-visible:outline-2 focus-visible:outline-atlas-blue"
            >
              Eski örnekleri tamamla
            </button>
          </div>
        )}
      {!loading && !loadError && words.length > 0 && (
        <details className="mt-2 text-xs text-atlas-muted">
          <summary className="inline-flex cursor-pointer rounded-md px-2 py-1.5 font-medium text-atlas-muted hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atlas-blue">
            Gelişmiş kütüphane bakımı
          </summary>
          <div className="mt-2 space-y-2">
            <LegacyTierUpgrade
              owner={accountId ?? null}
              words={words}
              onSave={onSaveProtected}
              onNotify={onNotify}
              automatic={mayAutoRepair}
            />
          </div>
        </details>
      )}
    </>
  );
}
