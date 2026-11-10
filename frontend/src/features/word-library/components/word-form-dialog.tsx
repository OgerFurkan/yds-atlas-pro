import { zodResolver } from "@hookform/resolvers/zod";
import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { ArrowRight, LoaderCircle, Sparkles } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { enrichWordInput } from "../data/starter-vocabulary";
import { useWordSpellcheck } from "../hooks/use-word-spellcheck";
import { type WordFormValues, wordFormSchema } from "../model/word-form.schema";
import { toFormValues, toWordInput } from "../model/word-form-mappers";
import { WordMetadataFields, WordTextField } from "./word-form-fields";
import { useRef } from "react";
import { wordInputSchema } from "@yds-atlas/shared";
import { AiWordAssist } from "./ai-word-assist";

interface WordFormDialogProps {
  open: boolean;
  word?: WordEntry;
  onOpenChange: (open: boolean) => void;
  onSave: (input: WordInput, id?: string) => Promise<void>;
  onNotify: Notify;
}

export function WordFormDialog({
  open,
  word,
  onOpenChange,
  onSave,
  onNotify,
}: WordFormDialogProps) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<WordFormValues>({
    resolver: zodResolver(wordFormSchema),
    defaultValues: toFormValues(word),
  });
  const wordField = register("word");
  const score = useWatch({ control, name: "score" });
  const currentWord = useWatch({ control, name: "word" });
  const aiSource = useRef<WordInput | undefined>(undefined);
  const spelling = useWordSpellcheck({
    setWord: (value, options) =>
      setValue("word", value, {
        shouldDirty: true,
        shouldValidate: true,
        shouldTouch: options?.touch,
      }),
    onNotify,
  });

  async function save(values: WordFormValues, acceptedWord?: string) {
    const spellingValue = acceptedWord ?? values.word.trim().replace(/\s+/g, " ");
    try {
      const checked = await spelling.verify(spellingValue);
      if (!checked) return;
      const input = toWordInput(values, checked.normalized);
      const source = wordInputSchema.parse(aiSource.current ?? word ?? { word: input.word });
      input.examples = input.examples?.map((example) => {
        const original = source.examples.find(
          (item) => item.sentence === example.sentence && item.translation === example.translation,
        );
        return original
          ? { ...example, translationFocus: original.translationFocus, source: original.source }
          : example;
      });
      await onSave(enrichWordInput(input), word?.id);
      onOpenChange(false);
      onNotify.success(word ? "Kelime güncellendi." : "Kelime kütüphanene eklendi.");
    } catch (error) {
      onNotify.error(error instanceof Error ? error.message : "Kelime kaydedilemedi.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="word-form-description">
        <DialogHeader>
          <div className="pr-8">
            <p className="text-[9px] font-bold tracking-[1px] text-orange-800/70">
              KELİME KÜTÜPHANESİ
            </p>
            <DialogTitle>{word ? "Kelimeyi düzenle" : "Yeni kelime ekle"}</DialogTitle>
            <DialogDescription id="word-form-description">
              Kelime bilgilerini kaydet ve daha sonra güncelle.
            </DialogDescription>
          </div>
        </DialogHeader>
        <form
          className="space-y-4 p-5 max-sm:p-4"
          onSubmit={(event) => {
            void handleSubmit((values) => save(values))(event);
          }}
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 max-[520px]:grid-cols-1">
            <WordTextField
              field={wordField}
              error={errors.word?.message}
              spellcheck={spelling.spellcheck}
              checking={spelling.checking}
              allowUnknown={spelling.allowUnknown}
              onWordChange={(event) => {
                spelling.reset();
                void wordField.onChange(event);
              }}
              onWordBlur={(event) => {
                void wordField.onBlur(event);
                void spelling.check(event.currentTarget.value);
              }}
              onChooseSuggestion={spelling.chooseSuggestion}
              onAcceptUnknown={spelling.acceptUnknown}
            />
            <WordMetadataFields register={register} control={control} score={score} />
          </div>
          <div className="flex items-start gap-2 rounded-md bg-sky-50 px-3 py-2.5 text-[10px] leading-4 text-slate-600">
            <Sparkles className="mt-0.5 shrink-0 text-atlas-blue" size={15} />
            <p>
              Başlangıç setindeki 20 kelimenin bilgileri otomatik tamamlanır. Diğer kelimelerin
              anlam ve örneklerini ekleyebilirsin. Başlık ve boşluklar otomatik düzenlenir.
            </p>
          </div>
          <AiWordAssist
            key={currentWord}
            word={currentWord}
            onApply={(input) => {
              aiSource.current = input;
              const data = wordInputSchema.parse(input);
              const now = new Date().toISOString();
              const current = getValues();
              reset({
                ...toFormValues({ ...data, id: "draft", createdAt: now, updatedAt: now }),
                score: current.score,
                sourceUrl: current.sourceUrl,
                pronunciationUk: current.pronunciationUk,
                pronunciationUs: current.pronunciationUs,
              });
              spelling.reset();
            }}
          />
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={isSubmitting || spelling.checking}>
              {isSubmitting || spelling.checking ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : null}
              {word ? "Değişiklikleri kaydet" : "Kütüphaneye ekle"} <ArrowRight size={16} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
