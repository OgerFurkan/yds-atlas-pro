import type { WordInput } from "@yds-atlas/shared";
import { hasActiveLocalGame } from "@/features/learning-game/task-storage";
import { completeWordsWithGemini } from "@/features/word-library/api/ai-word-api";
import { lookupStudyContent } from "@/features/word-library/api/day-study-api";
import type { WordAddMode } from "@/features/word-library/model/manual-word-import";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import { prepareWordInputs } from "@/features/word-library/model/prepare-word-inputs";
import { ApiError } from "@/shared/api/api-client";
import type { useWordLibrary } from "../hooks/use-word-library";

export function wordLibraryActions(
  library: Pick<ReturnType<typeof useWordLibrary>, "list" | "save" | "addMany" | "reload">,
  owner: string | undefined,
  inspectorBlocked: boolean,
) {
  async function saveWord(
    input: WordInput,
    onProgress?: (progress: WordFillProgress) => void,
    mode: WordAddMode = "auto",
  ) {
    const [prepared] = await prepareInputs([input], mode, onProgress);
    await library.save(prepared);
  }

  async function prepareInputs(
    inputs: WordInput[],
    mode: WordAddMode,
    progress?: (value: WordFillProgress) => void,
  ) {
    if (mode === "manual" || !owner) return inputs;
    if (inspectorBlocked || hasActiveLocalGame())
      throw new Error("Çalışma sırasında içerik tamamlanamaz.");
    return prepareWordInputs(
      inputs,
      library.list(),
      (names, senses) => completeWordsWithGemini(names, undefined, owner, senses),
      progress,
      (input) => lookupStudyContent(input, owner),
    );
  }

  async function saveWordProtected(
    input: WordInput,
    id: string,
    expectedUpdatedAt: string,
    signal?: AbortSignal,
  ) {
    try {
      return await library.save(input, id, expectedUpdatedAt, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof ApiError && error.status === 409))
        await library.reload();
      throw error;
    }
  }

  async function addWords(
    inputs: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
    mode: WordAddMode = "auto",
    persist: typeof library.addMany = library.addMany,
  ) {
    return persist(await prepareInputs(inputs, mode, onProgress));
  }

  return { saveWord, saveWordProtected, addWords };
}
