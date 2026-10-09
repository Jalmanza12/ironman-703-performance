// Race-time prediction engine. Separates OBSERVED benchmarks from MODELED splits and
// reports a range (fast / likely / slow) for each split. Ranges are summed conservatively
// (fast+fast… / slow+slow…), which overstates total uncertainty slightly — by design.
// Any split without a validated benchmark is reported as "Not yet established".

import { RACE_DISTANCES, per100ydToPer100m, M_PER_MILE } from './units.js';
import { simulateBike, CDA_PRESETS } from './bikeModel.js';
import { validFTP, validCSS, validRunPace } from './zones.js';

export const TARGET_SEC = 5 * 3600 + 15 * 60;

/** Planning budgets (not predictions): what the splits must roughly look like for each outcome. */
export const SCENARIOS = {
  conservative: { label: 'Conservative', swim: 42 * 60, t1: 7 * 60, bike: 2 * 3600 + 50 * 60, t2: 4 * 60, run: 1 * 3600 + 58 * 60 },
  target: { label: 'Target', swim: 36 * 60, t1: 5 * 60, bike: 2 * 3600 + 38 * 60, t2: 2 * 60 + 30, run: 1 * 3600 + 47 * 60 },
  stretch: { label: 'Stretch', swim: 33 * 60, t1: 4 * 60, bike: 2 * 3600 + 30 * 60, t2: 2 * 60, run: 1 * 3600 + 40 * 60 },
};
export function scenarioTotal(s) {
  return s.swim + s.t1 + s.bike + s.t2 + s.run;
}

// Model assumptions (coaching judgment, documented in docs/research-and-methodology.md).
export const ASSUMPTIONS = {
  swim: {
    paceFactor: [1.02, 1.06, 1.12], // open-water race pace vs. pool CSS (sighting, start, no walls)
    wetsuitFactor: 0.96, // ~4% faster in a wetsuit (wetsuit-legal swim expected)
    extraDistance: [1.01, 1.03, 1.06], // navigation
    enduranceUnprovenPenalty: 1.06, // applied to the slow bound if no ≥1,500 continuous swim logged
  },
  bike: {
    intensity: [0.80, 0.775, 0.74], // fraction of FTP raced (fast, likely, slow)
    bikeKg: 9.5,
    crr: [0.0040, 0.0045, 0.0055],
    windMps: [1, 3, 5.5], // 2026 race had strong wind
    rho: 1.19,
  },
  run: {
    openHMFromThreshold: 1.045, // half-marathon pace ≈ 4–5% slower than 30-min TT pace
    offBikeFactor: [1.05, 1.09, 1.15], // 70.3 run pace vs. open half-marathon pace (well-paced age-grouper)
    riegel: 1.06,
  },
  transitions: { t1: [240, 300, 420], t2: [120, 150, 240] },
};

function splitObj(lo, mid, hi, source, confidence, notes = []) {
  return { lo, mid, hi, source, confidence, notes, established: true };
}
const NOT_ESTABLISHED = (needed) => ({ established: false, needed });

export function predictSwim(bm, evidence = {}) {
  if (!validCSS(bm.css)) return NOT_ESTABLISHED('CSS test (400 m/yd + 200 m/yd time trials)');
  const per100m = bm.poolUnit === 'm' ? bm.css : per100ydToPer100m(bm.css);
  const a = ASSUMPTIONS.swim;
  const wet = bm.wetsuit === false ? 1 : a.wetsuitFactor;
  const t = (i) => (RACE_DISTANCES.swimM * a.extraDistance[i] / 100) * per100m * a.paceFactor[i] * wet;
  let hi = t(2);
  const notes = [];
  const longest = evidence.longestSwimM || 0;
  if (longest < 1500) {
    hi *= a.enduranceUnprovenPenalty;
    notes.push(`Longest logged continuous swim: ${longest ? `${Math.round(longest)} m` : 'none'} — slow bound widened until a ≥1,500 continuous swim is logged.`);
  }
  if (evidence.rehearsalSec) {
    // A logged race-distance rehearsal is stronger evidence than the CSS model — blend toward it.
    const rehearsal = evidence.rehearsalSec * wet * a.extraDistance[1];
    notes.push('Race-distance rehearsal logged — likely estimate blended 50/50 with it.');
    const mid = (t(1) + rehearsal) / 2;
    return splitObj(Math.min(t(0), mid), mid, Math.max(hi, mid), 'CSS + race rehearsal', 'moderate', notes);
  }
  notes.push('Model: CSS pace × open-water factor × wetsuit benefit × navigation distance.');
  return splitObj(t(0), t(1), hi, 'CSS benchmark', longest >= 1500 ? 'moderate' : 'low', notes);
}

export function predictBike(bm, profile = {}) {
  if (!validFTP(bm.ftp)) return NOT_ESTABLISHED('FTP test (20-min) with a power meter or smart trainer');
  if (!(bm.weightKg > 40)) return NOT_ESTABLISHED('Body weight');
  const a = ASSUMPTIONS.bike;
  const preset = CDA_PRESETS[profile.bikeType] || CDA_PRESETS.roadClipons;
  const mass = bm.weightKg + (profile.bikeKg || a.bikeKg);
  const run = (i) => simulateBike({ avgPower: bm.ftp * a.intensity[i], mass, cda: preset.range[i], crr: a.crr[i], rho: a.rho, wind: a.windMps[i] }).timeSec;
  const notes = [
    `Race power ${Math.round(bm.ftp * a.intensity[2])}–${Math.round(bm.ftp * a.intensity[0])} W (${a.intensity[2] * 100}–${a.intensity[0] * 100}% FTP).`,
    `Assumed CdA ${preset.range[0]}–${preset.range[2]} m² (${preset.label}), wind 1–5.5 m/s, system mass ${Math.round(mass)} kg.`,
    'Course modeled as gently rolling, ~1,400 ft gain (official).',
  ];
  return splitObj(run(0), run(1), run(2), 'FTP + physics model', 'moderate', notes);
}

