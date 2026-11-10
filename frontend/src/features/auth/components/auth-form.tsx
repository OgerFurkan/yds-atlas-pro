import { Eye, EyeOff, ArrowRight, LoaderCircle, Mail, LockKeyhole } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useAuthForm } from "../hooks/use-auth-form";
const titles = {
  signin: "Yeniden hoş geldin.",
  signup: "İlk adımı birlikte atalım.",
  reset: "Şifreni yenileyelim.",
  recovery: "Yeni bir başlangıç.",
};
export function AuthForm({
  recovering = false,
  email,
  onSuccess,
  onRecovered,
}: {
  recovering?: boolean;
  email?: string;
  onSuccess: () => void;
  onRecovered: () => void;
}) {
  const { form, mode, message, showPassword, setShowPassword, changeMode, submit } = useAuthForm({
    recovering,
    email,
    onSuccess,
    onRecovered,
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  return (
    <div className="space-y-7">
      <div>
        <p className="mb-3 text-xs font-bold tracking-[0.18em] text-atlas-orange">
          YDS ATLAS HESABIN
        </p>
        <h1 className="font-display text-3xl leading-tight text-atlas-navy sm:text-4xl">
          {titles[mode]}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          {mode === "signin"
            ? "Kelimelerin, günlük görevin ve kaldığın yer seni bekliyor."
            : mode === "signup"
              ? "Kelimelerini ve ilerlemeni hesabında bir araya getir."
              : mode === "reset"
                ? "E-posta adresine şifre yenileme bağlantısı gönderelim."
                : "Hesabın için en az 10 karakterli yeni bir şifre belirle."}
        </p>
      </div>
      <form aria-label="Hesap giriş formu" className="space-y-5" onSubmit={handleSubmit(submit)}>
        <div>
          <label htmlFor="auth-email" className="mb-2 block text-sm font-semibold text-atlas-navy">
            E-posta adresi
          </label>
          <div className="relative">
            <Mail
              size={18}
              className="pointer-events-none absolute left-3 top-3.5 text-slate-400"
            />
            <Input
              id="auth-email"
              className="min-h-12 pl-10"
              type="email"
              autoComplete="email"
              placeholder="ornek@eposta.com"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "auth-email-error" : undefined}
              {...register("email")}
            />
          </div>
          {errors.email && (
            <p id="auth-email-error" className="mt-1.5 text-xs text-red-700">
              {errors.email.message}
            </p>
          )}
        </div>
        {mode !== "reset" && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="auth-password" className="text-sm font-semibold text-atlas-navy">
                {mode === "recovery" ? "Yeni şifre" : "Şifre"}
              </label>
              {mode === "signin" && (
                <Button
                  size="sm"
                  variant="link"
                  className="min-h-0 px-0 py-0 text-xs"
                  onClick={() => changeMode("reset")}
                >
                  Şifremi unuttum
                </Button>
              )}
            </div>
            <div className="relative">
              <LockKeyhole
                size={18}
                className="pointer-events-none absolute left-3 top-3.5 text-slate-400"
              />
              <Input
                id="auth-password"
                className="min-h-12 pl-10 pr-12"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder={mode === "signin" ? "Şifreni yaz" : "En az 10 karakter"}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? "auth-password-error" : undefined}
                {...register("password")}
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 size-10"
                aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
            </div>
            {errors.password && (
              <p id="auth-password-error" className="mt-1.5 text-xs text-red-700">
                {errors.password.message}
              </p>
            )}
          </div>
        )}
        {message && (
          <p
            role="status"
            className="rounded-xl bg-orange-50 p-3 text-sm leading-6 text-orange-900"
          >
            {message}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting} className="min-h-12 w-full">
          {isSubmitting ? <LoaderCircle size={18} className="animate-spin" /> : null}
          {mode === "signin"
            ? "Giriş yap"
            : mode === "signup"
              ? "Hesap oluştur"
              : mode === "reset"
                ? "Yenileme bağlantısı gönder"
                : "Yeni şifreyi kaydet"}
          {!isSubmitting && <ArrowRight size={18} />}
        </Button>
        {mode !== "recovery" && (
          <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-slate-500">
            {mode === "signin"
              ? "Henüz hesabın yok mu?"
              : mode === "signup"
                ? "Zaten hesabın var mı?"
                : "Şifreni hatırladın mı?"}
            <Button
              variant="link"
              size="sm"
              onClick={() => changeMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Hesap oluştur" : "Girişe dön"}
            </Button>
          </p>
        )}
      </form>
    </div>
  );
}
