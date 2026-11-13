import { BookOpen, History, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ChatWelcomeProps {
  onChoose: (suggestion: string) => void;
}

/** Suggested first questions, shown only for a new conversation. */
export function ChatWelcome({ onChoose }: ChatWelcomeProps) {
  const { t } = useTranslation();
  const suggestions = t("chat.suggestions", { returnObjects: true }) as string[];
  const suggestionIcons = [BookOpen, Sparkles, History];
  return (
    <div className="flex flex-col">
      <h2 className="text-center text-xl font-bold">{t("chat.greeting")}</h2>
      <p className="mt-2 text-center text-sm text-[#536b7d]">{t("chat.welcome")}</p>
      <div className="mt-1">
        {suggestions.map((suggestion, index) => {
          const Icon = suggestionIcons[index] ?? Sparkles;
          return (
            <button
              type="button"
              key={suggestion}
              className="flex w-full items-center gap-4 border-b border-[#dce6ec] px-2 py-4 text-left text-sm hover:bg-atlas-navy/70"
              onClick={() => onChoose(suggestion)}
            >
              <Icon size={20} className="shrink-0 text-[#f27637]" />
              {suggestion}
            </button>
          );
        })}
      </div>
      <img
        src="/brand/atlas-mascot.png"
        alt=""
        className="mx-auto mt-4 h-32 w-40 object-contain object-bottom"
      />
    </div>
  );
}
