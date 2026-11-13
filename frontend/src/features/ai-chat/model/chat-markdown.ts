/**
 * A deliberately small Markdown parser for AI chat bubbles.
 * It returns structured tokens, never HTML, so model output cannot inject markup.
 * Supported: paragraphs, headings, lists, quotes, fenced code, rules,
 * bold, italic, inline code, and HTTPS/HTTP links.
 */
export type ChatInline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "emphasis" | "code"; text: string }
  | { kind: "link"; text: string; url: string };

export type ChatBlock =
  | { kind: "paragraph" | "heading" | "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

// Only explicit HTTP(S) links can become clickable. Everything else remains text.
const INLINE_PATTERN =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)\n]+)\)|\*\*(.+?)\*\*|__(.+?)__|`([^`\n]+)`|\*([^*\n]+)\*|(?<!\w)_([^_\n]+)_(?!\w)/g;

export function parseChatInline(source: string): ChatInline[] {
  const result: ChatInline[] = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? cursor;
    if (index > cursor) result.push({ kind: "text", text: source.slice(cursor, index) });
    if (match[1] !== undefined && match[2] !== undefined) {
      result.push({ kind: "link", text: match[1], url: match[2] });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      result.push({ kind: "strong", text: match[3] ?? match[4] });
    } else if (match[5] !== undefined) {
      result.push({ kind: "code", text: match[5] });
    } else {
      result.push({ kind: "emphasis", text: match[6] ?? match[7] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < source.length) result.push({ kind: "text", text: source.slice(cursor) });
  return result;
}

function listMatch(line: string): { ordered: boolean; content: string } | null {
  const match = line.match(/^\s{0,3}([-*•]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  return { ordered: /^\d/.test(match[1]), content: match[2] };
}

export function parseChatBlocks(source: string): ChatBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").trim().split("\n");
  const blocks: ChatBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    if (/^\s*```/.test(line)) {
      index++;
      const code: string[] = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (/^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ kind: "rule" }); index++; continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (heading) { blocks.push({ kind: "heading", text: heading[1] }); index++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index++].replace(/^\s*>\s?/, ""));
      }
      blocks.push({ kind: "quote", text: quoted.join(" ") });
      continue;
    }
    const first = listMatch(line);
    if (first) {
      const items = [first.content];
      index++;
      while (index < lines.length) {
        const next = listMatch(lines[index]);
        if (!next || next.ordered !== first.ordered) break;
        items.push(next.content);
        index++;
      }
      blocks.push({ kind: "list", ordered: first.ordered, items });
      continue;
    }
    const paragraph = [line.trim()];
    index++;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim() || listMatch(next) || /^\s*(?:```|>|#{1,6}\s|---+\s*$)/.test(next)) break;
      paragraph.push(next.trim());
      index++;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}
