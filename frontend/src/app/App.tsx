import type { WordGroup, WordInput } from "@yds-atlas/shared";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { AppFooter } from "@/app/components/app-footer";
import { AppHeader } from "@/app/components/app-header";
import type { AppScreen } from "@/app/components/app-header";
import { LoginPage } from "@/features/auth/components/login-page";
import { useHashScreen } from "@/app/hooks/use-hash-screen";
import { useNotify } from "@/app/hooks/use-notify";
import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import type { AccountState } from "@yds-atlas/shared";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { AccountDialog } from "@/features/auth/components/account-dialog";
import { AccountWorkspace } from "@/features/account/components/account-workspace";
import type { createAccountApi } from "@/features/account/api/account-api";

import { useAccountData } from "@/features/account/hooks/use-account-data";

const WordLibraryPage = lazy(() =>
  import("@/features/word-library/components/word-library-page").then((module) => ({
    default: module.WordLibraryPage,
  })),
);
const LearningGamePage = lazy(() =>
  import("@/features/learning-game/components/learning-game-page").then((module) => ({
    default: module.LearningGamePage,
  })),
);

export default function App() {
  const auth = useAuth();
  const { screen, navigate } = useHashScreen();
  const returnScreen = useRef<AppScreen>(screen === "login" ? "home" : screen);
  const openLogin = useCallback(() => {
    returnScreen.current = screen === "login" ? "home" : screen;
    navigate("login");
  }, [screen, navigate]);
  const finishLogin = useCallback(() => navigate(returnScreen.current), [navigate]);
  if (auth.loading)
    return (
      <p role="status" className="py-20 text-center text-atlas-navy">
        Oturum kontrol ediliyor…
      </p>
    );
  if (screen === "login" || auth.recovering)
    return (
      <LoginPage
        user={auth.user}
        recovering={auth.recovering}
        onSuccess={finishLogin}
        onRecovered={() => auth.setRecovering(false)}
        onBack={() => {
          auth.setRecovering(false);
          navigate("home");
        }}
      />
    );
  return (
    <AccountWorkspace key={auth.user?.id ?? "guest"} userId={auth.user?.id ?? null}>
      {(api, initial) => (
        <AppWorkspace auth={auth} api={api} initial={initial} onLogin={openLogin} />
      )}
    </AccountWorkspace>
  );
}

function AppWorkspace({
  auth,
  api,
  initial,
  onLogin,
}: {
  auth: ReturnType<typeof useAuth>;
  api: ReturnType<typeof createAccountApi> | null;
  initial: AccountState | null;
  onLogin: () => void;
}) {
  const notify = useNotify();
  const account = useAccountData(auth.user?.id, api, initial, notify);
  const library = account.library;
  const [accountOpen, setAccountOpen] = useState(false);
  const { screen, navigate } = useHashScreen();
  const [initialGroup, setInitialGroup] = useState<WordGroup | "all">("all");
  const [openCreateOnLibrary, setOpenCreateOnLibrary] = useState(false);

  function navigateLibrary(group: WordGroup | "all" = "all") {
    setInitialGroup(group);
    setOpenCreateOnLibrary(false);
    navigate("library");
  }

  function openLibraryForNewWord() {
    setInitialGroup("all");
    setOpenCreateOnLibrary(true);
    navigate("library");
  }

  async function saveWord(input: WordInput, id?: string) {
    await library.save(input, id);
  }

  return (
    <div className="flex min-h-screen flex-col bg-atlas-canvas">
      <AppHeader
        onOpenAccount={() => (auth.user ? setAccountOpen(true) : onLogin())}
        signedIn={!!auth.user}
        screen={screen}
        onNavigate={(nextScreen) => {
          setOpenCreateOnLibrary(false);
          navigate(nextScreen);
        }}
        onNotify={notify}
      />
      <main className="mx-auto w-full max-w-360 flex-1 px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
        {auth.error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {auth.error}
          </p>
        )}
        {auth.user && library.loadError && screen !== "library" && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {library.loadError}{" "}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => void library.reload()}
            >
              Yeniden dene
            </button>
          </div>
        )}
        {screen === "home" ? (
          <DashboardPage
            words={library.words}
            onGoalChange={(goal) => {
              void account.saveGoal(goal).then((saved) => {
                if (saved)
                  notify.info(
                    <span>
                      Günlük Kelime Hedefi:
                      <br />
                      <strong>{goal}</strong> Kelime Olarak Güncellendi
                    </span>,
                  );
              });
            }}
            onAddWord={openLibraryForNewWord}
            onOpenLibrary={navigateLibrary}
            onStartLearning={() => navigate("game")}
          />
        ) : screen === "game" ? (
          <Suspense
            fallback={
              <p className="py-20 text-center text-sm text-slate-500">Öğrenme rotan açılıyor…</p>
            }
          >
            <LearningGamePage
              words={library.words}
              listWords={library.list}
              onBack={() => navigate("home")}
              onNotify={notify}
              onAddMany={library.addMany}
              onApplyScores={library.applyScores}
              onPersistSession={account.persist}
              onCompleteSession={account.complete}
              onOpenLibrary={() => navigateLibrary()}
            />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-slate-500">
                <span className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-atlas-blue" />{" "}
                Kütüphane açılıyor...
              </div>
            }
          >
            <WordLibraryPage
              key={`${initialGroup}-${openCreateOnLibrary}`}
              initialGroup={initialGroup}
              initialCreate={openCreateOnLibrary}
              words={library.words}
              loading={library.loading}
              loadError={library.loadError}
              onReload={() => void library.reload()}
              onSave={saveWord}
              onAddMany={library.addMany}
              onRemove={library.remove}
              onRemoveMany={library.removeMany}
              onNotify={notify}
              onInitialCreateHandled={() => setOpenCreateOnLibrary(false)}
            />
          </Suspense>
        )}
      </main>
      <AppFooter />
      {auth.user && (
        <AccountDialog
          open={accountOpen}
          onOpenChange={setAccountOpen}
          user={auth.user}
          onImportGuest={account.importGuest}
        />
      )}
      <ToastContainer
        position="top-right"
        autoClose={3500}
        limit={3}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        aria-label="Uygulama bildirimleri"
        toastClassName="atlas-toast"
      />
    </div>
  );
}
