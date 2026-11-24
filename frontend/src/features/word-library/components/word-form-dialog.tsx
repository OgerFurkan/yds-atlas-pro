import { zodResolver } from "@hookform/resolvers/zod";
import type { WordEdit, WordEntry, WordInput } from "@yds-atlas/shared";
import { cefrLevelSchema, wordInputSchema } from "@yds-atlas/shared";
import { ArrowRight, Check, LoaderCircle, Pencil, Plus, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Notify } from "@/shared/lib/notify";
import { withOccurrenceKeys } from "@/shared/lib/occurrence-keys";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { WordEditConflict, WordEditLockUnavailable } from "../api/word-repository";
import { enrichWordInput } from "../data/starter-vocabulary";
import { useWordSpellcheck } from "../hooks/use-word-spellcheck";
import { needsAiMeaning, type WordAddMode } from "../model/manual-word-import";
import type { WordFillProgress } from "../model/prepare-word-inputs";
import { type WordFormValues, wordFormSchema } from "../model/word-form.schema";
import {
  editedWordFields,
  preserveExampleMetadata,
  toFormValues,
  toWordInput,
} from "../model/word-form-mappers";
import { AiFillProgress } from "./ai-fill-progress";
import { AiWordAssist } from "./ai-word-assist";
import { WordTextField } from "./word-form-fields";

interface WordFormDialogProps {
  open: boolean;
  word?: WordEntry;
  onOpenChange: (open: boolean) => void;
  onSave: (
    input: WordInput,
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
  ) => Promise<void>;
  onEdit: (patch: WordEdit, id: string, expectedUpdatedAt: string) => Promise<void>;
  onNotify: Notify;
}

