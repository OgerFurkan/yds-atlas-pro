import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

interface ChatErrorNoticeProps {
  error: string;
  busy: boolean;
  canRetry: boolean;
  onRetry: () => void;
}

/** Request error and explicit manual retry; no network or retry policy here. */
export function ChatErrorNotice({ error, busy, canRetry, onRetry }: ChatErrorNoticeProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800" role="alert">
      <p className="text-xs leading-5">{error}</p>
      {canRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 border-red-300 bg-white text-red-800 hover:bg-red-100"
          disabled={busy}
          onClick={onRetry}
        >
          {t("chat.retrySameQuestion")}
        </Button>
      )}
    </div>
  );
}
