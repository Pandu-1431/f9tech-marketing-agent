/*
 * Scheduling helpers: local date + time in a time zone <-> UTC instant, with no extra library.
 * A post stores `scheduledAt` (UTC instant) + `timezone` (IANA name), and `publishOn`
 * (the local date) is kept in sync for sorting and the calendar grid.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Default posting time per platform (local time). Good, simple starting slots; users can move any post. */
export const DEFAULT_SLOTS: Record<string, string> = {
  instagram: "19:00",
  facebook: "13:00",
  linkedin: "09:30",
  x: "12:00",
  youtube: "18:00",
  google_business: "11:00",
};
export const slotFor = (platform: string) => DEFAULT_SLOTS[platform] ?? "10:00";

export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isHhMm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** All IANA time zones the runtime knows (for the brand form), Asia/Kolkata first. */
export function timeZoneOptions(): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIMEZONE, "UTC"];
  return [DEFAULT_TIMEZONE, ...all.filter((z) => z !== DEFAULT_TIMEZONE)];
}

function parts(instant: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Milliseconds the zone is ahead of UTC at that instant (IST = +5:30 → 19800000). */
function offsetAt(instant: number, tz: string): number {
  const p = parts(instant, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant / 1000) * 1000;
}

/** "2026-11-08" + "19:00" in "Asia/Kolkata" → the UTC instant (13:30Z). Handles daylight saving. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let guess = wall - offsetAt(wall, tz);
  guess = wall - offsetAt(guess, tz); // second pass fixes the DST edge
  return new Date(guess);
}

/** UTC instant → local date and time in the zone. */
export function utcToZoned(instant: Date, tz: string): { date: string; time: string } {
  const p = parts(instant.getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** "Sat 8 Nov, 7:00 pm IST" for display. */
export function formatSlot(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

/** Month grid for "2026-11": weeks (Mon–Sun) of ISO dates, including days from the next/previous month. */
export function monthGrid(month: string): { weeks: string[][]; first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(y, m - 1, 1));
  const lastDay = new Date(Date.UTC(y, m, 0));
  const start = new Date(firstDay);
  start.setUTCDate(start.getUTCDate() - ((firstDay.getUTCDay() + 6) % 7));
  const weeks: string[][] = [];
  const cur = new Date(start);
  while (cur <= lastDay || weeks.length === 0 || weeks[weeks.length - 1].length < 7) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([]);
    weeks[weeks.length - 1].push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (cur > lastDay && weeks[weeks.length - 1].length === 7) break;
  }
  return { weeks, first: weeks[0][0], last: weeks[weeks.length - 1][6] };
}

export const isMonth = (v: string | undefined): v is string => Boolean(v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v));

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}
