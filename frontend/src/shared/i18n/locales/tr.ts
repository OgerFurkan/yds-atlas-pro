/** Preserves translation names and existing i18next keys. */
import { trCore } from "./tr/core";
import { trDashboard } from "./tr/dashboard";
import { trVocabulary } from "./tr/vocabulary";
import { trAccountAi } from "./tr/accountAi";
import { trLearning } from "./tr/learning";

export const tr = {
  brand: trCore.brand,
  common: trCore.common,
  notifications: trCore.notifications,
  nav: trCore.nav,
  settings: trCore.settings,
  status: trCore.status,
  dashboard: trDashboard.dashboard,
  goal: trDashboard.goal,
  streak: trDashboard.streak,
  recentWord: trDashboard.recentWord,
  companion: trDashboard.companion,
  wordStatus: trVocabulary.wordStatus,
  taskIntro: trVocabulary.taskIntro,
  chat: trAccountAi.chat,
  auth: trAccountAi.auth,
  library: trVocabulary.library,
  setup: trLearning.setup,
  game: trLearning.game,
} as const;
