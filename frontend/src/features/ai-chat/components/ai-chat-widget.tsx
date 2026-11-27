import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppPreferences } from "@/shared/hooks/use-app-preferences";
import { useChatConversation } from "../hooks/use-chat-conversation";
import { useChatDocking } from "../hooks/use-chat-docking";
import { ChatComposer } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ChatLauncher } from "./chat-launcher";
import { ChatTranscript } from "./chat-transcript";

export function AiChatWidget({
  onLogin,
  assessmentActive,
  owner,
}: {
  onLogin: () => void;
  assessmentActive: boolean;
  owner: string | null;
}) {
  const { t } = useTranslation();
  const { mobileChatVisible, setMobileChatVisible } = useAppPreferences();
  const [open, setOpen] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useChatDocking(widget, assessmentActive, open, mobileChatVisible);
  const conversation = useChatConversation(owner, assessmentActive, setOpen);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (assessmentActive) return null;
  return (
    <div
      ref={widget}
      className={`fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex-col items-end gap-3 chat-wide:right-6 chat-wide:bottom-6 chat-wide:flex ${mobileChatVisible ? "flex" : "hidden"}`}
    >
      {open && (
        <section
          className="atlas-chat-panel flex h-[min(590px,calc(100dvh-32px-env(safe-area-inset-bottom)-env(safe-area-inset-top)))] w-[min(390px,calc(100vw-32px))] flex-col gap-2.5"
          role="dialog"
          aria-label={t("chat.title")}
          aria-modal="false"
        >
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-[0_14px_45px_rgba(17,36,54,0.16)]">
            <ChatHeader
              menuOpen={menuOpen}
              setMenuOpen={setMenuOpen}
              onClose={() => setOpen(false)}
              onHide={() => setMobileChatVisible(false)}
              onNewChat={conversation.newChat}
              onHistory={conversation.viewHistory}
            />
            <ChatTranscript
              conversation={conversation}
              onLogin={() => {
                setOpen(false);
                onLogin();
              }}
            />
          </div>

          <ChatComposer
            draft={conversation.draft}
            setDraft={conversation.setDraft}
            disabled={conversation.busy || conversation.needsSignIn}
            onSubmit={() => void conversation.send()}
          />
        </section>
      )}
      {!open && <ChatLauncher onOpen={() => setOpen(true)} />}
    </div>
  );
}
