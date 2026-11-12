import type { User } from "@supabase/supabase-js";
import { Cloud, LogOut } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/shared/api/supabase-client";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
export function AccountDialog({
  open,
  onOpenChange,
  user,
  onImportGuest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  onImportGuest?: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="pr-8">
            <DialogTitle>Hesabım</DialogTitle>
            <DialogDescription>
              Kelimelerin ve ilerlemen hesabınla birlikte yanında.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-5 p-5">
          <div className="rounded-xl bg-blue-50 p-4 text-sm text-atlas-navy">
            <Cloud size={23} className="mb-2" />
            <strong className="break-all">{user.email}</strong>
            <p className="mt-2 leading-6 text-slate-600">
              Hesabındaki kelimeler ve günlük görevler bulutta saklanır. Bu cihazdaki misafir
              kayıtların ayrıca korunur.
            </p>
          </div>
          {onImportGuest && (
            <Button
              variant="outline"
              className="w-full whitespace-normal"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onImportGuest();
                  setMessage(
                    "Cihazdaki kelimeler aktarıldı. Mevcut kelimeler korunarak tekrarlar atlandı.",
                  );
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Aktarım başarısız.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Bu cihazdaki misafir kelimelerini hesabıma aktar
            </Button>
          )}
          <Button
            className="w-full"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await supabase?.auth.signOut({ scope: "local" });
                if (result?.error) setMessage("Çıkış yapılamadı. Yeniden dene.");
                else onOpenChange(false);
              } catch {
                setMessage("Çıkış yapılamadı.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={17} /> Çıkış yap
          </Button>
          {message && (
            <p
              role="status"
              className="rounded-lg bg-orange-50 p-3 text-sm leading-6 text-orange-900"
            >
              {message}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
