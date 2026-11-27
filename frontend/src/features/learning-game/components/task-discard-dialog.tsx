import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";

export function TaskDiscardDialog({
  open,
  discarding,
  discardError,
  discardTrigger,
  onClose,
  onDiscard,
}: {
  open: boolean;
  discarding: boolean;
  discardError: string;
  discardTrigger: RefObject<HTMLElement | null>;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(open) => !open && !discarding && onClose()}>
      <DialogContent
        role="alertdialog"
        className="max-w-md bg-card p-5 text-foreground sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (discardTrigger.current?.isConnected) discardTrigger.current.focus();
          else document.querySelector<HTMLElement>("#task-intro button, #game-exit")?.focus();
        }}
      >
        <div className="pr-9">
          <DialogTitle className="mt-0 text-foreground">{t("taskIntro.discardTitle")}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t("taskIntro.confirmDiscard")}
          </DialogDescription>
        </div>
        {discardError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {discardError}
          </p>
        )}
        <div className="mt-5 grid gap-2 sm:flex sm:justify-end">
          <Button variant="outline" disabled={discarding} onClick={() => onClose()}>
            {t("taskIntro.discardCancel")}
          </Button>
          <Button
            variant="destructive"
            className="border border-destructive/40 bg-destructive/10"
            disabled={discarding}
            onClick={onDiscard}
          >
            {t(discarding ? "taskIntro.discarding" : "taskIntro.discardConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
