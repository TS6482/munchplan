import type { IsoDay, WeekKey } from '../types';

/**
 * ISO 8601 week utilities. Weeks run Monday->Sunday; W01 is the week
 * containing the year's first Thursday (equivalently, the week containing
 * Jan 4). All arithmetic works on UTC-noon `Date`s so it can never be
 * shifted by the local machine's timezone or DST transitions.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shape of a valid week key ("YYYY-Www"); shared with route validation. */
export const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

function utcNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
}

/** Re-anchors any Date to UTC noon of its own UTC calendar day. */
function toUtcNoon(date: Date): Date {
  return utcNoon(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** ISO weekday number: Monday = 1 ... Sunday = 7. */
function isoWeekday(date: Date): number {
  const day = date.getUTCDay(); // 0 = Sun ... 6 = Sat
  return day === 0 ? 7 : day;
}

function parseWeekKey(weekKey: WeekKey): { year: number; week: number } {
  const m = WEEK_KEY_RE.exec(weekKey);
  if (!m) {
    throw new Error(`Invalid week key: "${weekKey}" (expected "YYYY-Www", e.g. "2026-W29")`);
  }
  return { year: Number(m[1]), week: Number(m[2]) };
}

/** Returns the ISO 8601 week key (e.g. "2026-W29") containing `date`. */
export function weekKeyOf(date: Date): WeekKey {
  const d = toUtcNoon(date);
  const thursday = addDays(d, 4 - isoWeekday(d));
  const isoYear = thursday.getUTCFullYear();
  const yearStart = utcNoon(isoYear, 0, 1);
  const diffDays = Math.round((thursday.getTime() - yearStart.getTime()) / MS_PER_DAY);
  const week = Math.ceil((diffDays + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Returns the UTC-noon Date of the Monday starting `weekKey`. */
export function mondayOf(weekKey: WeekKey): Date {
  const { year, week } = parseWeekKey(weekKey);
  const jan4 = utcNoon(year, 0, 4);
  const mondayOfWeek1 = addDays(jan4, 1 - isoWeekday(jan4));
  return addDays(mondayOfWeek1, (week - 1) * 7);
}

/**
 * Shifts a week key by `delta` weeks via date arithmetic on its Monday
 * (never string decrement), so it correctly crosses year/53-week boundaries.
 */
export function addWeeks(weekKey: WeekKey, delta: number): WeekKey {
  return weekKeyOf(addDays(mondayOf(weekKey), delta * 7));
}

/** The week key containing `now`. */
export function currentWeek(now: Date): WeekKey {
  return weekKeyOf(now);
}

/** The week key immediately following the week containing `now`. */
export function nextWeek(now: Date): WeekKey {
  return addWeeks(weekKeyOf(now), 1);
}

/** Day keys in Monday->Sunday order. */
export const ISO_DAYS: IsoDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function toIsoDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Returns the 7 ISO dates (YYYY-MM-DD) of `weekKey`, Monday through Sunday. */
export function daysOf(weekKey: WeekKey): string[] {
  const monday = mondayOf(weekKey);
  return ISO_DAYS.map((_, i) => toIsoDateString(addDays(monday, i)));
}

/** Returns the ISO date (YYYY-MM-DD) of a single day within `weekKey`. */
export function dateOfDay(weekKey: WeekKey, day: IsoDay): string {
  const index = ISO_DAYS.indexOf(day);
  return toIsoDateString(addDays(mondayOf(weekKey), index));
}
