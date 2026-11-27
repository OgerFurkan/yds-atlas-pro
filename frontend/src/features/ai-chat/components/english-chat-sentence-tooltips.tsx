import { useMemo } from "react";
import { withOccurrenceKeys } from "@/shared/lib/occurrence-keys";
import { splitChatSentenceSegments } from "@/shared/vocabulary/sentence-tooltip";
import { SentenceWordTooltips } from "@/shared/vocabulary/sentence-word-tooltips";

/** Only English prose. Do not tokenize Turkish replies, URLs, code or raw markdown links. */
export function EnglishChatSentenceTooltips({ text }: { text: string }) {
  const segments = useMemo(() => splitChatSentenceSegments(text), [text]);
  return (
    <>
      {withOccurrenceKeys(segments, (segment) => segment.text).map(({ item: segment, key }) =>
        segment.english ? (
          <SentenceWordTooltips key={key} text={segment.text} />
        ) : (
          <span key={key}>{segment.text}</span>
        ),
      )}
    </>
  );
}
