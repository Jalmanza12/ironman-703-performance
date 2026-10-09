// Date helpers. All plan dates are ISO "YYYY-MM-DD" calendar dates handled in UTC
// arithmetic so daylight-saving changes (including race morning, Mar 14 2027) never
// shift a workout to the wrong day.

const DAY_MS = 86400000;
export const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return toISO(d) === s;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(new Date(parseISO(iso).getTime() + n * DAY_MS));
}

export function diffDays(fromISO, toISOStr) {
  return Math.round((parseISO(toISOStr) - parseISO(fromISO)) / DAY_MS);
}

export function dayOfWeek(iso) {
  return parseISO(iso).getUTCDay();
}

/** Monday of the week containing iso. */
export function mondayOf(iso) {
  const dow = dayOfWeek(iso);
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function rangeDays(startISO, endISO) {
  const out = [];
  for (let d = startISO; d <= endISO; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's calendar date in the athlete's local time zone. */
export function todayLocalISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatLong(iso) {
  const d = parseISO(iso);
  return `${DOW[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatShort(iso) {
  const d = parseISO(iso);
  return `${DOW_SHORT[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function monthLabel(iso) {
  const d = parseISO(iso);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Countdown from `now` (a Date) to an absolute instant (ms since epoch).
 * Returns whole days/hours/minutes; negative intervals clamp to zero with `past: true`.
 */
export function countdown(now, targetMs) {
  let ms = targetMs - now.getTime();
  const past = ms <= 0;
  if (past) ms = 0;
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return { days, hours, minutes, seconds, past, totalMs: ms };
}

/** Whole calendar days from todayISO to raceISO (0 on race day). */
export function daysUntil(todayISO, raceISO) {
  return diffDays(todayISO, raceISO);
}
