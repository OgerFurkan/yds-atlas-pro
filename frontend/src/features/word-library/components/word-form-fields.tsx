import { cefrLevelSchema } from "@yds-atlas/shared";
import { Check, LoaderCircle } from "lucide-react";
import type { ChangeEvent, FocusEvent } from "react";
import {
  type Control,
  Controller,
  type UseFormRegister,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import type { SpellcheckResult } from "../model/spellcheck.types";
import type { WordFormValues } from "../model/word-form.schema";

export const fieldClass =
  "h-10 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-700/50 focus:ring-2 focus:ring-sky-800/10";
const fieldLabelClass = "flex min-w-0 flex-col gap-1.5 text-[10px] font-semibold text-slate-600";

export function WordTextField({
  field,
  error,
  spellcheck,
  checking,
  allowUnknown,
  onWordChange,
  onWordBlur,
  onChooseSuggestion,
  onAcceptUnknown,
}: {
  field: UseFormRegisterReturn<"word">;
  error?: string;
  spellcheck?: SpellcheckResult;
  checking: boolean;
  allowUnknown: boolean;
  onWordChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onWordBlur: (event: FocusEvent<HTMLInputElement>) => void;
  onChooseSuggestion: (suggestion: string) => void;
  onAcceptUnknown: () => void;
}) {
  return (
    <>
      <label className={`${fieldLabelClass} col-span-2 max-[520px]:col-span-1`}>
        <span>
          İngilizce kelime <b className="text-orange-700">*</b>
        </span>
        <Input
          autoFocus
          className={fieldClass}
          {...field}
          onChange={onWordChange}
          onBlur={onWordBlur}
          placeholder="Örn. entitle"
          aria-invalid={Boolean(error)}
        />
        {error && <small className="text-[10px] font-medium text-red-700">{error}</small>}
      </label>

      {checking && (
        <p className="col-span-2 inline-flex items-center gap-2 text-[10px] text-slate-500 max-[520px]:col-span-1">
          <LoaderCircle className="animate-spin" size={14} /> Yazım denetleniyor...
        </p>
      )}
      {spellcheck?.casingChanged && (
        <p className="col-span-2 inline-flex items-center gap-1.5 text-[10px] text-emerald-800 max-[520px]:col-span-1">
          <Check size={14} /> Sözlük başlığını <strong>{spellcheck.normalized}</strong> olarak
          düzenledim.
        </p>
      )}
      {spellcheck && !spellcheck.isCorrect && (
        <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-950 max-[520px]:col-span-1">
          <p className="font-semibold">Bu yazımı sözlükte bulamadım. Yazımını kontrol et:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {spellcheck.suggestions.map((suggestion) => (
              <Button
                className="h-7 rounded border border-amber-300 bg-white px-2 text-[10px] text-amber-950 hover:bg-amber-100"
                key={suggestion}
                type="button"
                variant="outline"
                onClick={() => onChooseSuggestion(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
            {!allowUnknown && (
              <Button
                className="h-7 px-1 text-[10px] text-amber-900 underline"
                type="button"
                variant="link"
                onClick={onAcceptUnknown}
              >
                Yine de ekle
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function WordMetadataFields({
  register,
  control,
  score,
}: {
  register: UseFormRegister<WordFormValues>;
  control: Control<WordFormValues>;
  score: number;
}) {
  return (
    <>
      <label className={fieldLabelClass}>
        <span>Diğer yazılışlar</span>
        <Input
          className={fieldClass}
          {...register("alternatives")}
          placeholder="entitled, entitlement"
        />
      </label>
      <label className={fieldLabelClass}>
        <span>Kelime türü</span>
        <Input className={fieldClass} {...register("partOfSpeech")} placeholder="Örn. verb" />
      </label>
      <label className={fieldLabelClass}>
        <span>Türkçe anlamlar</span>
        <Input
          className={fieldClass}
          {...register("meanings")}
          placeholder="Virgülle ayırarak yaz"
        />
      </label>
      <div className={fieldLabelClass}>
        <span>CEFR seviyesi</span>
        <Controller
          control={control}
          name="cefr"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger aria-label="CEFR seviyesi">
                <SelectValue placeholder="Seviye seç" />
              </SelectTrigger>
              <SelectContent>
                {cefrLevelSchema.options.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <label className={`${fieldLabelClass} col-span-2 max-[520px]:col-span-1`}>
        <span>Kullanım ayrımı</span>
        <Input
          className={fieldClass}
          {...register("usageNote")}
          placeholder="Bu anlamın hangi bağlamda kullanıldığını not et"
        />
      </label>
      <label className={fieldLabelClass}>
        <span>Öğrenme puanı</span>
        <div className="flex h-10 items-center gap-3">
          <Input
            className="min-w-0 flex-1 accent-atlas-orange"
            type="range"
            min="0"
            max="100"
            {...register("score", { valueAsNumber: true })}
          />
          <strong className="grid size-8 place-items-center rounded bg-orange-50 text-xs text-orange-900">
            {score}
          </strong>
        </div>
      </label>
      <label className={fieldLabelClass}>
        <span>Sözlük bağlantısı</span>
        <Input
          className={fieldClass}
          type="url"
          {...register("sourceUrl")}
          placeholder="https://..."
        />
      </label>
      <label className={fieldLabelClass}>
        <span>UK telaffuz sesi</span>
        <Input
          className={fieldClass}
          type="url"
          {...register("pronunciationUk")}
          placeholder="Ses dosyası URL'si"
        />
      </label>
      <label className={fieldLabelClass}>
        <span>US telaffuz sesi</span>
        <Input
          className={fieldClass}
          type="url"
          {...register("pronunciationUs")}
          placeholder="Ses dosyası URL'si"
        />
      </label>
      <label className={`${fieldLabelClass} col-span-2 max-[520px]:col-span-1`}>
        <span>
          Örnek cümleler{" "}
          <small className="font-normal text-slate-400">
            (her satır bir cümle, çeviri için | ekle)
          </small>
        </span>
        <Textarea
          className={`${fieldClass} min-h-24 resize-y py-2`}
          rows={3}
          {...register("examples")}
          placeholder={
            "The law entitles you to a refund. | Kanun sana geri ödeme hakkı verir.\nShe is entitled to a break."
          }
        />
      </label>
    </>
  );
}
