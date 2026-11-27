import { createContext, type Dispatch, type SetStateAction } from "react";

type Context = {
  owner: string | null;
  enabled: boolean;
  lookup: boolean;
  active: string | null;
  select: Dispatch<SetStateAction<string | null>>;
};
export const VocabularyContext = createContext<Context>({
  owner: null,
  enabled: true,
  lookup: false,
  active: null,
  select: () => {},
});
