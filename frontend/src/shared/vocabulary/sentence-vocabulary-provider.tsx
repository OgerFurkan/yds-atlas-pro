import { type ReactNode, useMemo, useState } from "react";
import { VocabularyContext } from "./sentence-vocabulary-context";

export function SentenceVocabularyProvider({
  enabled = true,
  userId = null,
  allowPoolLookup = false,
  children,
}: {
  enabled?: boolean;
  userId?: string | null;
  allowPoolLookup?: boolean;
  children: ReactNode;
}) {
  const [active, select] = useState<string | null>(null);
  const value = useMemo(
    () => ({ owner: userId, enabled, lookup: allowPoolLookup, active, select }),
    [userId, enabled, allowPoolLookup, active],
  );
  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>;
}
