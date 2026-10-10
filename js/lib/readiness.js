// Race-readiness indicator: a transparent COACHING AID, not a validated prediction.
// Each component is 0–100 with an explicit data basis; components without data are excluded
// and the coverage is reported, so a high score with little data is visibly weak.

import { DONE } from './load.js';
import { validCSS, validFTP, validRunPace } from './zones.js';

export const WEIGHTS = { consistency: 25, swim: 10, bike: 20, run: 20, brick: 10, recovery: 10, fueling: 5 };

export function readiness({ plan, state, bm, evidence, today }) {
  const past = plan.days.filter((d) => d.date < today && d.date >= '2026-10-12');
  const sess = past.flatMap((d) => d.sessions).filter((s) => s.sport !== 'rest' && !state.overrides?.[s.id]?.cancelled);
  const keys = sess.filter((s) => s.priority?.startsWith('Key'));
  const done = (s) => DONE.has(state.logs[s.id]?.status);
  const c = {};

  c.consistency = keys.length >= 3
    ? { score: Math.round((keys.filter(done).length / keys.length) * 100), basis: `${keys.filter(done).length}/${keys.length} key sessions completed since Oct 12.` }
    : { score: null, basis: 'Needs ≥3 past key sessions.' };

  // Swim: CSS + continuous distance + OW skills.
  if (validCSS(bm.css) || evidence.longestSwimM) {
    const owDone = sess.filter((s) => s.sport === 'swim' && /Open-water|Race rehearsal/.test(s.type) && done(s)).length;
    const dist = Math.min(1, (evidence.longestSwimM || 0) / 1900);
    const score = Math.round((validCSS(bm.css) ? 30 : 0) + dist * 45 + Math.min(1, owDone / 5) * 25);
    c.swim = { score, basis: `CSS ${validCSS(bm.css) ? 'set' : 'missing'}; longest continuous ${Math.round(evidence.longestSwimM || 0)} m of 1,900; ${owDone}/5 open-water skill sessions.` };
  } else c.swim = { score: null, basis: 'Needs a CSS test or a logged continuous swim.' };

  // Bike: FTP + race-power long rides completed.
  const longRace = sess.filter((s) => s.sport === 'bike' && s.intensity === 'long' && /race power/i.test(JSON.stringify(s.main)) && done(s));
  if (validFTP(bm.ftp) || longRace.length) {
    const score = Math.round((validFTP(bm.ftp) ? 30 : 0) + Math.min(1, longRace.length / 8) * 70);
    c.bike = { score, basis: `FTP ${validFTP(bm.ftp) ? 'set' : 'missing'}; ${longRace.length}/8 long rides with race-power blocks completed.` };
  } else c.bike = { score: null, basis: 'Needs FTP or completed race-power long rides.' };

  // Run: threshold + longest run + race-pace long runs.
  const rpLong = sess.filter((s) => s.sport === 'run' && s.intensity === 'long' && /race pace/i.test(s.title) && done(s));
  if (validRunPace(bm.thresholdPace) || evidence.longestRunMin) {
    const score = Math.round((validRunPace(bm.thresholdPace) ? 30 : 0) + Math.min(1, (evidence.longestRunMin || 0) / 100) * 40 + Math.min(1, rpLong.length / 5) * 30);
    c.run = { score, basis: `Threshold ${validRunPace(bm.thresholdPace) ? 'set' : 'missing'}; longest run ${Math.round(evidence.longestRunMin || 0)} of 100 min; ${rpLong.length}/5 race-pace long runs.` };
  } else c.run = { score: null, basis: 'Needs a run benchmark or logged long runs.' };

  const bricks = sess.filter((s) => s.brick);
  c.brick = bricks.length >= 2
    ? { score: Math.round((bricks.filter(done).length / bricks.length) * 70 + Math.min(1, (evidence.brickCount || 0) / 4) * 30), basis: `${bricks.filter(done).length}/${bricks.length} bricks done; ${evidence.brickCount || 0} race-pace bricks with pace logged.` }
    : { score: null, basis: 'Needs ≥2 scheduled bricks in the past.' };

  const recent = Object.entries(state.daily).filter(([d]) => d < today).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7).map(([, d]) => d);
  const sl = recent.map((d) => Number(d.sleepH)).filter((v) => v > 0);
  const fa = recent.map((d) => Number(d.fatigue)).filter((v) => v > 0);
  c.recovery = sl.length >= 3 && fa.length >= 3
    ? { score: Math.round(Math.min(1, avg(sl) / 8) * 60 + (1 - Math.min(1, Math.max(0, (avg(fa) - 3) / 6))) * 40), basis: `7-day sleep ${avg(sl).toFixed(1)} h, fatigue ${avg(fa).toFixed(1)}/10.` }
    : { score: null, basis: 'Needs ≥3 daily check-ins in the last week.' };

  c.fueling = evidence.fuelingGph != null
    ? { score: Math.round(Math.min(1, evidence.fuelingGph / 80) * 100), basis: `Average ${Math.round(evidence.fuelingGph)} g/h on logged long sessions (target 60–90).` }
    : { score: null, basis: 'Log carbohydrate grams on sessions ≥90 min.' };

  let wSum = 0;
  let total = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (c[k].score == null) continue;
    wSum += w;
    total += c[k].score * w;
  }
  return {
    components: c,
    score: wSum ? Math.round(total / wSum) : null,
    coverage: wSum / 100,
    disclaimer: 'Coaching aid built from your logs and plan completion. Weights are coaching judgment, not a validated model; it does not predict your finish time.',
  };
}

function avg(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}
