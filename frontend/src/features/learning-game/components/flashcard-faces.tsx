import type { WordEntry } from "@yds-atlas/shared";
import { FlipHorizontal2, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { FittedWord } from "@/features/learning-game/components/fitted-word";
import { formatWordType } from "@/features/word-library/model/word-normalization";
import { AtlasLogo } from "@/shared/brand/atlas-logo";
import { Badge } from "@/shared/ui/badge";

const hiddenBackface: CSSProperties = {
  backfaceVisibility: "hidden",
  WebkitBackfaceVisibility: "hidden",
};

const FACE_SIZE =
  "relative col-start-1 row-start-1 flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-3xl border px-5 py-6 sm:min-h-[480px] sm:px-8 sm:py-8";

const frontBackground = {
  background:
    "radial-gradient(circle at 50% 15%, rgba(255,255,255,0.15), transparent 55%), linear-gradient(153deg, #194561 0%, #113650 46%, #09263B 100%)",
};

export function FlashcardFront({ word, hidden }: { word: WordEntry; hidden: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden={hidden}
      className={`${FACE_SIZE} justify-between border-[#28516B] text-white shadow-[0_14px_38px_rgba(8,36,56,0.24),inset_0_1px_0_rgba(255,255,255,0.20),inset_0_-5px_0_rgba(0,0,0,0.12)]`}
      style={{ ...hiddenBackface, ...frontBackground }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-2.25 rounded-[17px] border border-white/15"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full border border-white/9"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -left-16 size-52 rounded-full border border-white/8"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-0.5 w-1/2 -translate-x-1/2 bg-linear-to-r from-transparent via-orange-300/70 to-transparent"
      />

      <span className="relative z-10 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.20em] text-slate-100">
          <AtlasLogo className="size-7" /> ATLAS
        </span>
        <span className="rounded-full border border-orange-200/35 bg-white/6 px-3 py-1 text-[10px] font-semibold tracking-[0.16em] text-orange-100">
          YDS Pro
        </span>
      </span>

      <span className="relative z-10 flex min-w-0 flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
        <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.30em] text-blue-100/75">
          <span className="h-px w-5 bg-orange-300/70" />
          {t("game.cardTitle")}
          <span className="h-px w-5 bg-orange-300/70" />
        </span>
        <FittedWord
          text={word.word}
          maxSize={55}
          minSize={20}
          className="font-display font-semibold leading-[1.13] tracking-tight text-white"
        />
        <span className="h-0.75 w-11 rounded-full bg-atlas-orange shadow-[0_0_16px_rgba(242,118,55,0.30)]" />
        <span className="text-sm leading-6 text-[#C9DAE7]">{t("game.flipHint")}</span>
      </span>

      <span className="relative z-10 flex items-center justify-between gap-3 border-t border-white/15 pt-5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.20em] text-blue-100/65">
          {t("brand.tagline")}
        </span>
        <span className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors duration-200 group-hover:bg-white/20">
          <FlipHorizontal2 size={16} /> {t("game.flip")}
        </span>
      </span>
    </span>
  );
}

export function FlashcardBack({ word, hidden }: { word: WordEntry; hidden: boolean }) {
  const { t } = useTranslation();
  const meaning = word.meanings.join(" · ");
  const hasCefr = word.cefr && word.cefr !== "Belirtilmedi";

  return (
    <span
      id="word-information"
      aria-hidden={hidden}
      className={`${FACE_SIZE} atlas-card-back border-slate-200 text-atlas-navy shadow-[0_14px_38px_rgba(8,36,56,0.16),inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-5px_0_rgba(16,50,70,0.055)]`}
      style={{
        ...hiddenBackface,
        transform: "rotateY(180deg)",
        background: "linear-gradient(153deg, #FFFEFC 0%, #F5F8FA 100%)",
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-2.25 rounded-[17px] border border-slate-200"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-0.75 w-1/2 -translate-x-1/2 bg-linear-to-r from-transparent via-atlas-orange to-transparent"
      />

      <span className="relative z-10 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.17em] text-atlas-navy">
          <AtlasLogo className="size-6" /> ATLAS
        </span>
        <span className="flex items-center gap-1 rounded-full bg-atlas-orange-pale px-3 py-1 text-[10px] font-bold tracking-[0.12em] text-atlas-orange-dark">
          <Sparkles size={12} /> {t("game.cardTitle")}
        </span>
      </span>

      <span className="relative z-10 mt-8 flex flex-col items-center gap-3 text-center">
        <FittedWord
          text={word.word}
          maxSize={45}
          minSize={19}
          className="font-display font-semibold leading-tight tracking-tight text-atlas-navy"
        />
        <span className="flex flex-wrap justify-center gap-2">
          <Badge variant="outline" className="border-slate-200 bg-white/80 text-atlas-navy"
            style={{ backgroundColor: "#ffffff", borderColor: "#cbd5e1", color: "#123b59" }}>
            {formatWordType(word.partOfSpeech) || t("game.undefinedType")}
          </Badge>
          {hasCefr && (
            <Badge
              variant="outline"
              className="border-orange-200 bg-atlas-orange-pale text-atlas-orange-dark"
              style={{ backgroundColor: "#fff1e9", borderColor: "#fed7aa", color: "#9a3e17" }}
            >
              {word.cefr}
            </Badge>
          )}
        </span>
      </span>

      <span className="relative z-10 my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="size-1.5 rounded-full bg-atlas-orange" />
        <span className="h-px flex-1 bg-slate-200" />
      </span>

      <span className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span className="text-[10px] font-bold uppercase tracking-[0.23em] text-slate-500">
          {t("game.turkishMeaning")}
        </span>
        <span className="w-full wrap-break-word text-[clamp(1.25rem,4.2vw,1.55rem)] font-semibold leading-[1.45]">
          {meaning || t("game.meaningMissing")}
        </span>
        {word.usageNote && (
          <span className="mt-3 w-full rounded-xl border border-slate-200 bg-white/75 px-4 py-3 text-left"
            style={{ backgroundColor: "rgba(255,255,255,0.96)", borderColor: "#cbd5e1" }}>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.13em] text-slate-600">
              {t("game.usageNote")}
            </span>
            <span className="block wrap-break-word text-sm leading-6 text-slate-700">
              {word.usageNote}
            </span>
          </span>
        )}
      </span>

      <span className="relative z-10 mt-7 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {t("game.cardFooter")}
        </span>
        <span className="flex items-center gap-2 rounded-full bg-atlas-blue-pale px-3 py-2 text-xs font-semibold text-atlas-navy">
          <FlipHorizontal2 size={16} /> {t("game.flipBack")}
        </span>
      </span>
    </span>
  );
}
