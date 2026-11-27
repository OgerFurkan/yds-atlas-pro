import { editorialItem } from "@yds-atlas/shared";
import { useState } from "react";
import type { ControlEntry, controlApi } from "../api/control-api";
import { editableDraftItems, type EditorialDraftItem as Item } from "../model/editorial-draft";

const empty = () => ({
  entryId: null,
  revision: 0,
  content: {
    word: "",
    partOfSpeech: "Noun",
    cefr: "B1",
    ipaUk: "",
    ipaUs: "",
    alternatives: [],
    meanings: [""],
    usageNote: "",
    examples: ["easy", "easy", "medium", "yds", "yds"].map((difficulty) => ({
      difficulty,
      sentence: "",
      translation: "",
      translationFocus: [""],
    })),
  },
  provenance: { license: "Atlas Original", source: "editor" },
});
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function useEditorialDraft(api: ReturnType<typeof controlApi>) {
  const [draft, setDraft] = useState(() => pretty([empty()]));
  const [aiTodo, setAiTodo] = useState("");
  const items = editableDraftItems(draft);
  function load(row: ControlEntry) {
    const { legacy, ...provenance } = row.provenance as Item["provenance"] & {
      legacy?: Item["legacy"];
    };
    setDraft(
      pretty([
        { entryId: row.id, revision: row.revision, content: row.content, provenance, legacy },
      ]),
    );
  }
  async function generate() {
    const terms = [
      ...new Set(
        aiTodo
          .split(/[,\n]/)
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    if (!terms.length || terms.length > 20) throw Error("1–20 kelime gir.");
    const items = JSON.parse(draft);
    if (!Array.isArray(items)) throw Error("Taslak listesi geçersiz.");
    if (items.length === 1 && JSON.stringify(items[0]) === JSON.stringify(empty())) items.pop();
    if (items.length + terms.length > 20) throw Error("Bir yayında en fazla 20 taslak olabilir.");
    for (const [i, word] of terms.entries()) {
      const data = await api.draft(word);
      items.push({ entryId: null, revision: 0, ...data });
      setDraft(pretty(items));
      setAiTodo(terms.slice(i + 1).join("\n"));
    }
  }
  async function regenerate(id: string) {
    const items = JSON.parse(draft) as Item[];
    const item = items.find((v) => v.entryId === id);
    if (!item) throw Error("Taslakta seçili revizyon yok.");
    const data = await api.draft(item.content.word);
    if (
      data.content.partOfSpeech !== item.content.partOfSpeech ||
      !data.content.meanings.some((m) => item.content.meanings.includes(m))
    )
      throw Error("Üretilen taslağın anlamı seçili kayıtla eşleşmedi. Ayrı taslak olarak incele.");
    const next = {
      ...item.content,
      examples: data.content.examples,
      usageNote: item.content.usageNote || data.content.usageNote,
    };
    setDraft(pretty(items.map((v) => (v === item ? { ...v, content: next } : v))));
  }
  function replaceItem(index: number, next: Item) {
    setDraft(pretty(items.map((value, i) => (i === index ? next : value))));
  }
  function append() {
    setDraft(pretty([...JSON.parse(draft), empty()]));
  }
  function publicationItems() {
    return editorialItem.array().min(1).max(20).parse(JSON.parse(draft));
  }
  return {
    draft,
    setDraft,
    aiTodo,
    setAiTodo,
    items,
    load,
    generate,
    regenerate,
    replaceItem,
    append,
    publicationItems,
  };
}
