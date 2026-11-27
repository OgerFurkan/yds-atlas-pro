import { Button } from "@/shared/ui/button";
import type { useEditorialDraft } from "../hooks/use-editorial-draft";
import type { EditorialDraftItem } from "../model/editorial-draft";
import { ContentEditor } from "./content-editor";

export function ControlEditorPanel({
  editor,
  selected,
  run,
  onPublish,
}: {
  editor: ReturnType<typeof useEditorialDraft>;
  selected: { id: string } | null;
  run: (fn: () => Promise<void>) => Promise<void>;
  onPublish: (items: EditorialDraftItem[]) => Promise<void>;
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Taslak ve yayın</h2>
      <label className="block">
        AI ile hazırlanacak kelimeler (satır başına bir kelime)
        <textarea
          className="block w-full rounded border p-2"
          value={editor.aiTodo}
          onChange={(e) => editor.setAiTodo(e.target.value)}
        />
      </label>
      <Button variant="outline" onClick={() => void run(editor.generate)}>
        AI taslaklarını hazırla
      </Button>
      {selected && (
        <Button variant="outline" onClick={() => void run(() => editor.regenerate(selected.id))}>
          Seçili anlam için örnekleri yeniden taslakla
        </Button>
      )}
      {editor.items.map((item, i) => (
        <ContentEditor
          key={item.entryId ?? "new-" + i}
          item={item}
          onChange={(next) => editor.replaceItem(i, next)}
        />
      ))}
      <details>
        <summary className="cursor-pointer">Toplu JSON ve lisans düzenleyicisi</summary>
        <label className="block">
          Kelime, anlam, tür, IPA, örnekler ve kaynak (JSON düzenleyici)
          <textarea
            spellCheck={false}
            rows={16}
            className="block w-full rounded border p-3 font-mono text-sm"
            value={editor.draft}
            onChange={(e) => editor.setDraft(e.target.value)}
          />
        </label>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void run(async () => editor.append())}>
          Kelime ekle
        </Button>
        <Button
          onClick={() =>
            void run(async () => {
              const items = editor.publicationItems();
              if (
                window.confirm(
                  items.length + " kaydın anlamını, lisansını ve örneklerini doğrulayıp yayınla?",
                )
              )
                await onPublish(items);
            })
          }
        >
          İncele ve yayınla
        </Button>
      </div>
    </section>
  );
}
