import type { User } from "@supabase/supabase-js";
import { ArrowLeft, BookOpen, CalendarCheck2, Flame } from "lucide-react";
import { useEffect, useEffectEvent } from "react";
import { AtlasLogo } from "@/shared/brand/atlas-logo";
import { Button } from "@/shared/ui/button";
import { AuthForm } from "./auth-form";
export function LoginPage({
  user,
  recovering,
  onSuccess,
  onRecovered,
  onBack,
}: {
  user: User | null;
  recovering: boolean;
  onSuccess: () => void;
  onRecovered: () => void;
  onBack: () => void;
}) {
  const authenticated = useEffectEvent(onSuccess);
  useEffect(() => {
    if (user && !recovering) authenticated();
  }, [user, recovering]);
  return (
    <div className="flex min-h-dvh flex-col bg-atlas-canvas">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <a href="#home" aria-label="YDS Atlas ana sayfa" className="flex items-center gap-2.5">
          <AtlasLogo className="size-11" />
          <span className="font-display text-xl text-atlas-navy">YDS Atlas</span>
        </a>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>{recovering ? "Ana sayfa" : "Misafir olarak devam et"}</span>
        </Button>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-4 pb-8 sm:px-6 lg:grid-cols-[1fr_0.95fr] lg:gap-16 lg:py-10">
        <section
          aria-label="Atlas ile öğren"
          className="relative hidden overflow-hidden rounded-[28px] bg-atlas-navy p-9 text-white lg:block"
        >
          <p className="text-xs font-semibold tracking-[0.16em] text-orange-200">
            HER KELİME BİR KEŞİF.
          </p>
          <h2 className="mt-5 max-w-sm font-display text-4xl leading-[1.2]">
            Bugünün kelimeleri,
            <br />
            <span className="text-orange-300">yarının gücü.</span>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-7 text-blue-100">
            Ben Atlas, öğrenme arkadaşın. Küçük adımlarla kelimeleri keşfedelim, öğrendiklerini
            birlikte kalıcı hale getirelim.
          </p>
          <div className="relative mx-auto mt-4 aspect-[1.15] max-w-80">
            <span className="absolute inset-4 rounded-full border border-white/15 bg-white/5" />
            <img
              src="/brand/atlas-mascot.png"
              alt="Öğrenme arkadaşın gözlüklü kurt Atlas"
              className="relative h-full w-full object-contain drop-shadow-xl"
            />
          </div>
          <ul className="mt-4 grid grid-cols-3 gap-2 border-t border-white/15 pt-5 text-center text-xs text-blue-100">
            {[
              [BookOpen, "Kelimelerini keşfet"],
              [CalendarCheck2, "Günlük görevini tamamla"],
              [Flame, "Serini büyüt"],
            ].map(([Icon, label]) => (
              <li key={String(label)} className="flex flex-col items-center gap-2">
                <Icon size={20} className="text-orange-300" />
                <span>{String(label)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section
          aria-label="Hesabına bağlan"
          className="w-full max-w-lg justify-self-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        >
          <AuthForm
            key={recovering ? "recovery" : "signin"}
            recovering={recovering}
            email={user?.email}
            onSuccess={onSuccess}
            onRecovered={onRecovered}
          />
        </section>
      </main>
      <footer className="px-4 pb-5 text-center text-xs text-slate-500">
        YDS Atlas · Her gün bir adım daha.
      </footer>
    </div>
  );
}
