import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { supabase } from "@/shared/api/supabase-client";
import { type AuthValues, authSchema } from "../model/auth-schema";
import { setRememberSession } from "../model/auth-storage";
export function useAuthForm({
  recovering,
  email,
  onSuccess,
  onRecovered,
}: {
  recovering: boolean;
  email?: string;
  onSuccess: () => void;
  onRecovered: () => void;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSessionChoice] = useState(false);
  const form = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: email ?? "", password: "", mode: recovering ? "recovery" : "signin" },
  });
  const mode = useWatch({ control: form.control, name: "mode" });
  function changeMode(next: AuthValues["mode"]) {
    form.setValue("mode", next);
    form.setValue("password", "");
    form.clearErrors();
    setMessage("");
  }
  async function submit(values: AuthValues) {
    setMessage("");
    if (!supabase) {
      setMessage(t("auth.connectionPending"));
      return;
    }
    try {
      const redirect = window.location.origin + window.location.pathname;
      if (values.mode === "signin") setRememberSession(rememberSession);
      const result =
        values.mode === "signin"
          ? await supabase.auth.signInWithPassword({
              email: values.email,
              password: values.password,
            })
          : values.mode === "signup"
            ? await supabase.auth.signUp({
                email: values.email,
                password: values.password,
                options: { emailRedirectTo: redirect },
              })
            : values.mode === "reset"
              ? await supabase.auth.resetPasswordForEmail(values.email, { redirectTo: redirect })
              : await supabase.auth.updateUser({ password: values.password });
      if (result.error) {
        const code = result.error.code;
        const key =
          code === "invalid_credentials"
            ? "invalidCredentials"
            : code === "email_not_confirmed"
              ? "emailNotConfirmed"
              : code === "over_email_send_rate_limit" || code === "over_request_rate_limit"
                ? "rateLimit"
                : code === "weak_password"
                  ? "weakPassword"
                  : "generic";
        setMessage(t(`auth.errors.${key}`));
        return;
      }
      if (values.mode === "signup" || values.mode === "reset") setMessage(t("auth.emailSent"));
      else {
        if (values.mode === "recovery") onRecovered();
        onSuccess();
      }
    } catch {
      setMessage(t("auth.connectionError"));
    }
  }
  return {
    form,
    mode,
    message,
    showPassword,
    setShowPassword,
    rememberSession,
    setRememberSessionChoice,
    changeMode,
    submit,
  };
}
