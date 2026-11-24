import { useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { type FixtureVariant, updateFixtureLibrary } from "../api/local-fixture-library";

export function LocalFixtureControls({ onChange }: { onChange: () => void }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; error: boolean }>();

  async function update(load: boolean, variant: FixtureVariant = "ready") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const days = await updateFixtureLibrary(load, variant);
      onChange();
      setResult({
        message: !load
          ? "Sentetik kelimeler kaldırıldı."
          : variant === "partial"
            ? `Sentetik 5 öğrenilmiş / 15 kalan gün ${days[0]}. günde, eksik grup ${days[1]}. günde.`
            : `Sentetik kelimeler yüklendi. Hazır grup ${days[0]}. günde, eksik grup ${days[1]}. günde.`,
        error: false,
      });
    } catch (error) {
      setResult({
        message: error instanceof Error ? error.message : "Yerel işlem tamamlanamadı.",
        error: true,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Yerel sentetik veri"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border/50 bg-muted/15 px-3 py-2 sm:px-4"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-[11px] font-semibold text-muted-foreground">
            LOCAL test araçları
          </strong>
          <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground">
            DEV ONLY
          </span>
        </div>
        <p className="mt-0.5 hidden text-[11px] leading-4 text-muted-foreground lg:block">
          Yalnız ayrı test profilini etkiler; normal misafir verileri korunur.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          className="min-h-8 px-2.5 text-[11px] shadow-none"
          disabled={busy}
          onClick={() => void update(true)}
        >
          Sentetik test verilerini yükle
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-8 px-2.5 text-[11px]"
          disabled={busy}
          onClick={() => void update(true, "partial")}
        >
          5 öğrenilmiş / 15 kalan yükle
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-8 px-2.5 text-[11px]"
          disabled={busy}
          onClick={() => void update(false)}
        >
          Yalnız sentetik verileri kaldır
        </Button>
      </div>
      {result && (
        <p
          role={result.error ? "alert" : "status"}
          className={
            result.error
              ? "w-full rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
              : "w-full rounded-lg bg-muted px-3 py-2 text-xs text-foreground"
          }
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
