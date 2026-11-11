import type { User } from "@supabase/supabase-js";
import { ArrowLeft, BookOpen, CalendarCheck2, Flame } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "reset" | "recovery">("signin");
  const externalMode = recovering ? "recovery" : authMode;
  const signup = !recovering && authMode === "signup";
  const authenticated = useEffectEvent(onSuccess);
  useEffect(() => {
    if (user && !recovering) authenticated();
  }, [user, recovering]);
  return (
    <div className="flex min-h-dvh flex-col bg-atlas-canvas">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <a href="#home" aria-label={t("auth.brandHome")} className="flex items-center gap-3">
          <AtlasLogo className="size-10 shadow-sm" />
          <span className="grid gap-1">
            <strong className="font-display text-lg leading-none text-atlas-navy">
              YDS Atlas <span className="text-atlas-orange">Pro</span>
            </strong>
            <small className="text-[9px] font-semibold tracking-[0.12em] text-atlas-muted">
              {t("brand.tagline")}
            </small>
          </span>
        </a>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>{recovering ? t("auth.backHome") : t("auth.guest")}</span>
        </Button>
      </header>
      <main
        className="auth-layout relative mx-auto my-auto grid w-[calc(100%-2rem)] max-w-5xl items-stretch overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(9,38,59,0.12)] lg:min-h-[620px] lg:grid-cols-2"
        data-auth-mode={signup ? "signup" : "signin"}
      >
        <section
          aria-label={t("auth.brandDescription")}
          className={`auth-brand relative z-20 hidden overflow-hidden p-8 text-white transition-transform duration-700 ease-[cubic-bezier(.65,0,.35,1)] motion-reduce:transition-none lg:col-start-1 lg:row-start-1 lg:block lg:p-10 ${signup ? "lg:[transform:translateX(100%)]" : "lg:[transform:translateX(0)]"}`}
        >
          <p className="text-xs font-semibold tracking-[0.16em] text-orange-200">
            {t("brand.tagline").toLocaleUpperCase()}
          </p>
          <h2 className="mt-5 max-w-sm font-display text-4xl leading-[1.2]">
            {signup ? t("auth.panelSignupTitle") : t("auth.panelSigninTitle")}
            <br />
            <span className="text-orange-300">
              {signup ? t("auth.panelSignupAccent") : t("auth.panelSigninAccent")}
            </span>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-7 text-blue-100">
            {signup ? t("auth.panelSignupDescription") : t("auth.panelSigninDescription")}
          </p>
          <div className="relative mx-auto mt-2 aspect-[1.35] max-w-72">
            <span className="absolute inset-4 rounded-full border border-white/15 bg-white/5" />
            <img
              src="/brand/atlas-mascot.png"
              alt={t("companion.alt")}
              className="relative h-full w-full object-contain drop-shadow-xl"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4">
            <p className="text-sm text-blue-100">
              {signup ? t("auth.hasAccount") : t("auth.noAccount")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="border-white/40 bg-white/5 text-white hover:bg-white/15 hover:text-white"
              onClick={() => setAuthMode(signup ? "signin" : "signup")}
            >
              {signup ? t("auth.backToSignin") : t("auth.createAccount")}
            </Button>
          </div>
          <ul className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-blue-100">
            {[
              [BookOpen, t("auth.benefitCloud")],
              [CalendarCheck2, t("auth.benefitDevices")],
              [Flame, t("auth.benefitProgress")],
            ].map(([Icon, label]) => (
              <li key={String(label)} className="flex flex-col items-center gap-2">
                <Icon size={20} className="text-orange-300" />
                <span>{String(label)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section
          aria-label={t("auth.formAria")}
          className={`auth-form-panel relative z-10 flex w-full items-center justify-center bg-white p-5 transition-transform duration-700 ease-[cubic-bezier(.65,0,.35,1)] motion-reduce:transition-none sm:p-8 lg:col-start-2 lg:row-start-1 lg:p-10 ${signup ? "lg:[transform:translateX(-100%)]" : "lg:[transform:translateX(0)]"}`}
        >
          <AuthForm
            key={recovering ? "recovery" : "signin"}
            recovering={recovering}
            email={user?.email}
            onSuccess={onSuccess}
            onRecovered={onRecovered}
            onModeChange={setAuthMode}
            externalMode={externalMode}
          />
        </section>
      </main>
      <footer className="px-4 pb-5 text-center text-xs text-slate-500">{t("auth.footer")}</footer>
    </div>
  );
}
