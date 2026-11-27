import { ArrowUp } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

export function ChatComposer({
  draft,
  setDraft,
  disabled,
  onSubmit,
}: {
  draft: string;
  setDraft: (draft: string) => void;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="shrink-0 rounded-3xl border border-border bg-[#ffffff] p-3 shadow-[0_8px_30px_rgba(18,59,89,0.12)]"
    >
      <div className="flex items-end gap-2 bg">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={t("chat.placeholder")}
          placeholder={t("chat.placeholder")}
          className="max-h-24 min-h-10 resize-none border-0 bg-transparent px-1 py-2 text-sm text-[#123b59] shadow-none placeholder:text-[#536b7d] focus-visible:ring-0"
          maxLength={1800}
          rows={1}
          disabled={disabled}
        />
        <Button
          type="submit"
          size="icon"
          className="size-9 shrink-0 rounded-md"
          aria-label={t("chat.send")}
          disabled={!draft.trim() || disabled}
        >
          <ArrowUp size={18} />
        </Button>
      </div>
    </form>
  );
}
