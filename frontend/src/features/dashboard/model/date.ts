export const timeZone = "Europe/Istanbul";

export const weekdayLabels = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pa"] as const;

/** Canonical YYYY-MM-DD key for a calendar day in Istanbul. */
export function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Shifts a YYYY-MM-DD key by whole days without depending on the browser time zone. */
export function dayOffset(key: string, offset: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function formatDateLabel(date: Date, locale = "tr-TR") {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(date)
    .toLocaleUpperCase(locale);
}

export function dateParts(date = new Date(), locale = "tr-TR") {
  return { key: localDateKey(date), label: formatDateLabel(date, locale) };
}

/** ISO weekday index where Monday is 0 and Sunday is 6. */
export function weekdayIndex(key: string) {
  return (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function startOfWeek(key: string) {
  return dayOffset(key, -weekdayIndex(key));
}
