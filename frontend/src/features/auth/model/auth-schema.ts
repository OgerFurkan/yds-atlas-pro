import { z } from "zod";
export const authSchema = z
  .object({
    email: z.email("Geçerli bir e-posta adresi yaz."),
    password: z.string(),
    mode: z.enum(["signin", "signup", "reset", "recovery"]),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "reset") return;
    const minimum = value.mode === "signin" ? 1 : 10;
    if (value.password.length < minimum)
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: minimum === 1 ? "Şifreni yaz." : "En az 10 karakterli bir şifre seç.",
      });
  });
export type AuthValues = z.infer<typeof authSchema>;
export function authErrorMessage(code?: string) {
  if (code === "invalid_credentials") return "E-posta veya şifre hatalı.";
  if (code === "email_not_confirmed") return "Giriş yapmadan önce e-posta adresini doğrula.";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit")
    return "Çok sık denedin. Biraz bekleyip yeniden dene.";
  if (code === "weak_password") return "Daha güçlü, en az 10 karakterli bir şifre seç.";
  return "İşlem tamamlanamadı. Bilgilerini ve bağlantını kontrol et.";
}
