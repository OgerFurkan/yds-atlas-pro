import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

interface ChatSignInNoticeProps {
  onSignIn: () => void;
}

/** Sign-in prompt. The parent controls dialog visibility and auth routing. */
export function ChatSignInNotice({ onSignIn }: ChatSignInNoticeProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-orange-200 bg-atlas-orange/50 p-3 text-sm text-black">
      <p>{t("chat.loginRequired")}</p>
      <Button className="mt-2" size="sm" onClick={onSignIn}>
        {t("chat.signIn")}
      </Button>
    </div>
  );
}
