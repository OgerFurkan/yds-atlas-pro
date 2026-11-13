import type { FormEvent, KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

interface ChatComposerProps {
  draft: string;
  busy: boolean;
  needsSignIn: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Controlled input only; request state and transport stay inside AiChatWidget. */
export function ChatComposer({
  draft,
  busy,
  needsSignIn,
  onDraftChange,
  onSubmit,
  onKeyDown,
}: ChatComposerProps) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 rounded-3xl border border-[#dce6ec] bg-[#ffffff] p-3 shadow-[0_8px_30px_rgba(18,59,89,0.20)]"
    >
      <div className="flex items-end gap-2 bg">
        <Textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t("chat.placeholder")}
          placeholder={t("chat.placeholder")}
          className="max-h-24 min-h-10 resize-none border-0 bg-transparent px-1 py-2 text-sm text-[#123b59] shadow-none placeholder:text-[#536b7d] focus-visible:ring-0"
          maxLength={1800}
          rows={1}
          disabled={busy || needsSignIn}
        />
        <Button
          type="submit"
          size="icon"
          className="size-9 shrink-0 rounded-md"
          aria-label={t("chat.send")}
          disabled={!draft.trim() || busy || needsSignIn}
        >
          <ArrowUp size={18} />
        </Button>
      </div>
    </form>
  );
}
