import type { WordGroup } from "@yds-atlas/shared";
import { lazy, Suspense, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ToastContainer } from "react-toastify";
import { LearningGamePage } from "@/features/learning-game/components/learning-game-page";
import "react-toastify/dist/ReactToastify.css";

import { AppFooter } from "@/app/components/app-footer";
import type { AppScreen } from "@/app/components/app-header";
import { AppHeader } from "@/app/components/app-header";
import { AtlasToastClose, AtlasToastIcon } from "@/app/components/atlas-toast-controls";
import { useHashScreen } from "@/app/hooks/use-hash-screen";
import { useNotify } from "@/app/hooks/use-notify";
import type { createAccountApi } from "@/features/account/api/account-api";
import { AccountWorkspace } from "@/features/account/components/account-workspace";
import { useAccountData } from "@/features/account/hooks/use-account-data";
import type { AccountBootstrap } from "@/features/account/model/account-cache";
import { AiChatWidget } from "@/features/ai-chat/components/ai-chat-widget";
import { AccountDialog } from "@/features/auth/components/account-dialog";
import { LoginPage } from "@/features/auth/components/login-page";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import {
  hasActiveLocalGame,
  readSession,
  subscribeGameChanges,
} from "@/features/learning-game/task-storage";
import { INSPECTOR_UI_ENABLED } from "@/features/word-inspector/api/word-inspector-api";
import type { DailyGroup, DailyGroupPreset } from "@/features/word-library/model/daily-groups";
import { wordLibraryActions } from "@/features/word-library/model/word-library-actions";
import { PreferencesDialog } from "@/shared/ui/preferences-dialog";
import { SentenceVocabularyProvider } from "@/shared/vocabulary/sentence-vocabulary-provider";

const ControlCenter = lazy(() => import("@/features/control-center/components/control-center"));
const WordInspectorPage = lazy(() =>
  import("@/features/word-inspector/components/word-inspector-page").then((module) => ({
    default: module.WordInspectorPage,
  })),
);

