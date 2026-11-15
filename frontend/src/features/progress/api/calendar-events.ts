import { supabase } from "@/shared/api/supabase-client";
import { scopedStorageKey } from "@/shared/lib/storage-scope";
import { validCalendarDay } from "../model/coach-planner";

export type CalendarKind = "review" | "vocabulary" | "reading" | "translation" | "exam" | "custom";
export type CalendarStatus = "planned" | "done" | "skipped";
export type CalendarOrigin = "manual" | "coach";
export interface CalendarEntry {
  id: string;
  day: string;
  kind: CalendarKind;
  title: string;
  notes: string;
  minutes: number;
  status: CalendarStatus;
  origin: CalendarOrigin;
  revision: number;
}
export type CalendarDraft = Omit<CalendarEntry, "id" | "revision">;
const KEY = "atlas-progress-calendar-v1";
const COLUMNS = "id,day,kind,title,notes,minutes,status,origin,revision";
const KINDS: CalendarKind[] = ["review", "vocabulary", "reading", "translation", "exam", "custom"];
const STATES: CalendarStatus[] = ["planned", "done", "skipped"];
const ORIGINS: CalendarOrigin[] = ["manual", "coach"];

function draftValid(input: CalendarDraft): CalendarDraft {
  const title = input.title.trim();
  if (!validCalendarDay(input.day) || title.length < 1 || title.length > 120 ||
      input.notes.length > 1500 || !Number.isSafeInteger(input.minutes) ||
      input.minutes < 5 || input.minutes > 240 || !KINDS.includes(input.kind) ||
      !STATES.includes(input.status) || !ORIGINS.includes(input.origin))
    throw new Error("Takvim kaydı geçersiz: tarih, başlık veya süreyi kontrol et.");
  return { ...input, title };
}
function decode(input: unknown): CalendarEntry {
  if (!input || typeof input !== "object") throw new Error("Takvim kaydı doğrulanamadı.");
  const row = input as Record<string, unknown>;
  const draft = draftValid({
    day: String(row.day ?? ""), kind: row.kind as CalendarKind,
    title: String(row.title ?? ""), notes: String(row.notes ?? ""),
    minutes: row.minutes as number, status: row.status as CalendarStatus,
    origin: row.origin as CalendarOrigin,
  });
  if (typeof row.id !== "string" || !/^[\da-f]{8}-[\da-f-]{27,}$/.test(row.id) ||
      !Number.isSafeInteger(row.revision) || (row.revision as number) < 1)
    throw new Error("Takvim kaydı kimliği veya sürümü doğrulanamadı.");
  return { ...draft, id: row.id, revision: row.revision as number };
}
function guestRead(): CalendarEntry[] {
  const raw = window.localStorage.getItem(scopedStorageKey(KEY, null));
  if (!raw) return [];
  if (raw.length > 2_000_000) throw new Error("Yerel takvim kaydı çok büyük.");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 1000) throw new Error("Yerel takvim kaydı doğrulanamadı.");
  return parsed.map(decode);
}
function guestWrite(entries: CalendarEntry[]): void {
  window.localStorage.setItem(scopedStorageKey(KEY, null), JSON.stringify(entries));
}
async function clientFor(userId: string) {
  if (!supabase) throw new Error("Takvim için Supabase bağlantısı gerekli.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId)
    throw new Error("Takvim hesabı değişti. Yeniden giriş yap.");
  return supabase;
}
export async function listCalendar(userId: string | null, first: string, last: string): Promise<CalendarEntry[]> {
  if (!validCalendarDay(first) || !validCalendarDay(last) || first > last) throw new Error("Geçersiz takvim aralığı.");
  if (!userId) return guestRead().filter((entry) => entry.day >= first && entry.day <= last);
  const client = await clientFor(userId);
  const { data, error } = await client.from("study_calendar_entries")
    .select(COLUMNS).eq("user_id", userId).gte("day", first).lte("day", last)
    .order("day", { ascending: true }).order("created_at", { ascending: true }).limit(700);
  if (error) throw new Error(`Takvim okunamadı: ${error.message}`);
  if (!Array.isArray(data) || data.length >= 700) throw new Error("Takvim satır sınırına ulaştı; kayıtlar eksik gösterilmeyecek.");
  return data.map(decode);
}
export async function createCalendar(userId: string | null, input: CalendarDraft): Promise<CalendarEntry> {
  const draft = draftValid(input);
  if (!userId) {
    const entries = guestRead();
    if (entries.length >= 1000) throw new Error("Misafir takvim sınırı doldu.");
    const saved = { ...draft, id: crypto.randomUUID(), revision: 1 };
    guestWrite([...entries, saved]);
    return saved;
  }
  const client = await clientFor(userId);
  const { data, error } = await client.from("study_calendar_entries")
    .insert({ ...draft, user_id: userId }).select(COLUMNS).single();
  if (error) throw new Error(`Takvim kaydedilemedi: ${error.message}`);
  return decode(data);
}
export async function updateCalendar(userId: string | null, previous: CalendarEntry, input: CalendarDraft): Promise<CalendarEntry> {
  const draft = draftValid(input);
  if (!userId) {
    const entries = guestRead();
    const index = entries.findIndex((e) => e.id === previous.id && e.revision === previous.revision);
    if (index < 0) throw new Error("Takvim değişti. Sayfayı yenile.");
    const updated = { ...draft, id: previous.id, revision: previous.revision + 1 };
    guestWrite(entries.map((entry, i) => i === index ? updated : entry));
    return updated;
  }
  const client = await clientFor(userId);
  const { data, error } = await client.from("study_calendar_entries")
    .update({ ...draft, revision: previous.revision + 1, updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("id", previous.id).eq("revision", previous.revision)
    .select(COLUMNS).maybeSingle();
  if (error) throw new Error(`Takvim güncellenemedi: ${error.message}`);
  if (!data) throw new Error("Takvim başka cihazda değişti. Yeniden yükle.");
  return decode(data);
}
export async function removeCalendar(userId: string | null, previous: CalendarEntry): Promise<void> {
  if (!userId) {
    const entries = guestRead();
    if (!entries.some((e) => e.id === previous.id && e.revision === previous.revision))
      throw new Error("Takvim başka bir işlemle değişti.");
    guestWrite(entries.filter((e) => e.id !== previous.id));
    return;
  }
  const client = await clientFor(userId);
  const { data, error } = await client.from("study_calendar_entries")
    .delete().eq("user_id", userId).eq("id", previous.id).eq("revision", previous.revision)
    .select("id").maybeSingle();
  if (error) throw new Error(`Takvim silinemedi: ${error.message}`);
  if (!data) throw new Error("Takvim başka cihazda değişti. Yeniden yükle.");
}
