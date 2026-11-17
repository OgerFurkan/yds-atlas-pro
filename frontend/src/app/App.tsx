import type { WordGroup, WordInput } from "@yds-atlas/shared";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import type { AccountState } from "@yds-atlas/shared";
import { AppFooter } from "@/app/components/app-footer";
import type { AppScreen } from "@/app/components/app-header";
import { AppHeader } from "@/app/components/app-header";
import { AtlasToastClose, AtlasToastIcon } from "@/app/components/atlas-toast-controls";
import { useHashScreen } from "@/app/hooks/use-hash-screen";
import { useNotify } from "@/app/hooks/use-notify";
import type { createAccountApi } from "@/features/account/api/account-api";
import { AccountWorkspace } from "@/features/account/components/account-workspace";
import { useAccountData } from "@/features/account/hooks/use-account-data";
import { AiChatWidget } from "@/features/ai-chat/components/ai-chat-widget";
import { AccountDialog } from "@/features/auth/components/account-dialog";
import { LoginPage } from "@/features/auth/components/login-page";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import { checkAdminAccess } from "@/features/admin/api/admin-api";
import { ADMIN_UI_ENABLED, useAdminAccess } from "@/features/admin/hooks/use-admin-access";
import { INSPECTOR_UI_ENABLED } from "@/features/word-inspector/api/word-inspector-api";
import { readSession } from "@/features/learning-game/model/game-storage";
import { completeWordsWithGemini } from "@/features/word-library/api/ai-word-api";
import type { DailyGroup, DailyGroupPreset } from "@/features/word-library/model/daily-groups";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import { prepareWordInputs } from "@/features/word-library/model/prepare-word-inputs";
import { PreferencesDialog } from "@/shared/ui/preferences-dialog";

const AdminDashboard = lazy(() => import("@/features/admin/components/admin-dashboard").then(x => ({default:x.AdminDashboard})));
const WordInspectorPage = lazy(() =>
  import("@/features/word-inspector/components/word-inspector-page").then((module) => ({
    default: module.WordInspectorPage,
  })),
);
const AdminControlCenterPage = lazy(() =>
  import("@/features/admin/components/admin-control-center-page").then((module) => ({
    default: module.AdminControlCenterPage,
  })),
);
/** Read from the existing account-scoped game store; do not clear or mutate progress. */
function hasActiveSavedGame(): boolean {
  const session = readSession();
  return session !== null && !session.tutorial && session.phase !== "complete";
}

/** Hash/back-forward and cross-tab storage changes must both invalidate Inspector access. */
function subscribeToGameSessionChanges(notify: () => void) {
  window.addEventListener("hashchange", notify);
  window.addEventListener("storage", notify);
  window.addEventListener("focus", notify);
  window.addEventListener("pageshow", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("storage", notify);
    window.removeEventListener("focus", notify);
    window.removeEventListener("pageshow", notify);
  };
}

