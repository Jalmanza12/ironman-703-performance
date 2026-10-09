// Unit conversions and time/pace formatting. Pure functions, unit-tested.

export const M_PER_MILE = 1609.344;
export const M_PER_YARD = 0.9144;
export const KM_PER_MILE = 1.609344;
export const LB_PER_KG = 2.20462262;

export const RACE_DISTANCES = {
  swimM: 1931, // 1.2 mi
  bikeM: 90123, // 56 mi
  runM: 21097.5, // 13.1 mi
};

/** Parse "h:mm:ss", "mm:ss", or plain seconds/minutes string into seconds. Returns NaN when invalid. */
export function parseDuration(str) {
  if (typeof str === 'number') return Number.isFinite(str) && str >= 0 ? str : NaN;
  if (typeof str !== 'string') return NaN;
  const s = str.trim();
  if (!s) return NaN;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return NaN;
  const parts = s.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Format seconds as h:mm:ss (or m:ss when under an hour unless forceHours). */
export function formatDuration(totalSec, { forceHours = false } = {}) {
  if (!Number.isFinite(totalSec)) return '—';
  const neg = totalSec < 0;
  let s = Math.round(Math.abs(totalSec));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const body = h > 0 || forceHours
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

export function formatMinutes(min) {
  if (!Number.isFinite(min)) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

// ---- Running pace ----
export function paceSecPerMileToKm(secPerMile) {
  return secPerMile / KM_PER_MILE;
}
export function paceSecPerKmToMile(secPerKm) {
  return secPerKm * KM_PER_MILE;
}
export function speedMpsFromPacePerMile(secPerMile) {
  return M_PER_MILE / secPerMile;
}
export function pacePerMileFromSpeedMps(mps) {
  return M_PER_MILE / mps;
}
export function mphFromMps(mps) {
  return (mps * 3600) / M_PER_MILE;
}
export function mpsFromMph(mph) {
  return (mph * M_PER_MILE) / 3600;
}
export function kphFromMps(mps) {
  return mps * 3.6;
}
/** Time (s) to cover distance (m) at pace (s/mile). */
export function timeForDistanceAtPace(distM, secPerMile) {
  return (distM / M_PER_MILE) * secPerMile;
}
export function formatPace(secPerUnit, unit = 'mi') {
  if (!Number.isFinite(secPerUnit) || secPerUnit <= 0) return '—';
  return `${formatDuration(secPerUnit)}/${unit}`;
}

// ---- Swimming pace ----
/** Convert pace per 100 yd to pace per 100 m. */
export function per100ydToPer100m(sec) {
  return sec / M_PER_YARD;
}
export function per100mToPer100yd(sec) {
  return sec * M_PER_YARD;
}
/** CSS from 400 and 200 time-trial times (seconds) → pace per 100 (same unit as the pool). */
export function cssPacePer100(t400, t200) {
  if (!(t400 > 0 && t200 > 0) || t400 <= t200) return NaN;
  return (t400 - t200) / 2;
}

// ---- Weight ----
export function kgFromLb(lb) {
  return lb / LB_PER_KG;
}
export function lbFromKg(kg) {
  return kg * LB_PER_KG;
}

export function round(n, dp = 0) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
