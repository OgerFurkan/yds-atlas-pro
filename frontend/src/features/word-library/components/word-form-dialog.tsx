import { cefrLevelSchema } from "@yds-atlas/shared";
import { ArrowRight, LoaderCircle, Sparkles, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useWordEditor, type WordFormDialogProps } from "../hooks/use-word-editor";
import { AiFillProgress } from "./ai-fill-progress";
import { AiWordAssist } from "./ai-word-assist";
import { WordExampleEditor } from "./word-example-editor";
import { WordTextField } from "./word-form-fields";

export function WordFormDialog({
  open,
  word,
  canUseAi,
  onOpenChange,
  onSave,
  onEdit,
  onNotify,
}: WordFormDialogProps) {
  const {
    register,
    handleSubmit,
    errors,
    isSubmitting,
    wordField,
    score,
    currentWord,
    examplesPreview,
    editingExample,
    setEditingExample,
    draftEnglish,
    draftTurkish,
    setDraftEnglish,
    setDraftTurkish,
    beginExampleEdit,
    commitExampleEdit,
    progress,
    saveConflict,
    spelling,
    save,
    applyAiDraft,
  } = useWordEditor({ word, onOpenChange, onSave, onEdit, onNotify });
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

          <WordExampleEditor
            examplesPreview={examplesPreview}
            editingExample={editingExample}
            draftEnglish={draftEnglish}
            draftTurkish={draftTurkish}
            setDraftEnglish={setDraftEnglish}
            setDraftTurkish={setDraftTurkish}
            beginExampleEdit={beginExampleEdit}
            commitExampleEdit={commitExampleEdit}
            cancelEdit={() => setEditingExample(null)}
            examplesField={register("examples")}
            inputClass={inputClass}
            labelClass={labelClass}
          />
          <section className="space-y-2 border-t border-border pt-4" aria-label="AI kelime desteği">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Sparkles size={17} className="text-atlas-orange" aria-hidden="true" /> AI ile eksik
              bilgileri tamamla
            </div>
            <div className="rounded-xl bg-muted/20 p-3">
              <AiWordAssist key={currentWord} word={currentWord} onApply={applyAiDraft} />
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
          {!word && canUseAi && (
            <Button
              variant="outline"
              type="button"
              disabled={isSubmitting || spelling.checking}
              onClick={() => void handleSubmit((values) => save(values, "manual"))()}
            >
              Manuel kaydet
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
            {isSubmitting
              ? "Kaydediliyor…"
              : word
                ? "Değişiklikleri kaydet"
                : canUseAi
                  ? "AI ile kaydet"
                  : "Kütüphaneye ekle"}{" "}
            <ArrowRight size={16} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