const WordLibraryPage = lazy(() =>
  import("@/features/word-library/components/word-library-page").then((module) => ({
    default: module.WordLibraryPage,
  })),
);
const ProgressPage = lazy(() =>
  import("@/features/progress/components/progress-page").then((module) => ({
    default: module.ProgressPage,
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
  const { t } = useTranslation();
  const notify = useNotify();
  const account = useAccountData(auth.user?.id, api, initial, notify);
  const feedbackAdminAccess = useAdminAccess(auth.user?.id ?? null);
  const inspectorBlockedByGame = useSyncExternalStore(
    subscribeToGameSessionChanges, hasActiveSavedGame, () => false,
  );
  const library = account.library;
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminVisible,setAdminVisible] = useState(false);
  const [adminChecked,setAdminChecked] = useState(false);
  useEffect(()=>{
    if (ADMIN_UI_ENABLED) return; // The Feedback hook owns admin discovery when enabled.
    let mounted=true;
    setAdminVisible(false);setAdminChecked(false);
    if(!auth.user){setAdminChecked(true);return;}
    void checkAdminAccess().then(allowed=>{
      if(mounted){setAdminVisible(allowed);setAdminChecked(true);}
    });
    return ()=>{mounted=false;};
  },[auth.user?.id]);
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
    setGamePreset({
      day: group.day,
      wordIds: group.playableWords.map((word) => word.id),
    });
    navigate("game");
  }

  function studyCoachWords(wordIds: string[], label: string) {
    const available = new Set(library.words.map((word) => word.id));
    const unique = [...new Set(wordIds)].filter((id) => available.has(id));
    if (!unique.length) { notify.error("Çalışmaya hazır kelime kalmadı."); return; }
    setGamePreset({ wordIds: unique, label });
    navigate("game");
  }

  async function saveWord(
    input: WordInput,
    id?: string,
    onProgress?: (progress: WordFillProgress) => void,
  ) {
    const [prepared] =
      !id && auth.user
        ? await prepareWordInputs([input], library.list(), completeWordsWithGemini, onProgress)
        : [input];
    await library.save(prepared, id);
    return prepared;
  }

  async function addWords(inputs: WordInput[], onProgress?: (progress: WordFillProgress) => void) {
    let failedWords: string[] = [];

    const prepared = auth.user
      ? await prepareWordInputs(
          inputs,
          library.list(),
          completeWordsWithGemini,
          (progress) => {
            failedWords = progress.failedWords ?? [];
            onProgress?.(progress);
          },
        )
      : inputs;

    const result = await library.addMany(prepared);

    if (failedWords.length) {
      notify.info(
        <span>
          Hazir kelimeler kaydedildi. Tamamlanamayan {failedWords.length} kelime:{" "}
          <strong>{failedWords.join(", ")}</strong>.
          Bu kelimeleri yeniden deneyebilirsin.
        </span>,
      );
    }

    return result;
  }

  return (
    <div className="flex min-h-screen flex-col bg-atlas-canvas">
      <AppHeader
        onOpenAccount={() => (auth.user ? setAccountOpen(true) : onLogin())}
        onOpenSettings={() => setSettingsOpen(true)}
        signedIn={!!auth.user}
        showAdmin={ADMIN_UI_ENABLED ? feedbackAdminAccess === "allowed" : adminVisible}
        showInspector={!!auth.user && INSPECTOR_UI_ENABLED && screen !== "game" && !inspectorBlockedByGame}
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
        {screen === "admin" && ADMIN_UI_ENABLED ? (
          <Suspense fallback={<p role="status" className="py-20 text-center text-sm text-muted-foreground">Control Center açılıyor…</p>}>
            <AdminControlCenterPage userId={auth.user?.id ?? null} access={feedbackAdminAccess} />
          </Suspense>
        ) : screen === "admin" ? (
          !adminChecked ? <p role="status" className="py-16 text-center">Yönetici yetkisi doğrulanıyor…</p>
          : !adminVisible ? <p role="alert" className="py-16 text-center">Yönetim merkezine erişim yetkin yok.</p>
          : <Suspense fallback={<p role="status" className="py-16 text-center">Yönetim merkezi yükleniyor…</p>}>
              <AdminDashboard onBack={()=>navigate("home")}/>
            </Suspense>
        ) : screen === "inspector" ? (
          INSPECTOR_UI_ENABLED && auth.user && inspectorBlockedByGame ? (
            <div role="status" className="rounded-xl border border-atlas-line bg-white p-6 text-sm text-atlas-navy">
              Devam eden öğrenme oturumunda kelime inceleme kapalı. Oturumunu tamamladıktan sonra kelimeleri inceleyebilirsin; ilerlemen korunuyor.
              <button type="button" className="mt-4 block rounded-lg border border-atlas-line px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-atlas-blue" onClick={() => navigate("game")}>Öğrenmeye devam et</button>
            </div>
          ) : INSPECTOR_UI_ENABLED && auth.user ? (
            <Suspense fallback={<p role="status" className="py-20 text-center text-sm text-slate-500">Word Inspector açılıyor…</p>}>
              <WordInspectorPage userId={auth.user.id} onAddToLibrary={(word) => library.addMany([word])} />
            </Suspense>
          ) : (
            <p role="status" className="rounded-xl border border-atlas-line bg-white p-6 text-sm text-atlas-navy">Kelime inceleme bu ortamda kapalı veya oturumun açık değil.</p>
          )
        ) : screen === "home" ? (
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
        ) : screen === "progress" ? (
          <Suspense fallback={<p className="py-20 text-center text-muted-foreground">İlerleme merkezi açılıyor…</p>}>
            <ProgressPage
              words={library.words}
              userId={auth.user?.id ?? null}
              onStartStudy={studyCoachWords}
              onOpenLibrary={() => navigateLibrary()}
            />
          </Suspense>
        ) : screen === "game" ? (
          <Suspense
            fallback={
              <p className="py-20 text-center text-sm text-slate-500">Öğrenme rotan açılıyor…</p>
            }
          >
            <LearningGamePage
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
              loadError={library.loadError}
              onReload={() => void library.reload()}
              onSave={saveWord}
              onAddMany={addWords}
              onRemove={library.remove}
              onRemoveMany={library.removeMany}
              onSetGroups={library.setGroups}
              manualGroupsEnabled={import.meta.env.VITE_MANUAL_WORD_GROUPS_ENABLED === "true"}
              cloudPreflightUserId={auth.user?.id ?? null}
              onStudyGroup={studyDailyGroup}
              onOpenProgress={() => navigate("progress")}
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
      <AiChatWidget onLogin={onLogin} />
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
  );
}
