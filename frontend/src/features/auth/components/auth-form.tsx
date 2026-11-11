import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { useAuthForm } from "../hooks/use-auth-form";

export function AuthForm({
  recovering = false,
  email,
  onSuccess,
  onRecovered,
  onModeChange,
  externalMode,
}: {
  recovering?: boolean;
  email?: string;
  onSuccess: () => void;
  onRecovered: () => void;
  onModeChange?: (mode: "signin" | "signup" | "reset" | "recovery") => void;
  externalMode?: "signin" | "signup" | "reset" | "recovery";
}) {
  const { t } = useTranslation();
  const {
    form,
    mode,
    message,
    showPassword,
    setShowPassword,
    rememberSession,
    setRememberSessionChoice,
    changeMode: updateMode,
    submit,
  } = useAuthForm({
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
  function changeMode(next: "signin" | "signup" | "reset" | "recovery") {
    updateMode(next);
    onModeChange?.(next);
  }
  useEffect(() => {
    if (externalMode && externalMode !== mode) updateMode(externalMode);
  }, [externalMode, mode, updateMode]);
  const titles = {
    signin: t("auth.signinTitle"),
    signup: t("auth.signupTitle"),
    reset: t("auth.resetTitle"),
    recovery: t("auth.recoveryTitle"),
  };
  return (
    <div className="space-y-7">
      <div>
        <p className="mb-3 text-xs font-bold tracking-[0.18em] text-atlas-orange">
          {t("auth.eyebrow")}
        </p>
        <h1 className="font-display text-3xl leading-tight text-atlas-navy sm:text-4xl">
          {titles[mode]}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">{t(`auth.${mode}Description`)}</p>
      </div>
      <form aria-label={t("auth.formAria")} className="space-y-5" onSubmit={handleSubmit(submit)}>
        <div>
          <label htmlFor="auth-email" className="mb-2 block text-sm font-semibold text-atlas-navy">
            {t("auth.email")}
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
              placeholder={t("auth.emailPlaceholder")}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "auth-email-error" : undefined}
              {...register("email")}
            />
          </div>
          {errors.email && (
            <p id="auth-email-error" className="mt-1.5 text-xs text-red-700">
              {t("auth.errorEmail")}
            </p>
          )}
        </div>
        {mode !== "reset" && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="auth-password" className="text-sm font-semibold text-atlas-navy">
                {mode === "recovery" ? t("auth.newPassword") : t("auth.password")}
              </label>
              {mode === "signin" && (
                <Button
                  size="sm"
                  variant="link"
                  className="min-h-0 px-0 py-0 text-xs"
                  onClick={() => changeMode("reset")}
                >
                  {t("auth.forgot")}
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
                placeholder={
                  mode === "signin"
                    ? t("auth.passwordPlaceholder")
                    : t("auth.newPasswordPlaceholder")
                }
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? "auth-password-error" : undefined}
                {...register("password")}
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 size-10"
                aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
            </div>
            {errors.password && (
              <p id="auth-password-error" className="mt-1.5 text-xs text-red-700">
                {t("auth.errorPassword")}
              </p>
            )}
          </div>
        )}
        {mode === "signin" && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember-session"
              checked={rememberSession}
              onCheckedChange={(checked) => setRememberSessionChoice(checked === true)}
            />
            <label htmlFor="remember-session" className="cursor-pointer text-sm text-slate-600">
              {t("auth.remember")}
            </label>
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
            ? t("auth.signin")
            : mode === "signup"
              ? t("auth.signup")
              : mode === "reset"
                ? t("auth.reset")
                : t("auth.savePassword")}
          {!isSubmitting && <ArrowRight size={18} />}
        </Button>
        {mode !== "recovery" && (
          <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-slate-500">
            {mode === "signin"
              ? t("auth.noAccount")
              : mode === "signup"
                ? t("auth.hasAccount")
                : t("auth.rememberPassword")}
            <Button
              variant="link"
              size="sm"
              onClick={() => changeMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? t("auth.createAccount") : t("auth.backToSignin")}
            </Button>
          </p>
        )}
      </form>
    </div>
  );
}