/** Open half-marathon estimate (s) from the best available run benchmark. */
export function openHalfMarathon(bm) {
  const r = ASSUMPTIONS.run.riegel;
  if (bm.raceHM > 0) return { sec: bm.raceHM, source: 'Recent half-marathon result' };
  if (validRunPace(bm.thresholdPace)) return { sec: bm.thresholdPace * ASSUMPTIONS.run.openHMFromThreshold * (RACE_DISTANCES.runM / M_PER_MILE), source: 'Threshold pace (30-min TT)' };
  if (bm.race10k > 0) return { sec: bm.race10k * (RACE_DISTANCES.runM / 10000) ** r, source: 'Recent 10K (Riegel)' };
  if (bm.race5k > 0) return { sec: bm.race5k * (RACE_DISTANCES.runM / 5000) ** r, source: 'Recent 5K (Riegel)' };
  return null;
}

export function predictRun(bm, evidence = {}) {
  const open = openHalfMarathon(bm);
  if (!open) return NOT_ESTABLISHED('Run threshold test (30-min TT) or a recent 5K/10K/half-marathon result');
  const f = [...ASSUMPTIONS.run.offBikeFactor];
  const notes = [`Open half-marathon estimate from: ${open.source}.`];
  if ((evidence.longestRunMin || 0) < 90) {
    f[2] += 0.03;
    notes.push('No long run ≥90 min logged yet — slow bound widened.');
  }
  if (evidence.brickPaceRatio && evidence.brickCount >= 2) {
    // Observed: brick pace relative to threshold pace. Narrow toward observed behavior.
    const observed = evidence.brickPaceRatio / ASSUMPTIONS.run.openHMFromThreshold;
    f[1] = (f[1] + Math.min(1.2, Math.max(1.0, observed + 0.03))) / 2;
    notes.push(`Race-pace brick evidence (${evidence.brickCount} sessions) blended into the likely estimate.`);
  }
  if (evidence.fuelingGph != null && evidence.fuelingGph < 50) {
    f[2] += 0.03;
    notes.push(`Average logged long-session carbohydrate ${Math.round(evidence.fuelingGph)} g/h (<50) — fade risk widens the slow bound.`);
  }
  notes.push('Heat note: forecast highs near 80 °F would slow the run; adjust on race week.');
  const conf = evidence.brickCount >= 2 && (evidence.longestRunMin || 0) >= 90 ? 'moderate' : 'low';
  return splitObj(open.sec * f[0], open.sec * f[1], open.sec * f[2], open.source, conf, notes);
}

export function predictTransitions(profile = {}) {
  const a = ASSUMPTIONS.transitions;
  const t1 = profile.t1Sec > 0 ? [profile.t1Sec * 0.85, profile.t1Sec, profile.t1Sec * 1.3] : a.t1;
  const t2 = profile.t2Sec > 0 ? [profile.t2Sec * 0.85, profile.t2Sec, profile.t2Sec * 1.3] : a.t2;
  const src = profile.t1Sec > 0 || profile.t2Sec > 0 ? 'Your transition estimates' : 'Assumption (typical age-group 70.3; beach-to-transition distance unverified)';
  return {
    t1: splitObj(...t1, src, 'low'),
    t2: splitObj(...t2, src, 'low'),
  };
}

/** Full prediction. */
export function predictRace(bm = {}, profile = {}, evidence = {}) {
  const swim = predictSwim(bm, evidence);
  const bike = predictBike(bm, profile);
  const run = predictRun(bm, evidence);
  const { t1, t2 } = predictTransitions(profile);
  const splits = { swim, t1, bike, t2, run };
  const missing = Object.entries(splits).filter(([, s]) => !s.established).map(([k, s]) => ({ split: k, needed: s.needed }));
  let total = null;
  if (!missing.length) {
    const sum = (k) => Object.values(splits).reduce((a, s) => a + s[k], 0);
    total = { lo: sum('lo'), mid: sum('mid'), hi: sum('hi') };
    total.probBelowTargetNote = total.hi < TARGET_SEC ? 'Entire range is under 5:15' : total.lo > TARGET_SEC ? 'Entire range is over 5:15' : 'Range straddles 5:15';
  }
  return { splits, total, missing, target: TARGET_SEC, generatedFrom: Object.fromEntries(Object.entries(splits).map(([k, s]) => [k, s.established ? s.source : null])) };
}

/** Factors helping/limiting, derived from the prediction vs. target budget. */
export function limiters(pred) {
  const tgt = SCENARIOS.target;
  const out = [];
  for (const k of ['swim', 'bike', 'run']) {
    const s = pred.splits[k];
    if (!s.established) {
      out.push({ split: k, kind: 'unknown', text: `${cap(k)}: not yet established — ${s.needed}.` });
      continue;
    }
    const delta = s.mid - tgt[k];
    out.push({ split: k, kind: delta <= 0 ? 'helping' : 'limiting', delta, text: `${cap(k)}: likely ${fmt(s.mid)} vs. target budget ${fmt(tgt[k])} (${delta <= 0 ? '−' : '+'}${fmt(Math.abs(delta))}).` });
  }
  return out.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
}

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}
function fmt(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
