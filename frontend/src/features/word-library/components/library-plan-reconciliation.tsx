import type { WordEntry } from "@yds-atlas/shared";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import type { useAccountPlan } from "../hooks/use-account-plan";

type AccountPlan = ReturnType<typeof useAccountPlan>;
export function PendingPlanCommand({
  cloud,
  onConfirmed,
}: {
  cloud: AccountPlan;
  onConfirmed: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label="Bekleyen plan işlemi" className="grid gap-3">
      <p role="status">{cloud.error || t("accountData.unconfirmed")}</p>
      <details>
        <summary>{t("accountData.intent")}</summary>
        <pre className="overflow-auto">{cloud.pending}</pre>
      </details>
      <Button
        disabled={cloud.busy}
        onClick={() =>
          void cloud.replay().then((confirmed) => {
            if (confirmed) onConfirmed();
          })
        }
      >
        {t("accountData.replay")}
      </Button>
      <Button
        disabled={cloud.busy}
        variant="outline"
        onClick={() => {
          if (window.confirm(t("accountData.abandon"))) cloud.abandon();
        }}
      >
        {t("accountData.current")}
      </Button>
    </section>
  );
}
export function LibraryPlanReconciliation({
  cloud,
  words,
}: {
  cloud: AccountPlan;
  words: WordEntry[];
}) {
  const { t } = useTranslation();
  const wordLabels = new Map(words.map((word) => [word.id, word.word]));
  return (
    <section aria-label="Plan seçimi" className="my-4 grid gap-2">
      <p>{t("accountData.choose")}</p>
      {(
        [
          ["accountData.local", cloud.legacy],
          ["accountData.remote", cloud.server],
        ] as const
      ).map(
        ([label, doc]) =>
          doc && (
            <details key={label}>
              <summary>{t(label)}</summary>
              <p>{t("accountData.size", { size: doc.size })}</p>
              {doc.groups.map((group) => (
                <p key={group.day}>
                  {t("accountData.day", { day: group.day })} ·{" "}
                  {group.words.map((id) => wordLabels.get(id) ?? id).join(", ")}
                </p>
              ))}
              <p>
                {t("accountData.excluded")} ·{" "}
                {doc.exclusions.map((id) => wordLabels.get(id) ?? id).join(", ") || "—"}
              </p>
            </details>
          ),
      )}
      {!!cloud.orphanIds.length && (
        <p role="note">
          Kütüphanede bulunmayan {cloud.orphanIds.length} kayıt cihazdaki özgün planda korunacak.
          Buluta yalnız mevcut kelimeler aktarılır. {cloud.orphanIds.join(", ")}
        </p>
      )}
      {cloud.server && <Button onClick={cloud.chooseServer}>{t("accountData.keep")}</Button>}
      <Button
        onClick={() => {
          if (
            (!cloud.orphanIds.length ||
              window.confirm("Eksik kelimeleri cihazda koruyarak mevcut atamaları aktar?")) &&
            (!cloud.server || window.confirm(t("accountData.replace")))
          )
            void cloud.chooseLocal();
        }}
      >
        {cloud.legacy ? t("accountData.upload") : t("accountData.start")}
      </Button>
    </section>
  );
}
