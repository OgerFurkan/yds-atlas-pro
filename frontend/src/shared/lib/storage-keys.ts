// Browser storage contract. Keep these values stable so existing saved data survives refactors.
export const storageKeys = {
  words: "yds-atlas-words-v1",
  gameSession: "yds-atlas-learning-session-v2",
  dailyProgress: "yds-atlas-daily-progress-v1",
  dailyGoal: "yds-atlas-daily-goal",
  completedDays: "yds-atlas-completed-days-v1",
  goalPerDay: "yds-atlas-goal-per-day-v1",
  localUser: "yds-atlas-local-user",
  dailyWordGroups: "yds-atlas-daily-word-groups-v1",
} as const;
