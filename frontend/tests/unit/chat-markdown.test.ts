import { expect, test } from "bun:test";
import { parseChatBlocks, parseChatInline } from "../../src/features/ai-chat/model/chat-markdown";

test("Gemini's Indicate answer shows bold headings and real synonym bullets", () => {
  const result = parseChatBlocks(
    "**Indicate**, YDS'de sık çıkan bir fiildir.\n\n" +
    "**Anlamı:** Göstermek, belirtmek.\n\n" +
    "**YDS'deki Eş Anlamlıları:**\n* Show\n* Demonstrate\n* Point out\n\n" +
    "**Örnek Cümle:**\n* The research indicates a link.",
  );
  expect(result.map((block) => block.kind)).toEqual([
    "paragraph", "paragraph", "paragraph", "list", "paragraph", "list",
  ]);
  expect(parseChatInline("**Indicate** means *show*.")).toEqual([
    { kind: "strong", text: "Indicate" },
    { kind: "text", text: " means " },
    { kind: "emphasis", text: "show" },
    { kind: "text", text: "." },
  ]);
  expect(result[3]).toEqual({ kind: "list", ordered: false, items: ["Show", "Demonstrate", "Point out"] });
});

test("untrusted model text remains text, not injected HTML or JS links", () => {
  expect(parseChatInline("<script>alert('x')</script> [bad](javascript:alert(1))")).toEqual([
    { kind: "text", text: "<script>alert('x')</script> [bad](javascript:alert(1))" },
  ]);
  expect(parseChatInline("[source](https://example.com/entry)")).toEqual([
    { kind: "link", text: "source", url: "https://example.com/entry" },
  ]);
});

test("numbered lists and fenced code are grouped into semantic blocks", () => {
  expect(parseChatBlocks("1. First\n2. Second\n\n```ts\nconst a = 1;\n```" )).toEqual([
    { kind: "list", ordered: true, items: ["First", "Second"] },
    { kind: "code", text: "const a = 1;" },
  ]);
});

test("empty, mixed line endings and malformed formatting never cause a crash", () => {
  expect(parseChatBlocks(" \r\n ")).toEqual([]);
  expect(parseChatInline("An unmatched **bold marker")).toEqual([
    { kind: "text", text: "An unmatched **bold marker" },
  ]);
});
