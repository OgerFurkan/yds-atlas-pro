import { MessageCircleText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

interface ChatLauncherProps {
  onOpen: () => void;
}

/** Fixed-size floating entry point that opens the chat dialog. */
export function ChatLauncher({ onOpen }: ChatLauncherProps) {
  const { t } = useTranslation();
  return (
    <Button
      className="h-16 w-[min(350px,calc(100vw-32px))] justify-start gap-3 rounded-full border border-[#dce6ec] bg-[#ffffff] px-3 text-[#123b59] shadow-[0_8px_32px_rgba(18,59,89,0.22)] hover:bg-[#ffffff]"
      aria-expanded={false}
      aria-label={t("chat.launcher")}
      onClick={onOpen}
    >
      <img
        src="/brand/atlas-mascot.png"
        alt=""
        className="size-11 rounded-full bg-[#e8f2f7] object-cover"
      />
      <span className="flex-1 text-left">{t("chat.placeholder")}</span>
      <span className="rounded-full bg-[#123b59] px-4 py-2 text-white">
        {<MessageCircleText />}
      </span>
    </Button>
  );
}
