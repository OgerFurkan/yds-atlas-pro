import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { supabase } from "@/shared/api/supabase-client";
import { authSchema, authErrorMessage, type AuthValues } from "../model/auth-schema";
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
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      setMessage(
        "Hesap bağlantısı henüz açılmadı. Şimdilik misafir olarak çalışmaya devam edebilirsin.",
      );
      return;
    }
    try {
      const redirect = window.location.origin + window.location.pathname;
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
        setMessage(authErrorMessage(result.error.code));
        return;
      }
      if (values.mode === "signup" || values.mode === "reset")
        setMessage(
          "Bu adres için işlem yapılabiliyorsa e-posta bağlantısı gönderildi. Gelen kutunu ve gereksiz postaları kontrol et.",
        );
      else {
        if (values.mode === "recovery") onRecovered();
        onSuccess();
      }
    } catch {
      setMessage("Bağlantı kurulamadı. Lütfen yeniden dene.");
    }
  }
  return { form, mode, message, showPassword, setShowPassword, changeMode, submit };
}
