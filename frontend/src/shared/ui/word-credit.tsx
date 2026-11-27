import type { WordAttribution } from "@yds-atlas/shared";
import { useTranslation } from "react-i18next";

export function WordCredit({ credit }: { credit: WordAttribution }) {
  const { i18n } = useTranslation();
  return (
    <p className="my-2 text-sm text-atlas-muted">
      <a className="underline" href={credit.source} target="_blank" rel="noreferrer">
        {credit.author}
      </a>
      {" · "}
      <a
        className="underline"
        href="https://creativecommons.org/licenses/by-sa/4.0/"
        target="_blank"
        rel="noreferrer"
      >
        {credit.license}
      </a>
      {credit.modified && (i18n.resolvedLanguage === "en" ? " · Adapted" : " · Uyarlanmış içerik")}
    </p>
  );
}
