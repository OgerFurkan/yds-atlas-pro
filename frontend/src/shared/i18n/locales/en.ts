/** Preserves translation names and existing i18next keys. */

import { enAccountAi } from "./en/accountAi";
import { enCore } from "./en/core";
import { enDashboard } from "./en/dashboard";
import { enLearning } from "./en/learning";
import { enVocabulary } from "./en/vocabulary";

export const en = {
  brand: enCore.brand,
  common: enCore.common,
  notifications: enCore.notifications,
  nav: enCore.nav,
  settings: enCore.settings,
  status: enCore.status,
  dashboard: enDashboard.dashboard,
  goal: enDashboard.goal,
  streak: enDashboard.streak,
  recentWord: enDashboard.recentWord,
  companion: enDashboard.companion,
  wordStatus: enVocabulary.wordStatus,
  taskIntro: enVocabulary.taskIntro,
  chat: enAccountAi.chat,
  auth: enAccountAi.auth,
  library: enVocabulary.library,
  setup: enLearning.setup,
  game: enLearning.game,
} as const;
