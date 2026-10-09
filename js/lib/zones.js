// Training-zone calculations. Every function returns null when its benchmark is missing
// so the UI can say "Not yet established" instead of inventing numbers.

/** Coggan power levels (Allen & Coggan, Training and Racing with a Power Meter). */
export const POWER_ZONES = [
  { id: 'Z1', name: 'Active recovery', lo: 0, hi: 0.55 },
  { id: 'Z2', name: 'Endurance', lo: 0.56, hi: 0.75 },
  { id: 'Z3', name: 'Tempo', lo: 0.76, hi: 0.90 },
  { id: 'SS', name: 'Sweet spot', lo: 0.88, hi: 0.94 },
  { id: 'Z4', name: 'Threshold', lo: 0.91, hi: 1.05 },
  { id: 'Z5', name: 'VO₂max', lo: 1.06, hi: 1.20 },
  { id: 'Z6', name: 'Anaerobic capacity', lo: 1.21, hi: 1.50 },
];

/** Friel bike LTHR zones. */
export const BIKE_HR_ZONES = [
  { id: 'Z1', name: 'Recovery', lo: 0, hi: 0.80 },
  { id: 'Z2', name: 'Aerobic', lo: 0.81, hi: 0.89 },
  { id: 'Z3', name: 'Tempo', lo: 0.90, hi: 0.93 },
  { id: 'Z4', name: 'Sub-threshold', lo: 0.94, hi: 0.99 },
  { id: 'Z5a', name: 'Super-threshold', lo: 1.00, hi: 1.02 },
  { id: 'Z5b', name: 'Aerobic capacity', lo: 1.03, hi: 1.06 },
];

/** Friel run LTHR zones. */
export const RUN_HR_ZONES = [
  { id: 'Z1', name: 'Recovery', lo: 0, hi: 0.84 },
  { id: 'Z2', name: 'Aerobic', lo: 0.85, hi: 0.89 },
  { id: 'Z3', name: 'Tempo', lo: 0.90, hi: 0.94 },
  { id: 'Z4', name: 'Sub-threshold', lo: 0.95, hi: 0.99 },
  { id: 'Z5a', name: 'Super-threshold', lo: 1.00, hi: 1.02 },
  { id: 'Z5b', name: 'Aerobic capacity', lo: 1.03, hi: 1.06 },
];

/**
 * Run pace zones as multiples of threshold pace (s/mi). Larger multiple = slower.
 * Coaching convention aligned with Friel's pace-zone approach; ranges are deliberately wide.
 */
export const RUN_PACE_ZONES = [
  { id: 'Easy', name: 'Easy / recovery', slow: 1.35, fast: 1.20 },
  { id: 'Z2', name: 'Aerobic', slow: 1.20, fast: 1.12 },
  { id: 'HIM', name: '70.3 race pace (off-bike)', slow: 1.12, fast: 1.06 },
  { id: 'Z3', name: 'Steady / marathon-ish', slow: 1.10, fast: 1.05 },
  { id: 'Z4', name: 'Threshold (cruise intervals)', slow: 1.03, fast: 0.99 },
  { id: 'Z5', name: 'VO₂ (3–5 min reps)', slow: 0.97, fast: 0.92 },
];

/** Swim zones as seconds added to CSS pace per 100. */
export const SWIM_CSS_ZONES = [
  { id: 'Easy', name: 'Easy / technique', plusLo: 10, plusHi: 18 },
  { id: 'End', name: 'Aerobic endurance', plusLo: 5, plusHi: 9 },
  { id: 'Race', name: '70.3 race effort (pool)', plusLo: 3, plusHi: 6 },
  { id: 'CSS', name: 'Threshold (CSS)', plusLo: -1, plusHi: 2 },
  { id: 'Fast', name: 'Above CSS', plusLo: -6, plusHi: -2 },
];

export function powerRange(ftp, lo, hi) {
  if (!validFTP(ftp)) return null;
  return [Math.round(ftp * lo), Math.round(ftp * hi)];
}

export function powerZones(ftp) {
  if (!validFTP(ftp)) return null;
  return POWER_ZONES.map((z) => ({ ...z, watts: [Math.round(ftp * z.lo), z.hi >= 1.5 ? null : Math.round(ftp * z.hi)] }));
}

export function hrRange(lthr, lo, hi) {
  if (!validHR(lthr)) return null;
  return [Math.round(lthr * lo), Math.round(lthr * hi)];
}

export function hrZones(lthr, sport = 'run') {
  if (!validHR(lthr)) return null;
  const table = sport === 'bike' ? BIKE_HR_ZONES : RUN_HR_ZONES;
  return table.map((z) => ({ ...z, bpm: [Math.round(lthr * z.lo), Math.round(lthr * z.hi)] }));
}

/** Returns [fast, slow] pace in s/mi for a multiple range of threshold pace. */
export function paceRange(thresholdSecPerMile, fastMult, slowMult) {
  if (!validRunPace(thresholdSecPerMile)) return null;
  return [Math.round(thresholdSecPerMile * fastMult), Math.round(thresholdSecPerMile * slowMult)];
}

export function runPaceZones(thresholdSecPerMile) {
  if (!validRunPace(thresholdSecPerMile)) return null;
  return RUN_PACE_ZONES.map((z) => ({ ...z, pace: [Math.round(thresholdSecPerMile * z.fast), Math.round(thresholdSecPerMile * z.slow)] }));
}

export function swimRange(cssPer100, plusLo, plusHi) {
  if (!validCSS(cssPer100)) return null;
  return [Math.round(cssPer100 + plusLo), Math.round(cssPer100 + plusHi)];
}

export function swimZones(cssPer100) {
  if (!validCSS(cssPer100)) return null;
  return SWIM_CSS_ZONES.map((z) => ({ ...z, pace: [Math.round(cssPer100 + z.plusLo), Math.round(cssPer100 + z.plusHi)] }));
}

/** Power from a 20-minute test (Allen & Coggan convention: FTP ≈ 95% of 20-min mean power). */
export function ftpFrom20Min(avgWatts) {
  return validWatts(avgWatts) ? Math.round(avgWatts * 0.95) : null;
}

/** Ramp-test estimate (common convention: ~75% of best 1-min power). Less reliable for diesel-type athletes. */
export function ftpFromRamp(best1MinWatts) {
  return validWatts(best1MinWatts) ? Math.round(best1MinWatts * 0.75) : null;
}

/** Maffetone 180-formula aerobic ceiling. Presented only as an optional cross-check. */
export function maf180(age, adjust = 0) {
  if (!(age >= 14 && age <= 90)) return null;
  return 180 - age + adjust;
}

export const validFTP = (v) => Number.isFinite(v) && v >= 80 && v <= 500;
export const validWatts = (v) => Number.isFinite(v) && v >= 80 && v <= 700;
export const validHR = (v) => Number.isFinite(v) && v >= 100 && v <= 215;
export const validRunPace = (v) => Number.isFinite(v) && v >= 240 && v <= 900; // 4:00–15:00 /mi
export const validCSS = (v) => Number.isFinite(v) && v >= 55 && v <= 240; // 0:55–4:00 /100
