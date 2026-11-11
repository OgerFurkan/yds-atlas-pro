import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type AppLanguage,
  type ColorTheme,
  useAppPreferences,
} from "@/shared/hooks/use-app-preferences";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function PreferencesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { language, theme, setLanguage, setTheme } = useAppPreferences();
  const themes: { value: ColorTheme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("settings.light"), icon: Sun },
    { value: "dark", label: t("settings.dark"), icon: Moon },
    { value: "system", label: t("settings.system"), icon: Monitor },
  ];
  const languages: { value: AppLanguage; label: string }[] = [
    { value: "tr", label: t("settings.turkish") },
    { value: "en", label: t("settings.english") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="pr-14 max-sm:pr-12">
          <div className="min-w-0">
            <DialogTitle className="break-words">{t("settings.title")}</DialogTitle>
            <DialogDescription>{t("settings.description")}</DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-6 p-5">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-atlas-ink">
              {t("settings.language")}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {languages.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={language === option.value ? "default" : "outline"}
                  aria-pressed={language === option.value}
                  onClick={() => setLanguage(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-atlas-ink">
              {t("settings.theme")}
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {themes.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  type="button"
                  className="min-w-0 px-2"
                  variant={theme === value ? "default" : "outline"}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  <Icon size={16} /> {label}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>
      </DialogContent>
    </Dialog>
  );
}