const WordLibraryPage = lazy(() =>
  import("@/features/word-library/components/word-library-page").then((module) => ({
    default: module.WordLibraryPage,
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
  if (screen === "control-center")
    return auth.user ? (
      <Suspense fallback={<p role="status">Yönetim alanı açılıyor…</p>}>
        <ControlCenter key={auth.user.id} owner={auth.user.id} />
      </Suspense>
    ) : (
      <main className="p-8">
        <button type="button" onClick={openLogin}>
          Yönetim için giriş yap
        </button>
      </main>
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
  initial: AccountBootstrap | null;
  onLogin: () => void;
}) {
  const { t } = useTranslation();
  const notify = useNotify();
  const account = useAccountData(auth.user?.id, api, initial, notify);
  const library = account.library;
  const inspectorBlocked = useSyncExternalStore(subscribeGameChanges, hasActiveLocalGame);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { screen, navigate } = useHashScreen();
  const [initialGroup, setInitialGroup] = useState<WordGroup | "all">("all");
  const [openCreateOnLibrary, setOpenCreateOnLibrary] = useState(false);
  const [gamePreset, setGamePreset] = useState<DailyGroupPreset | null>(null);
  const clearGamePreset = useCallback(() => setGamePreset(null), []);

  function navigateLibrary(group: WordGroup | "all" = "all") {
    setInitialGroup(group);
    setOpenCreateOnLibrary(false);
    setGamePreset(null);
    navigate("library");
  }

  function openLibraryForNewWord() {
    setInitialGroup("all");
    setOpenCreateOnLibrary(true);
    setGamePreset(null);
    navigate("library");
  }

  function studyDailyGroup(group: DailyGroup) {
    if (hasActiveLocalGame()) {
      notify.info(t("taskIntro.chooseSavedTask"));
      if (!readSession()) {
        return;
      }
    }
    setGamePreset({
      day: group.day,
      wordIds: group.playableWords.map((word) => word.id),
    });
    navigate("game");
  }

  const { saveWord, saveWordProtected, addWords } = wordLibraryActions(
    library,
    auth.user?.id,
    inspectorBlocked,
  );

  return (
    <SentenceVocabularyProvider
      userId={auth.user?.id}
      enabled={screen !== "game" && !inspectorBlocked}
      allowPoolLookup={!!auth.user && screen !== "game" && !inspectorBlocked}
    >
      <div className="flex min-h-screen flex-col bg-atlas-canvas">
        <AppHeader
          onOpenAccount={() => (auth.user ? setAccountOpen(true) : onLogin())}
          onOpenSettings={() => setSettingsOpen(true)}
          signedIn={!!auth.user}
          showInspector={
            !!auth.user && INSPECTOR_UI_ENABLED && screen !== "game" && !inspectorBlocked
          }
          screen={screen}
          onNavigate={(nextScreen) => {
            setOpenCreateOnLibrary(false);
            setGamePreset(null);
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
          {library.loadError && screen !== "library" && (
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
              onGoalChange={(goal, previous) =>
                account.saveGoal(goal, previous).then((saved) => {
                  if (saved)
                    notify.info(
                      <span>
                        Günlük Kelime Hedefi:
                        <br />
                        <strong>{goal}</strong> Kelime Olarak Güncellendi
                      </span>,
                    );
                  return saved;
                })
              }
              onAddWord={openLibraryForNewWord}
              onOpenLibrary={navigateLibrary}
              onStartLearning={() => navigate("game")}
            />
          ) : screen === "inspector" ? (
            !auth.user || !INSPECTOR_UI_ENABLED ? (
              <p role="alert">Word Inspector şu an erişime açık değil.</p>
            ) : inspectorBlocked ? (
              <div role="alert" className="rounded-xl border bg-white p-6">
                Devam eden oyunun sırasında Word Inspector kapalı. İlerlemen korunuyor.
                <button type="button" className="ml-4 underline" onClick={() => navigate("game")}>
                  Oyuna dön
                </button>
              </div>
            ) : (
              <Suspense fallback={<p role="status">Kelime inceleme açılıyor…</p>}>
                <WordInspectorPage
                  userId={auth.user.id}
                  onAddToLibrary={(word) => library.addMany([word])}
                />
              </Suspense>
            )
          ) : screen === "game" ? (
            <Suspense
              fallback={
                <p className="py-20 text-center text-sm text-slate-500">Öğrenme rotan açılıyor…</p>
              }
            >
              <LearningGamePage
                onlineOwner={initial?.onlineProtocol === 1 ? auth.user?.id : undefined}
                onOnlineFinished={account.refreshProgress}
                words={library.words}
                listWords={library.list}
                preset={gamePreset}
                onPresetHandled={clearGamePreset}
                onBack={() => navigate("home")}
                onNotify={notify}
                onAddMany={addWords}
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
                verifyPlanWords={library.verifyPlanWords}
                loadError={library.loadError}
                automaticLegacyRepair={!!auth.user && !hasActiveLocalGame()}
                accountId={auth.user?.id ?? null}
                cloudPlanEnabled={initial?.planProtocol === 1}
                onReload={library.reload}
                onRecoverEmpty={library.recoverEmpty}
                onSave={saveWord}
                onEdit={library.edit}
                onSaveProtected={saveWordProtected}
                listStudyWords={library.list}
                onAddMany={addWords}
                onRemove={library.remove}
                onRemoveMany={library.removeMany}
                onStudyGroup={studyDailyGroup}
                studyBlocked={inspectorBlocked}
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
        <PreferencesDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <AiChatWidget
          owner={auth.user?.id ?? null}
          onLogin={onLogin}
          assessmentActive={inspectorBlocked}
        />
        <ToastContainer
          position="top-right"
          autoClose={3500}
          limit={3}
          newestOnTop
          closeOnClick={false}
          pauseOnFocusLoss
          aria-label={t("common.notifications")}
          toastClassName="atlas-toast"
          icon={AtlasToastIcon}
          closeButton={AtlasToastClose}
        />
      </div>
    </SentenceVocabularyProvider>
  );
}
