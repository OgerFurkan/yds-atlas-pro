import { MessageCircleText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
export function ChatLauncher({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      className="atlas-chat-launcher relative size-13 shrink-0 justify-center gap-0 rounded-full border border-border bg-card p-1 chat-wide:h-16 chat-wide:w-[min(350px,calc(100vw-32px))] chat-wide:justify-start chat-wide:gap-3 chat-wide:px-3 text-foreground shadow-[0_8px_32px_rgba(18,59,89,0.14)] hover:bg-muted"
      aria-expanded={false}
      aria-label={t("chat.launcher")}
      onClick={onOpen}
    >
      <img
        src="/brand/atlas-mascot.png"
        alt=""
        className="size-11 rounded-full bg-[#e8f2f7] object-cover"
      />
      <span className="hidden flex-1 text-left chat-wide:inline">{t("chat.placeholder")}</span>
      <span
        aria-hidden="true"
        className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full bg-atlas-navy text-card [&_svg]:size-3 chat-wide:static chat-wide:h-auto chat-wide:w-auto chat-wide:bg-[#123b59] chat-wide:px-4 chat-wide:py-2 chat-wide:text-white chat-wide:[&_svg]:size-4"
      >
        {<MessageCircleText />}
      </span>
    </Button>
  );
}
