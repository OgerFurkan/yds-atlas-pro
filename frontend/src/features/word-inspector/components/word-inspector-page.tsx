import type { WordInput } from "@yds-atlas/shared";
import { BookMarked, Eye, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import {
  type InspectorChoice,
  type InspectorQuery,
  type InspectorResult,
  inspectFromPool,
  inspectorToWordInput,
} from "../api/word-inspector-api";
import { inspectorSaveBelongsTo } from "../model/word-inspector-model";
import { InspectorEntryCard } from "./inspector-entry-card";
import { TieredSentencePreview } from "./tiered-sentence-preview";

type AddResult = { added: number; duplicates: number };
interface WordInspectorPageProps {
  userId: string;
  onAddToLibrary: (word: WordInput) => Promise<AddResult>;
}

/** Search and sense selection are explicit. Never mounted inside game/assessment surfaces. */
export function WordInspectorPage({ userId, onAddToLibrary }: WordInspectorPageProps) {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<InspectorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; revision: number; message: string } | null>(
    null,
  );
  const pendingSearch = useRef<{ controller: AbortController | null; sequence: number }>({
    controller: null,
    sequence: 0,
  });
  const saveBusy = useRef(false);
  const alive = useRef(true);
  const resultHeading = useRef<HTMLHeadingElement | null>(null);
  const entry = result?.status === "ready" ? result.entry : null;

  useEffect(() => {
    if (!userId) return;
    const pending = pendingSearch.current;
    alive.current = true;
    return () => {
      alive.current = false;
      pending.sequence++;
      pending.controller?.abort();
    };
  }, [userId]);

  useEffect(() => {
    if (!loading && result) resultHeading.current?.focus();
  }, [loading, result]);

  async function search(query: InspectorQuery) {
    if (saveBusy.current) return;
    const seq = ++pendingSearch.current.sequence;
    pendingSearch.current.controller?.abort();
    const abort = new AbortController();
    pendingSearch.current.controller = abort;
    setLoading(true);
    setError("");
    setSaved(null);
    setResult(null);
    try {
      const response = await inspectFromPool(query, userId, abort.signal);
      if (!alive.current || seq !== pendingSearch.current.sequence || abort.signal.aborted) return;
      setResult(response);
    } catch (reason) {
      if (!alive.current || seq !== pendingSearch.current.sequence || abort.signal.aborted) return;
      setError(
        reason instanceof Error ? reason.message : "Kelime incelenemedi. Yeniden deneyebilirsin.",
      );
    } finally {
      if (alive.current && seq === pendingSearch.current.sequence) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    void search({ word: draft });
  }

  function pick(choice: InspectorChoice) {
    if (loading || saving || result?.status !== "choices") return;
    void search({ word: choice.word, partOfSpeech: choice.partOfSpeech, meaning: choice.meaning });
  }

  async function saveWord() {
    if (!entry || saveBusy.current || loading) return;
    saveBusy.current = true;
    setSaving(true);
    setError("");
    const identity = { id: entry.id, revision: entry.revision };
    try {
      const outcome = await onAddToLibrary(inspectorToWordInput(entry));
      if (!alive.current || !inspectorSaveBelongsTo(entry, identity)) return;
      setSaved({
        ...identity,
        message:
          outcome.added > 0
            ? "Kelime kütüphanene eklendi."
            : outcome.duplicates > 0
              ? "Kelime zaten kütüphanende; mevcut örneklerin korundu."
              : "Kayıt sonucu doğrulanamadı. Kütüphaneni kontrol et.",
      });
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : "Kelime kaydedilemedi.");
    } finally {
      saveBusy.current = false;
      if (alive.current) setSaving(false);
    }
  }

  return (
    <section aria-labelledby="inspector-title" className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="rounded-3xl border border-atlas-line bg-white px-5 py-7 shadow-sm sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-atlas-blue">
          <ShieldCheck size={16} aria-hidden="true" /> Atlas Lexicon{" "}
          <span className="text-slate-400">/</span> Word Inspector
        </div>
        <h1
          id="inspector-title"
          className="mt-3 font-display text-3xl font-semibold text-atlas-navy sm:text-4xl"
        >
          Kelimeyi derinlemesine incele
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          Ortak kelime havuzundaki doğrulanmış anlamları ve seviyelendirilmiş örnekleri gör.
          İnceleme AI başlatmaz ve AI kotanı kullanmaz. Havuzda olmayan bir kayıt için içerik
          uydurulmaz.
        </p>
        <search>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label
              htmlFor="inspector-word"
              className="flex-1 space-y-2 text-sm font-medium text-atlas-navy"
            >
              <span>İngilizce kelime veya ifade</span>
              <input
                id="inspector-word"
                type="search"
                autoComplete="off"
                maxLength={120}
                placeholder="Örn. obtain"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                className="block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-atlas-navy outline-none focus-visible:ring-2 focus-visible:ring-atlas-blue disabled:opacity-60"
              />
            </label>
            <Button
              type="submit"
              disabled={loading || saving || !draft.trim()}
              className="min-h-12 rounded-xl px-6"
            >
              <Search size={18} aria-hidden="true" /> {loading ? "Aranıyor…" : "Havuzda incele"}
            </Button>
          </form>
        </search>
      </div>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? "Kelime aranıyor."
          : error ||
            (result?.status === "missing"
              ? "Kelime henüz ortak havuzda yok."
              : result?.status === "choices"
                ? `${result.choices.length} anlam bulundu.`
                : result?.status === "ready"
                  ? "Kelime ayrıntıları hazır."
                  : "")}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {loading && (
        <p
          role="status"
          aria-busy="true"
          className="rounded-xl border border-atlas-line bg-white p-6 text-sm text-slate-600"
        >
          Ortak havuz kontrol ediliyor…
        </p>
      )}

      {!loading && result?.status === "missing" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 tabIndex={-1} ref={resultHeading} className="text-lg font-semibold text-atlas-navy">
            Henüz havuzda bulunmuyor
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            “{result.word}” için editör denetiminden geçmiş kayıt henüz bulunmuyor. İstersen
            kaydetmeden beş örnek taslağı oluşturabilirsin.
          </p>
          <TieredSentencePreview key={result.word} word={result.word} />
        </div>
      )}

      {!loading && result?.status === "choices" && (
        <section
          className="rounded-2xl border border-atlas-line bg-white p-5 sm:p-7"
          aria-labelledby="inspector-choices-title"
        >
          <h2
            id="inspector-choices-title"
            ref={resultHeading}
            tabIndex={-1}
            className="text-xl font-semibold text-atlas-navy"
          >
            Doğru anlamı seç
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Aynı kelimenin farklı türleri veya anlamları bulunuyor. Rastgele seçim yapmıyoruz.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {result.choices.map((item) => (
              <li key={`${item.id}-${item.revision}`}>
                <button
                  type="button"
                  onClick={() => pick(item)}
                  disabled={saving}
                  className="flex min-h-20 w-full items-center justify-between gap-4 rounded-xl border border-slate-200 px-5 py-4 text-left transition hover:border-atlas-blue hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atlas-blue disabled:opacity-50"
                >
                  <span>
                    <span className="block text-xs font-bold uppercase tracking-wide text-atlas-blue">
                      {item.partOfSpeech}
                    </span>
                    <strong className="mt-1 block text-base text-atlas-navy">{item.meaning}</strong>
                  </span>
                  <Eye size={20} aria-hidden="true" className="shrink-0 text-atlas-blue" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && entry && (
        <InspectorEntryCard
          entry={entry}
          heading={resultHeading}
          saving={saving}
          savedMessage={saved && inspectorSaveBelongsTo(entry, saved) ? saved.message : undefined}
          onSave={() => void saveWord()}
        />
      )}
      {!loading && !error && !result && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">
          <BookMarked size={24} className="mx-auto mb-3 text-atlas-blue" aria-hidden="true" />
          Başlamak için bir İngilizce kelime yazıp “Havuzda incele” seçeneğini kullan.
        </div>
      )}
    </section>
  );
}
