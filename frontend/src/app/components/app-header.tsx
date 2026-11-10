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
  signedIn?: boolean;
}
export function AppHeader({
  screen,
  onNavigate,
  onNotify,
  onOpenAccount,
  signedIn,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  function go(next: AppScreen) {
    onNavigate(next);
    setMenuOpen(false);
  }
  return (
    <header className="sticky top-0 z-40 border-b border-atlas-line bg-white/95 backdrop-blur">
      <div className="relative mx-auto flex h-[72px] w-full max-w-[1600px] items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <button
          type="button"
          className="flex min-w-0 shrink-0 cursor-pointer items-center gap-2.5 text-left"
          aria-label="YDS Atlas ana sayfa"
          onClick={() => go("home")}
        >
          <AtlasLogo />
          <span>
            <strong className="block font-display text-lg text-atlas-navy">YDS Atlas</strong>
            <small className="mt-0.5 hidden whitespace-nowrap text-[11px] text-slate-500 min-[380px]:block">
              Her kelime bir keşif.
            </small>
          </span>
        </button>
        <Button
          className="ml-auto xl:hidden"
          variant="ghost"
          size="icon"
          aria-label={menuOpen ? "Menüyü kapat" : "Menüyü aç"}
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </Button>
        <nav
          id="main-navigation"
          aria-label="Ana gezinme"
          className={`${menuOpen ? "absolute inset-x-0 top-[72px] flex flex-col border-b bg-white p-3 shadow-lg" : "hidden"} gap-1 xl:static xl:ml-auto xl:flex xl:flex-row xl:items-center xl:border-0 xl:p-0 xl:shadow-none`}
        >
          <Button
            variant="ghost"
            aria-current={screen === "home" ? "page" : undefined}
            className={`justify-start ${screen === "home" ? "bg-blue-50 text-atlas-navy" : ""}`}
            onClick={() => go("home")}
          >
            <Home size={18} />
            Ana Sayfa
          </Button>
          <LearningMenu active={screen === "game"} onChoose={go} />
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => onNotify.info("Pratik oyunları yakında burada olacak.")}
          >
            <Headphones size={18} />
            Pratik
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => onNotify.info("İlerleme ekranı hazırlanıyor.")}
          >
            <Compass size={18} />
            İlerlemem
          </Button>
          <Button
            variant="ghost"
            aria-current={screen === "library" ? "page" : undefined}
            className={`justify-start ${screen === "library" ? "bg-blue-50 text-atlas-navy" : ""}`}
            onClick={() => go("library")}
          >
            <LibraryBig size={18} />
            Kütüphane
          </Button>
        </nav>
        <div className="flex shrink-0 items-center gap-1 xl:ml-auto">
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
            aria-label="Ayarlar"
            onClick={() =>
              onNotify.info(
                "Günlük hedefini ana sayfadaki Hedefi düzenle düğmesinden değiştirebilirsin.",
              )
            }
          >
            <Settings2 size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Yardım"
            onClick={() => {
              go("game");
              onNotify.info("Hazırlık rehberi veya Oyunu dene ile adım adım başlayabilirsin.");
            }}
          >
            <CircleHelp size={20} />
          </Button>
          <Button
            variant={signedIn ? "ghost" : "default"}
            className="gap-2 px-2 sm:px-3"
            aria-label={signedIn ? "Hesabım" : "Giriş yap"}
            onClick={onOpenAccount}
          >
            {signedIn ? (
              <span className="grid size-8 place-items-center rounded-full bg-blue-50 text-sm text-atlas-navy">
                A
              </span>
            ) : (
              <LogIn size={18} />
            )}
            <span className="hidden sm:inline">{signedIn ? "Hesabım" : "Giriş yap"}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
