import {
  CircleHelp,
  Compass,
  Headphones,
  Home,
  LibraryBig,
  LogIn,
  Menu,
  Settings2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AtlasLogo } from "@/shared/brand/atlas-logo";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { LearningMenu } from "./learning-menu";

export type AppScreen = "home" | "library" | "game" | "login";
interface AppHeaderProps {
  screen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  onNotify: Notify;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  signedIn?: boolean;
}
export function AppHeader({
  screen,
  onNavigate,
  onNotify,
  onOpenAccount,
  onOpenSettings,
  signedIn,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  function go(next: AppScreen) {
    onNavigate(next);
    setMenuOpen(false);
  }
  return (
    <header className="sticky top-0 z-40 border-b border-atlas-line bg-white/95 backdrop-blur">
      <div className="relative mx-auto flex h-18 w-full max-w-[1600px] items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <button
          type="button"
          className="flex min-w-0 shrink-0 cursor-pointer items-center gap-3 text-left"
          aria-label={t("nav.home")}
          onClick={() => go("home")}
        >
          <AtlasLogo className="size-10 shadow-sm" />
          <span className="grid gap-1">
            <strong className="block whitespace-nowrap font-display text-[17px] leading-none text-atlas-navy">
              YDS Atlas <span className="text-atlas-orange">Pro</span>
            </strong>
            <small className="hidden whitespace-nowrap text-[9px] font-medium tracking-[0.08em] text-slate-500 min-[380px]:block">
              {t("brand.tagline")}
            </small>
          </span>
        </button>
        <Button
          className="ml-auto xl:hidden"
          variant="ghost"
          size="icon"
          aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </Button>
        <nav
          id="main-navigation"
          aria-label={t("nav.main")}
          className={`${menuOpen ? "absolute inset-x-0 top-18 flex flex-col border-b bg-white p-3 shadow-lg" : "hidden"} gap-1 xl:static xl:ml-auto xl:flex xl:flex-row xl:items-center xl:border-0 xl:p-0 xl:shadow-none`}
        >
          <Button
            variant="ghost"
            aria-current={screen === "home" ? "page" : undefined}
            className={`justify-start ${screen === "home" ? "bg-blue-50 text-atlas-navy" : ""}`}
            onClick={() => go("home")}
          >
            <Home size={18} />
            {t("nav.home")}
          </Button>
          <LearningMenu active={screen === "game"} onChoose={go} />
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => onNotify.info("Pratik oyunları yakında burada olacak.")}
          >
            <Headphones size={18} />
            {t("nav.practice")}
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => onNotify.info("İlerleme ekranı hazırlanıyor.")}
          >
            <Compass size={18} />
            {t("nav.progress")}
          </Button>
          <Button
            variant="ghost"
            aria-current={screen === "library" ? "page" : undefined}
            className={`justify-start ${screen === "library" ? "bg-blue-50 text-atlas-navy" : ""}`}
            onClick={() => go("library")}
          >
            <LibraryBig size={18} />
            {t("nav.library")}
          </Button>
          <Button
            variant="ghost"
            className="justify-start xl:hidden"
            onClick={() => {
              onOpenSettings();
              setMenuOpen(false);
            }}
          >
            <Settings2 size={18} /> {t("nav.settings")}
          </Button>
        </nav>
        <div className="flex shrink-0 items-center gap-1 xl:ml-auto">
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
            aria-label={t("nav.settings")}
            title={t("nav.settings")}
            onClick={onOpenSettings}
          >
            <Settings2 size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("nav.help")}
            onClick={() => {
              go("game");
              onNotify.info(t("nav.helpMessage"));
            }}
          >
            <CircleHelp size={20} />
          </Button>
          <Button
            variant={signedIn ? "ghost" : "default"}
            className="gap-2 px-2 sm:px-3"
            aria-label={signedIn ? t("nav.account") : t("nav.login")}
            onClick={onOpenAccount}
          >
            {signedIn ? (
              <span className="grid size-8 place-items-center rounded-full bg-blue-50 text-sm text-atlas-navy">
                A
              </span>
            ) : (
              <LogIn size={18} />
            )}
            <span className="hidden sm:inline">{signedIn ? t("nav.account") : t("nav.login")}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
