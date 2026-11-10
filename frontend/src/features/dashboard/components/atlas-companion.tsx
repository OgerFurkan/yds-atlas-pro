import { PawPrint } from "lucide-react";

export function AtlasCompanion({ goal, completed }: { goal: number; completed: number }) {
  const finished = completed >= goal;
  return (
    <figure
      aria-label="Atlas, YDS Atlas maskotu ve öğrenme arkadaşın"
      className="relative isolate mx-auto w-full max-w-[420px] px-3 sm:px-5"
    >
      <div className="relative z-20 -mb-2 mr-auto max-w-[250px] rounded-2xl border border-white/80 bg-white px-4 py-3 shadow-[0_8px_24px_#73401812] after:absolute after:-bottom-2 after:right-8 after:size-4 after:rotate-45 after:rounded-br-sm after:bg-white sm:-ml-5">
        <p className="text-sm font-bold text-atlas-navy">Ben Atlas, öğrenme arkadaşın!</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {finished ? (
            <span className="flex items-center gap-1">
              Bugünkü hedef tamam! Bir pati çak!
              <PawPrint className="h-4 w-4" />
            </span>
          ) : completed > 0 ? (
            "Güzel gidiyorsun. Birlikte tamamlayalım!"
          ) : (
            "Her yeni kelimede yanındayım. Başlayalım mı?"
          )}
        </p>
      </div>
      <div className="relative ml-auto flex aspect-square w-full max-w-80 items-center justify-center">
        <span className="absolute inset-1 rounded-full border border-white/50 bg-white/10" />
        <img
          className="relative h-full w-full object-contain drop-shadow-xl"
          src="/brand/atlas-mascot.png"
          alt="Gözlüklü gri kurt Atlas, lacivert-turuncu hoodie'si ve YDS kitabıyla"
        />
      </div>
    </figure>
  );
}
