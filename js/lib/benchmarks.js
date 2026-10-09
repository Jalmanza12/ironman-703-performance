// Benchmark history → current values. A benchmark becomes "current" only when entered from a
// valid test/result. Trend logic distinguishes a meaningful change (confirmed by a repeat test)
// from a single noisy result.

import { validFTP, validCSS, validRunPace, validHR } from './zones.js';
import { kgFromLb } from './units.js';

export const BENCHMARK_TYPES = {
  ftp: { label: 'FTP', unit: 'W', valid: validFTP, better: 'higher', noisePct: 3 },
  css: { label: 'CSS', unit: 's/100', valid: validCSS, better: 'lower', noisePct: 2 },
  thresholdPace: { label: 'Run threshold pace', unit: 's/mi', valid: validRunPace, better: 'lower', noisePct: 2 },
  lthrRun: { label: 'Run LTHR', unit: 'bpm', valid: validHR, better: 'none', noisePct: 2 },
  lthrBike: { label: 'Bike LTHR', unit: 'bpm', valid: validHR, better: 'none', noisePct: 2 },
  maxHr: { label: 'Observed max HR', unit: 'bpm', valid: validHR, better: 'none', noisePct: 2 },
  restingHr: { label: 'Resting HR', unit: 'bpm', valid: (v) => v >= 30 && v <= 100, better: 'lower', noisePct: 5 },
  raceHM: { label: 'Half-marathon result', unit: 's', valid: (v) => v >= 3600 && v <= 4 * 3600, better: 'lower', noisePct: 1 },
  race10k: { label: '10K result', unit: 's', valid: (v) => v >= 1500 && v <= 2 * 3600, better: 'lower', noisePct: 1 },
  race5k: { label: '5K result', unit: 's', valid: (v) => v >= 780 && v <= 3600, better: 'lower', noisePct: 1 },
  longestSwimM: { label: 'Longest continuous swim', unit: 'm', valid: (v) => v > 0 && v <= 10000, better: 'higher', noisePct: 0 },
  swimRehearsal: { label: '1.9 km continuous swim time', unit: 's', valid: (v) => v >= 1200 && v <= 4 * 3600, better: 'lower', noisePct: 2 },
};

/** Latest valid value per type, plus the previous one for trend context. */
export function currentBenchmarks(state) {
  const byType = {};
  for (const b of [...state.benchmarks].sort((a, b2) => a.date.localeCompare(b2.date) || (a.createdAt || '').localeCompare(b2.createdAt || ''))) {
    const def = BENCHMARK_TYPES[b.type];
    if (!def || !def.valid(Number(b.value))) continue;
    (byType[b.type] ||= []).push(b);
  }
  const cur = {};
  for (const [t, list] of Object.entries(byType)) cur[t] = Number(list[list.length - 1].value);
  cur.poolUnit = state.profile.poolUnit || state.settings?.poolUnit || 'yd';
  // Weight: latest daily log, else profile.
  const weights = Object.entries(state.daily).filter(([, d]) => d.weightLb > 0).sort(([a], [b]) => a.localeCompare(b));
  const lb = weights.length ? Number(weights[weights.length - 1][1].weightLb) : Number(state.profile.weightLb) || null;
  cur.weightLb = lb;
  cur.weightKg = lb ? kgFromLb(lb) : null;
  cur.wetsuit = state.profile.wetsuit !== 'no';
  return { values: cur, history: byType };
}

/**
 * Trend between the last two valid tests of a type.
 * Returns { change, pct, meaningful, direction } — "meaningful" requires the change to exceed
 * the type's noise band; a single surprising test is flagged "confirm with a retest".
 */
export function benchmarkTrend(history, type) {
  const list = history[type];
  const def = BENCHMARK_TYPES[type];
  if (!list || list.length < 2) return null;
  const a = Number(list[list.length - 2].value);
  const b = Number(list[list.length - 1].value);
  const change = b - a;
  const pct = (change / a) * 100;
  const meaningful = Math.abs(pct) > def.noisePct;
  let direction = 'stable';
  if (meaningful && def.better !== 'none') direction = (def.better === 'higher' ? change > 0 : change < 0) ? 'improved' : 'declined';
  // Confirmed if the previous change was in the same direction (two consecutive tests).
  let confirmed = false;
  if (list.length >= 3) {
    const prev = Number(list[list.length - 2].value) - Number(list[list.length - 3].value);
    confirmed = Math.sign(prev) === Math.sign(change) && meaningful;
  }
  return { from: a, to: b, change, pct, meaningful, direction, confirmed };
}

/** e1RM (Epley) from load × reps at RIR: reps-to-failure ≈ reps + RIR. */
export function e1rm(load, reps, rir = 0) {
  const r = Number(reps) + Number(rir || 0);
  if (!(load > 0) || !(r >= 1) || r > 15) return null;
  return r === 1 ? Number(load) : Number(load) * (1 + r / 30);
}

/** Strength trend per exercise. Meaningful decline = best e1RM of last 2 sessions < 90% of prior best (two-session confirmation). */
export function strengthTrend(entries, exercise) {
  const list = entries.filter((e) => e.exercise === exercise).map((e) => ({ date: e.date, e1rm: e1rm(e.load, e.reps, e.rir) })).filter((e) => e.e1rm).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const byDate = {};
  for (const e of list) byDate[e.date] = Math.max(byDate[e.date] || 0, e.e1rm);
  const series = Object.entries(byDate).map(([date, v]) => ({ date, e1rm: v }));
  const best = Math.max(...series.map((s) => s.e1rm));
  const last2 = series.slice(-2);
  const priorBest = series.length > 2 ? Math.max(...series.slice(0, -2).map((s) => s.e1rm)) : null;
  let status = 'insufficient data';
  if (series.length >= 3 && priorBest) {
    const recent = Math.max(...last2.map((s) => s.e1rm));
    const ratio = recent / priorBest;
    if (last2.every((s) => s.e1rm < priorBest * 0.9)) status = 'meaningful decline (two sessions <90% of prior best)';
    else if (ratio < 0.95) status = 'small dip — likely fatigue; watch next session';
    else if (ratio > 1.03) status = 'improving';
    else status = 'maintained';
  }
  return { series, best, status };
}