export function WordFormDialog({
  open,
  word,
  onOpenChange,
  onSave,
  onEdit,
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
  const currentMeanings = useWatch({ control, name: "meanings" });
  const currentExamples = useWatch({ control, name: "examples" });
  const examplesPreview = (currentExamples ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const [editingExample, setEditingExample] = useState<number | "new" | null>(null);
  const [draftEnglish, setDraftEnglish] = useState("");
  const [draftTurkish, setDraftTurkish] = useState("");
  const [progress, setProgress] = useState<WordFillProgress | null>(null);
  const [saveConflict, setSaveConflict] = useState("");
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

  async function save(values: WordFormValues, mode: WordAddMode = "auto") {
    const spellingValue = values.word.trim().replace(/\s+/g, " ");
    setSaveConflict("");
    try {
      const checked =
        spellingValue === word?.word
          ? { normalized: word.word }
          : await spelling.verify(spellingValue);
      if (!checked) return;
      const input = toWordInput(values, checked.normalized);
      if (word) {
        const patch = editedWordFields(input, word, aiSource.current);
        if (Object.keys(patch).length) await onEdit(patch, word.id, word.updatedAt);
      } else {
        const source = wordInputSchema.parse(aiSource.current ?? { word: input.word });
        await onSave(
          enrichWordInput(preserveExampleMetadata(input, source)),
          mode === "manual" ? undefined : setProgress,
          mode,
        );
      }
      onOpenChange(false);
      onNotify.success(
        word
          ? "Kelime güncellendi."
          : mode === "manual" && needsAiMeaning(input)
            ? "Kelime kaydedildi. Türkçe anlamını sonra ekleyebilirsin."
            : "Kelime kaydedildi. Eksik bilgilerini daha sonra düzenleyebilirsin.",
      );
    } catch (error) {
      if (error instanceof WordEditConflict || error instanceof WordEditLockUnavailable)
        setSaveConflict(error.message);
      else onNotify.error(error instanceof Error ? error.message : "Kelime kaydedilemedi.");
    } finally {
      setProgress(null);
    }
  }

  function beginExampleEdit(index: number | "new") {
    const line = index === "new" ? "" : (examplesPreview[index] ?? "");
    const delimiter = line.indexOf("|");
    setDraftEnglish(delimiter < 0 ? line : line.slice(0, delimiter).trim());
    setDraftTurkish(delimiter < 0 ? "" : line.slice(delimiter + 1).trim());
    setEditingExample(index);
  }
  function commitExampleEdit() {
    if (!draftEnglish.trim()) return;
    const rows = [...examplesPreview];
    const updated = draftTurkish.trim()
      ? `${draftEnglish.trim()} | ${draftTurkish.trim()}`
      : draftEnglish.trim();
    if (editingExample === "new") rows.push(updated);
    else if (typeof editingExample === "number") rows[editingExample] = updated;
    setValue("examples", rows.join("\n"), { shouldDirty: true, shouldValidate: true });
    setEditingExample(null);
  }

  const inputClass =
    "min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/15";
  const labelClass = "flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="word-form-description"
        className="flex max-h-[min(92dvh,900px)] flex-col overflow-hidden rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl [&>button:last-child]:hidden sm:w-[min(680px,calc(100vw-24px))]"
      >
        <DialogHeader className="relative shrink-0 border-b border-border bg-card px-5 py-4 sm:px-6">
          <div className="min-w-0 pr-10">
            <p className="text-[10px] font-bold tracking-wider text-muted-foreground">
              KELİME KÜTÜPHANESİ
            </p>
            <DialogTitle className="text-foreground">
              {word ? "Kelimeyi düzenle" : "Yeni kelime ekle"}
            </DialogTitle>
            <DialogDescription id="word-form-description" className="text-muted-foreground">
              Anlamı, örnekleri ve öğrenme bilgilerini tek yerden yönet.
            </DialogDescription>
            {saveConflict && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {saveConflict}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Kelime penceresini kapat"
            title="Kapat"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </DialogHeader>
        <form
          id="atlas-word-form"
          className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4 pb-6 [scrollbar-color:var(--color-border)_transparent] sm:px-6"
          onSubmit={(event) => {
            void handleSubmit((values) => save(values))(event);
          }}
        >
          <section className="space-y-3" aria-label="Temel bilgiler">
            <h3 className="text-sm font-bold text-foreground">Temel bilgiler</h3>
            <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
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
              <label className={labelClass}>
                Türkçe anlamlar
                <input
                  className={inputClass}
                  {...register("meanings")}
                  placeholder="Örn. güvenilir"
                />
              </label>
              <label className={labelClass}>
                Kelime türü
                <input
                  className={inputClass}
                  {...register("partOfSpeech")}
                  placeholder="Örn. Adjective"
                />
              </label>
              <label className={labelClass}>
                CEFR seviyesi
                <select className={inputClass} {...register("cefr")}>
                  {cefrLevelSchema.options.map((level) => (
                    <option value={level} key={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Kullanım ayrımı
                <input
                  className={inputClass}
                  {...register("usageNote")}
                  placeholder="İsteğe bağlı bağlam notu"
                />
              </label>
            </div>
          </section>

          <section className="space-y-3 border-t border-border/70 pt-5" aria-label="Örnek cümleler">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-foreground">Örnek cümleler</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cümleleri yanındaki kalemle ayrı ayrı düzenle.
                </p>
              </div>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => beginExampleEdit("new")}
              >
                <Plus size={15} /> Cümle ekle
              </Button>
            </div>
            {/* Keep the RHF field registered; the row editor writes to this single canonical value. */}
            <textarea
              {...register("examples")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <section
              className="overflow-hidden rounded-xl border border-border/70 bg-background"
              aria-label="Örnek cümle listesi"
            >
              {withOccurrenceKeys(examplesPreview, (example) => example).map(
                ({ item: line, key }, index) => {
                  const separator = line.indexOf("|");
                  const english = separator < 0 ? line : line.slice(0, separator).trim();
                  const turkish = separator < 0 ? "" : line.slice(separator + 1).trim();
                  return (
                    <div
                      key={key}
                      className="border-b border-border/55 p-3 last:border-b-0 sm:px-4"
                    >
                      {editingExample === index ? (
                        <section className="space-y-2" aria-label={`${index + 1}. örneği düzenle`}>
                          <label className={labelClass}>
                            İngilizce cümle
                            <textarea
                              className={`${inputClass} min-h-16 py-2`}
                              value={draftEnglish}
                              onChange={(event) => setDraftEnglish(event.target.value)}
                              rows={2}
                            />
                          </label>
                          <label className={labelClass}>
                            Türkçe çeviri
                            <textarea
                              className={`${inputClass} min-h-16 py-2`}
                              value={draftTurkish}
                              onChange={(event) => setDraftTurkish(event.target.value)}
                              rows={2}
                            />
                          </label>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              onClick={() => setEditingExample(null)}
                            >
                              Vazgeç
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              disabled={!draftEnglish.trim()}
                              onClick={commitExampleEdit}
                            >
                              <Check size={15} /> Uygula
                            </Button>
                          </div>
                        </section>
                      ) : (
                        <div className="flex items-start gap-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mt-0.5 size-9 shrink-0 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground"
                            aria-label={`${index + 1}. örnek cümleyi düzenle`}
                            title="Cümleyi düzenle"
                            onClick={() => beginExampleEdit(index)}
                          >
                            <Pencil size={15} />
                          </Button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-6 text-foreground">
                              {english}
                            </p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              {turkish || "Türkçe çeviri eklenmemiş"}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                },
              )}
              {examplesPreview.length === 0 && (
                <p className="p-4 text-xs text-muted-foreground">Henüz örnek cümle yok.</p>
              )}
            </section>
            {editingExample === "new" && (
              <section
                className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3"
                aria-label="Yeni örnek cümle"
              >
                <label className={labelClass}>
                  İngilizce cümle
                  <textarea
                    className={`${inputClass} min-h-16 py-2`}
                    value={draftEnglish}
                    onChange={(event) => setDraftEnglish(event.target.value)}
                    rows={2}
                  />
                </label>
                <label className={labelClass}>
                  Türkçe çeviri
                  <textarea
                    className={`${inputClass} min-h-16 py-2`}
                    value={draftTurkish}
                    onChange={(event) => setDraftTurkish(event.target.value)}
                    rows={2}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingExample(null)}
                  >
                    Vazgeç
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!draftEnglish.trim()}
                    onClick={commitExampleEdit}
                  >
                    <Check size={15} /> Ekle
                  </Button>
                </div>
              </section>
            )}
          </section>

          <section className="space-y-2 border-t border-border pt-4" aria-label="AI kelime desteği">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Sparkles size={17} className="text-atlas-orange" aria-hidden="true" /> AI ile eksik
              bilgileri tamamla
            </div>
            <div className="rounded-xl bg-muted/20 p-3">
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
              {progress && <AiFillProgress progress={progress} />}
            </div>
          </section>

          <details
            className="group rounded-xl border border-border bg-muted/20"
            aria-label="Gelişmiş alanlar"
          >
            <summary className="cursor-pointer select-none px-3.5 py-3 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              Gelişmiş alanlar · ses, kaynak, puan
            </summary>
            <div className="grid gap-3 border-t border-border px-3.5 py-3 sm:grid-cols-2">
              <label className={labelClass}>
                Diğer yazılışlar
                <input
                  className={inputClass}
                  {...register("alternatives")}
                  placeholder="Alternatif biçimler"
                />
              </label>
              {word ? (
                <p className={labelClass}>Öğrenme puanı: {score}</p>
              ) : (
                <label className={labelClass}>
                  Öğrenme puanı: {score}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    className="min-h-10 w-full accent-atlas-orange"
                    {...register("score", { valueAsNumber: true })}
                  />
                </label>
              )}
              <label className={labelClass}>
                Sözlük bağlantısı
                <input
                  type="url"
                  className={inputClass}
                  {...register("sourceUrl")}
                  placeholder="https://..."
                />
              </label>
              <label className={labelClass}>
                UK telaffuz dosyası
                <input
                  type="url"
                  className={inputClass}
                  {...register("pronunciationUk")}
                  placeholder="URL"
                />
              </label>
              <label className={labelClass}>
                US telaffuz dosyası
                <input
                  type="url"
                  className={inputClass}
                  {...register("pronunciationUs")}
                  placeholder="URL"
                />
              </label>
            </div>
          </details>
        </form>
        <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-5 py-3.5 sm:px-6">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          {!word && !currentMeanings?.trim() && (
            <Button
              variant="outline"
              type="button"
              disabled={isSubmitting || spelling.checking}
              onClick={() => void handleSubmit((values) => save(values, "manual"))()}
            >
              Yalnız kelimeyi kaydet
            </Button>
          )}
          <Button
            type="submit"
            form="atlas-word-form"
            disabled={isSubmitting || editingExample !== null}
          >
            {isSubmitting || spelling.checking ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : null}
            {isSubmitting ? "Kaydediliyor…" : word ? "Değişiklikleri kaydet" : "Kütüphaneye ekle"}{" "}
            <ArrowRight size={16} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
