import { zodResolver } from "@hookform/resolvers/zod";
import { type WordEdit, type WordEntry, type WordInput, wordInputSchema } from "@yds-atlas/shared";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Notify } from "@/shared/lib/notify";
import { WordEditConflict, WordEditLockUnavailable } from "../api/word-repository";
import { needsAiMeaning, type WordAddMode } from "../model/manual-word-import";
import type { WordFillProgress } from "../model/prepare-word-inputs";
import { type WordFormValues, wordFormSchema } from "../model/word-form.schema";
import {
  editedWordFields,
  preserveExampleMetadata,
  toFormValues,
  toWordInput,
} from "../model/word-form-mappers";
import { useWordSpellcheck } from "./use-word-spellcheck";

export interface WordFormDialogProps {
  open: boolean;
  word?: WordEntry;
  canUseAi: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    input: WordInput,
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
  ) => Promise<void>;
  onEdit: (patch: WordEdit, id: string, expectedUpdatedAt: string) => Promise<void>;
  onNotify: Notify;
}

export function useWordEditor({
  word,
  onOpenChange,
  onSave,
  onEdit,
  onNotify,
}: Omit<WordFormDialogProps, "open" | "canUseAi">) {
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
          preserveExampleMetadata(input, source),
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

  function applyAiDraft(input: WordInput) {
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
  }
  return {
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
  };
}
