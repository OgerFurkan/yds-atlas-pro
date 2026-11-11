import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AtlasToastIcon() {
  return (
    <span className="atlas-toast-avatar" aria-hidden="true">
      <img src="/brand/atlas-mascot.png" alt="" />
    </span>
  );
}

export function AtlasToastClose({ closeToast }: { closeToast?: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="atlas-toast-close"
      aria-label={t("notifications.close")}
      onClick={() => closeToast?.()}
    >
      <X size={17} />
    </button>
  );
}
