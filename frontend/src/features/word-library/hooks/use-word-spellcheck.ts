import { useRef, useState } from "react";
import type { Notify } from "@/shared/lib/notify";
import { checkSpelling as inspectSpelling } from "../api/spellcheck";
import type { SpellcheckResult } from "../model/spellcheck.types";

interface WordSpellcheckOptions {
  /** Writes the reviewed spelling back into the form field. */
  setWord: (value: string, options?: { touch?: boolean }) => void;
  onNotify: Notify;
}

export function useWordSpellcheck({ setWord, onNotify }: WordSpellcheckOptions) {
  const [spellcheck, setSpellcheck] = useState<SpellcheckResult>();
  const [checking, setChecking] = useState(false);
  const [allowUnknown, setAllowUnknown] = useState(false);
  const version = useRef(0);

  function applyCasing(result: SpellcheckResult) {
    if (result.casingChanged) setWord(result.normalized);
  }

  async function check(value: string) {
    if (!value.trim()) return;
    const current = ++version.current;
    setChecking(true);
    try {
      const result = await inspectSpelling(value);
      if (current !== version.current) return;
      setSpellcheck(result);
      applyCasing(result);
    } catch (error) {
      if (current === version.current)
        onNotify.error(error instanceof Error ? error.message : "Yazım denetlenemedi.");
    } finally {
      if (current === version.current) setChecking(false);
    }
  }

  /** Reviews the final spelling before saving. Returns null when saving must wait for a choice. */
  async function verify(value: string) {
    version.current += 1;
    const result = await inspectSpelling(value);
    setSpellcheck(result);
    applyCasing(result);
    return result.isCorrect || allowUnknown ? result : null;
  }

  function chooseSuggestion(suggestion: string) {
    setWord(suggestion, { touch: true });
    setSpellcheck({
      normalized: suggestion,
      casingChanged: false,
      isCorrect: true,
      suggestions: [],
    });
    setAllowUnknown(false);
  }

  function reset() {
    version.current += 1;
    setChecking(false);
    setSpellcheck(undefined);
    setAllowUnknown(false);
  }

  function acceptUnknown() {
    setAllowUnknown(true);
  }

  return {
    spellcheck,
    checking,
    allowUnknown,
    check,
    verify,
    chooseSuggestion,
    reset,
    acceptUnknown,
  };
}
