import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

export function ConfirmationDialog({
  open,
  title,
  description,
  children,
  cancelLabel,
  confirmLabel,
  onClose,
  onConfirm,
  restoreFocus,
  busy = false,
}: {
  open: boolean;
  title: string;
  description: string;
  children?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  restoreFocus: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        role="alertdialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader className="block pr-14">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-sm">
            {description}
            {children}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2 p-4 sm:p-5">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            className="border border-destructive/40 bg-destructive/10"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
