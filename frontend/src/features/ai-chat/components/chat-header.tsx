import { ChevronDown, History, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
export function ChatHeader({
  menuOpen,
  setMenuOpen,
  onClose,
  onHide,
  onNewChat,
  onHistory,
}: {
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  onClose: () => void;
  onHide: () => void;
  onNewChat: () => void;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-border bg-secondary px-5 py-3">
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-bold text-foreground hover:bg-accent"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        YDS Atlas <span className="rounded bg-[#f27637] px-1 text-xs text-white">AI</span>
        <ChevronDown size={16} />
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="text-foreground"
        aria-label={t("chat.close")}
        onClick={onClose}
      >
        <X size={19} />
      </Button>
      {menuOpen && (
        <div className="absolute top-14 right-4 left-4 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted chat-wide:hidden"
            onClick={() => {
              setMenuOpen(false);
              onClose();
              onHide();
            }}
          >
            <X size={17} />
            {t("chat.hideMobileBubble")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-muted"
            onClick={() => {
              onNewChat();
              setMenuOpen(false);
            }}
          >
            <Plus size={17} />
            {t("chat.newChat")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-[#eff5f8]"
            onClick={() => {
              onHistory();
              setMenuOpen(false);
            }}
          >
            <History size={17} />
            {t("chat.history")}
          </button>
        </div>
      )}
    </header>
  );
}
