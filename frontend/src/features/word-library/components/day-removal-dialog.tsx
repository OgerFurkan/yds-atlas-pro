import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export interface DayRemoval {
  ids: string[];
  planRevision: string;
  wordRevisions: string[];
  conflicts: string[];
  blocked: "account" | "task" | null;
}

function focusAcknowledgement(input: HTMLInputElement | null) {
  input?.focus();
}

export function DayRemovalDialog({
  day,
  removal,
  taskActive,
  onClose,
  onClear,
  onDelete,
  restoreFocus,
}: {
  day: number;
  removal: DayRemoval;
  taskActive: boolean;
  onClose: () => void;
  onClear: () => Promise<boolean>;
  onDelete: () => Promise<void>;
  restoreFocus: () => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  const [permanent, setPermanent] = useState(false);
  const [finalStep, setFinalStep] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");
  const locked = useRef(false);
  const canDelete = removal.ids.length > 0 && !removal.blocked && !removal.conflicts.length;
  const count = removal.ids.length;

  async function submit() {
    if (locked.current) return;
    if (permanent && !canDelete) return;
    if (permanent && !finalStep) {
      setIssue("");
      setFinalStep(true);
      return;
    }
    if (permanent && !acknowledged) return;
    locked.current = true;
    setBusy(true);
    setIssue("");
    try {
      if (permanent) await onDelete();
      else if (!(await onClear())) {
        setIssue(t("library.daily.manage.clearDayFailed"));
        return;
      }
      onClose();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : t("library.daily.manage.clearDayFailed"));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !locked.current && onClose()}>
      <DialogContent
        role="alertdialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader className="block pr-14">
          <DialogTitle>
            {t(`library.daily.manage.${finalStep ? "deleteDayConfirmTitle" : "clearDayTitle"}`, {
              day,
              count,
            })}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t(
              `library.daily.manage.${finalStep ? "deleteDayConfirmDescription" : "dayRemovalDescription"}`,
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-4 py-4 sm:px-5">
          {finalStep ? (
            <label className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                ref={focusAcknowledgement}
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-atlas-orange"
              />
              {t("library.daily.manage.deleteDayAcknowledge", { count })}
            </label>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">{t("library.daily.manage.dayRemovalChoice")}</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 has-[:checked]:border-atlas-blue has-[:checked]:bg-atlas-blue-pale">
                <input
                  className="mt-1 size-4 shrink-0 accent-atlas-blue"
                  type="radio"
                  name={name}
                  checked={!permanent}
                  onChange={() => setPermanent(false)}
                />
                <span>
                  <strong className="block text-sm text-foreground">
                    {t("library.daily.manage.clearOnly")}
                  </strong>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {t("library.daily.manage.clearDayDescription")}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 has-[:checked]:border-destructive/50 has-[:checked]:bg-destructive/10">
                <input
                  className="mt-1 size-4 shrink-0 accent-atlas-orange"
                  type="radio"
                  name={name}
                  checked={permanent}
                  disabled={!canDelete}
                  onChange={() => setPermanent(true)}
                />
                <span>
                  <strong className="block text-sm text-foreground">
                    {t("library.daily.manage.deleteDayWords")}
                  </strong>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {t("library.daily.manage.deleteDayCount", { count })}
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          {!!removal.conflicts.length && (
            <p className="rounded-lg bg-muted p-3 text-sm text-foreground">
              {t("library.daily.manage.deleteDayConflict", { count: removal.conflicts.length })}
            </p>
          )}
          {removal.blocked && (
            <p className="rounded-lg bg-muted p-3 text-sm text-foreground">
              {t(`library.daily.manage.deleteDayBlocked_${removal.blocked}`)}
            </p>
          )}
          {taskActive && (
            <p className="text-xs text-muted-foreground">
              {t("library.daily.manage.clearDayActiveTask")}
            </p>
          )}
          {issue && (
            <p role="alert" className="text-sm text-destructive">
              {issue}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4 sm:px-5">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("library.daily.manage.confirmCancel")}
          </Button>
          <Button
            variant={permanent ? "destructive" : "default"}
            className={permanent ? "border border-destructive/40 bg-destructive/10" : undefined}
            disabled={busy || (permanent && (!canDelete || (finalStep && !acknowledged)))}
            onClick={() => void submit()}
          >
            {t(`library.daily.manage.${permanent ? "deleteDayWords" : "clearDay"}`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
