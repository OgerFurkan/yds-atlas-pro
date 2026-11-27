import type { editorialItem } from "@yds-atlas/shared";
import type { z } from "zod";

type Item = z.infer<typeof editorialItem>;
const classes = "block min-h-11 w-full rounded-md border border-input bg-card px-3 py-2";
export function ContentEditor({ item, onChange }: { item: Item; onChange: (next: Item) => void }) {
  const content = item.content;
  function update<K extends keyof Item["content"]>(key: K, value: Item["content"][K]) {
    onChange({ ...item, content: { ...content, [key]: value } });
  }
  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-1 font-semibold">{content.word || "Yeni kelime"}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Kelime
          <input
            className={classes}
            value={content.word}
            onChange={(e) => update("word", e.target.value)}
          />
        </label>
        <label>
          Kelime türü
          <select
            className={classes}
            value={content.partOfSpeech}
            onChange={(e) => update("partOfSpeech", e.target.value as typeof content.partOfSpeech)}
          >
            {[
              "Noun",
              "Verb",
              "Adjective",
              "Adverb",
              "Preposition",
              "Conjunction",
              "Pronoun",
              "Phrase",
              "Article",
              "Determiner",
              "Modal Verb",
              "Auxiliary Verb",
              "Numeral",
              "Interjection",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Türkçe anlamlar (satır başına bir anlam)
          <textarea
            className={classes}
            value={content.meanings.join("\n")}
            onChange={(e) => update("meanings", e.target.value.split("\n"))}
          />
        </label>
        <label>
          CEFR
          <select
            className={classes}
            value={content.cefr}
            onChange={(e) => update("cefr", e.target.value as typeof content.cefr)}
          >
            {["A1", "A2", "B1", "B2", "C1", "C2", "Belirtilmedi"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {(["ipaUk", "ipaUs", "pronunciationUk", "pronunciationUs"] as const).map((key, i) => (
          <label key={key}>
            {
              [
                "IPA · British",
                "IPA · American",
                "British ses adresi (HTTPS)",
                "American ses adresi (HTTPS)",
              ][i]
            }
            <input
              className={classes}
              value={content[key] ?? ""}
              onChange={(e) => update(key, e.target.value || undefined)}
            />
          </label>
        ))}
      </div>
      <label className="block">
        Kullanım notu
        <textarea
          className={classes}
          value={content.usageNote}
          onChange={(e) => update("usageNote", e.target.value)}
        />
      </label>
      {content.examples.map((ex, i) => {
        function change(next: typeof ex) {
          update(
            "examples",
            content.examples.map((original, n) => (n === i ? next : original)),
          );
        }
        return (
          <details key={["easy-1", "easy-2", "medium", "yds-1", "yds-2"][i]}>
            <summary className="cursor-pointer py-2 font-medium">
              Örnek {i + 1} · {ex.difficulty}
            </summary>
            <div className="space-y-2">
              <label className="block">
                İngilizce cümle
                <textarea
                  className={classes}
                  value={ex.sentence}
                  onChange={(e) => change({ ...ex, sentence: e.target.value })}
                />
              </label>
              <label className="block">
                Türkçe çeviri
                <textarea
                  className={classes}
                  value={ex.translation}
                  onChange={(e) => change({ ...ex, translation: e.target.value })}
                />
              </label>
              <label className="block">
                Hedef anlam (satır başına bir ifade)
                <textarea
                  className={classes}
                  value={ex.translationFocus.join("\n")}
                  onChange={(e) => change({ ...ex, translationFocus: e.target.value.split("\n") })}
                />
              </label>
            </div>
          </details>
        );
      })}
    </fieldset>
  );
}
