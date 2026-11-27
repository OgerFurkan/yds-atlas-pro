import { Button } from "@/shared/ui/button";
import type { useOnlineAssessment } from "../hooks/use-online-assessment";
import type { LearningGamePageProps } from "../model/learning-task";
import { OnlineGame } from "./online-game";

export function OnlineAssessmentEntry({
  online,
  onPresetHandled,
  onOnlineFinished,
  onBack,
  onNotify,
}: Pick<LearningGamePageProps, "onPresetHandled" | "onOnlineFinished" | "onBack" | "onNotify"> & {
  online: ReturnType<typeof useOnlineAssessment>;
}) {
  if (online.error)
    return (
      <section role="alert">
        {online.error}{" "}
        <Button disabled={online.busy} onClick={() => void online.retry()}>
          Yeniden doğrula
        </Button>
        {
          <Button variant="outline" onClick={() => online.setPractice(true)}>
            Puansız pratik
          </Button>
        }
      </section>
    );
  if (online.view)
    return (
      <OnlineGame
        key={online.view.id + ":" + online.view.revision}
        view={online.view}
        busy={online.busy}
        act={(action) => void online.act(action)}
        leave={() => {
          onPresetHandled?.();
          if (online.view?.status !== "active") online.forget();
          if (online.view?.status === "complete" && onOnlineFinished) {
            void onOnlineFinished()
              .then(onBack)
              .catch(() => onNotify.error("Sonuç kaydedildi. Hesap verilerini yeniden yükle."));
          } else onBack();
        }}
      />
    );
  if (online.busy) return <p role="status">Çevrimiçi değerlendirme yükleniyor…</p>;
  return null;
}
