import type { WordInput } from "@yds-atlas/shared";
import { useState } from "react";
import type { Notify } from "@/shared/lib/notify";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { WordImportReview } from "./word-import-review";

interface BulkWordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMany: (words: WordInput[]) => Promise<{ added: number; duplicates: number }>;
  onNotify: Notify;
}
export function BulkWordDialog({ open, onOpenChange, onAddMany, onNotify }: BulkWordDialogProps) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>Toplu kelime ekle</DialogTitle>
            <DialogDescription>
              Yazımı incele. Giriş yaptıysan eksik bilgiler Gemini ile tamamlanır (bir seferde 25
              kelimeye kadar); misafir kullanımında eksik bilgiler otomatik tamamlanmaz.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="p-5">
          <WordImportReview
            busy={saving}
            onAccept={async (words) => {
              setSaving(true);
              try {
                const result = await onAddMany(words.map((word) => ({ word })));
                onNotify.success(
                  `${result.added} kelime eklendi, ${result.duplicates} tekrar atlandı.`,
                );
                onOpenChange(false);
              } finally {
                setSaving(false);
              }
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
