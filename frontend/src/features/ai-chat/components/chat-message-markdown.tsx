import type { ReactNode } from "react";
import { parseChatBlocks, parseChatInline } from "../model/chat-markdown";

/** Model output is always rendered as React text nodes; no HTML injection. */
function renderInline(content: string): ReactNode[] {
  return parseChatInline(content).map((token, index) => {
    const key = `${index}-${token.kind}`;
    switch (token.kind) {
      case "strong":
        return <strong key={key} className="font-bold text-[#113d60]">{token.text}</strong>;
      case "emphasis":
        return <em key={key} className="italic">{token.text}</em>;
      case "code":
        return <code key={key} className="rounded bg-[#edf3f7] px-1 py-0.5 font-mono text-[0.9em] text-[#123b59]">{token.text}</code>;
      case "link":
        return <a key={key} href={token.url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-[#17649c] underline decoration-[#a4c3d9] underline-offset-2 hover:text-[#0e436a]">{token.text}</a>;
      default:
        return <span key={key}>{token.text}</span>;
    }
  });
}

export function ChatMessageMarkdown({ content }: { content: string }) {
  const blocks = parseChatBlocks(content);
  return (
    <div className="min-w-0 space-y-2.5 break-words text-[13px] leading-[1.7] text-[#234961] sm:text-sm">
      {blocks.map((block, index) => {
        const key = `${index}-${block.kind}`;
        switch (block.kind) {
          case "heading":
            return <h3 key={key} className="text-sm font-bold leading-6 text-[#123b59]">{renderInline(block.text)}</h3>;
          case "paragraph":
            return <p key={key}>{renderInline(block.text)}</p>;
          case "quote":
            return <blockquote key={key} className="border-l-[3px] border-[#9ebbd2] bg-[#f4f8fb] px-3 py-2 text-[#345b74]">{renderInline(block.text)}</blockquote>;
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag key={key} className={`ml-5 space-y-1 pl-0 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-[#3b749d]`}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">{renderInline(item)}</li>
                ))}
              </ListTag>
            );
          }
          case "code":
            return <pre key={key} className="max-w-full overflow-x-auto rounded-xl bg-[#eef4f8] p-3 text-xs leading-5 text-[#183c55]"><code>{block.text}</code></pre>;
          case "rule":
            return <hr key={key} className="border-[#d5e4ed]" />;
        }
      })}
    </div>
  );
}
