// Training volume, load, compliance and per-session feedback.
// Load uses session-RPE (Foster 2001): minutes × RPE (0–10). It is a coarse internal-load
// index — useful for trends, never proof of fitness or readiness on its own.

import { validHR } from './zones.js';
import { effectiveSessionsOn } from './adjustments.js';

export const SPORTS = ['swim', 'bike', 'run', 'strength'];
export const DONE = new Set(['completed', 'modified', 'replaced']);

export function effectiveDate(session, reschedules = {}) {
  return reschedules[session.id] || session.date;
}

/** Planned & actual volume for a set of days. Rest/optional mobility excluded from planned. */
export function aggregate(days, logs = {}, { includeOptional = false, plan = null, state = null } = {}) {
  const planned = blank();
  const actual = blank();
  for (const d of days) {
    // With plan+state, use the athlete-approved (effective) schedule: moved sessions count on
    // their new date, cancelled ones drop out of "planned", shortened ones use the new duration.
    const list = plan && state ? effectiveSessionsOn(plan, state, d.date) : d.sessions;
    for (const s of list) {
      if (s.sport === 'rest') continue;
      const k = SPORTS.includes(s.sport) ? s.sport : 'other';
      const optional = s.priority === 'Optional';
      if (!s.cancelled && (!optional || includeOptional)) {
        planned[k] += s.durationMin || 0;
        planned.total += s.durationMin || 0;
        planned.sessions += 1;
        planned.load += (s.durationMin || 0) * (s.plannedRPE || 3);
        if (s.priority?.startsWith('Key')) planned.key += 1;
      }
      const l = logs[s.id];
      if (l && DONE.has(l.status)) {
        const min = Number(l.actual?.durationMin) || (l.status === 'completed' ? s.durationMin || 0 : 0);
        actual[k] += min;
        actual.total += min;
        actual.sessions += 1;
        actual.load += min * (Number(l.actual?.rpe) || s.plannedRPE || 3);
        if (s.priority?.startsWith('Key')) actual.key += 1;
      }
    }
  }
  // Recovery weeks made entirely of optional sessions (e.g., post-race Week 0) still show their plan.
  if (planned.total === 0 && !includeOptional && days.some((d) => d.sessions.some((s) => s.priority === 'Optional' && s.durationMin))) return aggregate(days, logs, { includeOptional: true, plan, state });
  return { planned, actual, completion: planned.total ? actual.total / planned.total : null, keyCompletion: planned.key ? actual.key / planned.key : null };
}

function blank() {
  return { swim: 0, bike: 0, run: 0, strength: 0, other: 0, total: 0, sessions: 0, key: 0, load: 0 };
}

/** Daily sRPE load series (actual) for a date range. */
export function dailyLoad(days, logs) {
  return days.map((d) => {
    let load = 0;
    for (const s of d.sessions) {
      const l = logs[s.id];
      if (l && DONE.has(l.status)) load += (Number(l.actual?.durationMin) || s.durationMin || 0) * (Number(l.actual?.rpe) || s.plannedRPE || 3);
    }
    return { date: d.date, load };
  });
}

/** Acute (7-d) vs chronic (28-d) average daily load. Displayed with caveats (Impellizzeri 2020). */
export function acuteChronic(series, idx) {
  const win = (n) => series.slice(Math.max(0, idx - n + 1), idx + 1);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y.load, 0) / a.length : 0);
  const a7 = avg(win(7));
  const c28 = avg(win(28));
  return { acute: a7, chronic: c28, ratio: c28 > 0 ? a7 / c28 : null };
}

/** Count planned interval reps from main-set text like "4 × 8 min". */
export function plannedReps(session) {
  let reps = 0;
  for (const st of session.main || []) {
    const m = /^(\d+)\s*×/.exec(st.text || '');
    if (m && (st.target?.kind === 'bike' || st.target?.kind === 'run' || st.target?.kind === 'swim') && session.intensity !== 'long') reps += Number(m[1]);
  }
  return reps;
}

/**
 * Compare a logged session with its plan. Returns {wentWell[], fellShort[], change[], metrics{}}.
 * Never claims precision the data doesn't support: missing fields produce no judgement.
 */
export function compareSession(session, log, bm = {}) {
  const out = { wentWell: [], fellShort: [], change: [], metrics: {} };
  if (!log) return out;
  const a = log.actual || {};
  if (log.status === 'skipped') {
    out.fellShort.push('Session skipped.');
    out.change.push(session.priority?.startsWith('Key')
      ? 'Key session missed: see "Reschedule" for a recovery-safe option. Do not stack it onto a hard day.'
      : 'Non-key session: let it go — do not add the volume elsewhere.');
    return out;
  }
  const dur = Number(a.durationMin);
  if (dur > 0 && session.durationMin) {
    const pct = dur / session.durationMin;
    out.metrics.durationPct = pct;
    if (pct >= 0.9 && pct <= 1.15) out.wentWell.push(`Duration on plan (${Math.round(pct * 100)}%).`);
    else if (pct < 0.9) out.fellShort.push(`Shorter than planned (${Math.round(pct * 100)}%).`);
    else out.change.push(`Ran ${Math.round(pct * 100)}% of planned duration — extra volume rarely helps; keep to the plan.`);
  }
  const rpe = Number(a.rpe);
  if (rpe > 0 && session.plannedRPE) {
    const d = rpe - session.plannedRPE;
    out.metrics.rpeDelta = d;
    if (Math.abs(d) <= 1) out.wentWell.push(`Effort matched intent (RPE ${rpe} vs ~${session.plannedRPE}).`);
    else if (d >= 2) {
      out.fellShort.push(`Felt much harder than intended (RPE ${rpe} vs ~${session.plannedRPE}).`);
      out.change.push(session.intensity === 'easy' || session.intensity === 'long'
        ? 'An easy/long session at high RPE often means fatigue, heat, under-fueling or pacing too fast. Slow down next time and check sleep and fueling.'
        : 'If this repeats in the next quality session, the targets may be too high or recovery too low — consider a retest or an extra easy day.');
    } else if (d <= -2 && session.intensity === 'hard') out.change.push('Felt easier than planned — good sign. If this repeats over 2–3 sessions, it supports a benchmark retest at the next scheduled test.');
  }
  const reps = plannedReps(session);
  if (reps && a.intervalsCompleted !== undefined && a.intervalsCompleted !== '') {
    const done = Number(a.intervalsCompleted);
    out.metrics.repsPct = done / reps;
    if (done >= reps) out.wentWell.push(`All ${reps} intervals completed.`);
    else out.fellShort.push(`${done}/${reps} intervals completed.`);
  }
  if (session.sport === 'bike' && a.avgPower > 0 && a.np > 0) {
    const vi = a.np / a.avgPower;
    out.metrics.vi = vi;
    if (session.intensity === 'long' || session.intensity === 'easy') {
      if (vi <= 1.05) out.wentWell.push(`Steady pacing: Variability Index ${vi.toFixed(2)} (≤1.05).`);
      else out.change.push(`Variability Index ${vi.toFixed(2)} — power was surgy. On race day, surges on rises cost run fitness. Shift earlier and cap climbs.`);
    }
    if (bm.ftp > 0) out.metrics.if = a.np / bm.ftp;
    if (bm.ftp > 0 && session.intensity === 'easy' && a.np / bm.ftp > 0.78) out.change.push(`Intensity factor ${(a.np / bm.ftp).toFixed(2)} is high for an easy ride — keep easy rides ≤0.75.`);
  }
  if ((session.sport === 'run' || session.sport === 'bike') && session.intensity === 'easy' && a.avgHr > 0) {
    const lthr = session.sport === 'run' ? bm.lthrRun : bm.lthrBike;
    if (validHR(lthr)) {
      const cap = lthr * 0.89;
      if (a.avgHr <= cap) out.wentWell.push(`Easy session stayed easy (avg HR ${a.avgHr} ≤ ${Math.round(cap)}).`);
      else out.change.push(`Average HR ${a.avgHr} is above your Z2 ceiling (${Math.round(cap)}). Keep easy days easy so hard days can be hard.`);
    }
  }
  if (dur >= 90 && (session.sport === 'bike' || session.sport === 'run')) {
    const g = Number(a.carbsG);
    if (g >= 0 && a.carbsG !== undefined && a.carbsG !== '') {
      const gph = g / (dur / 60);
      out.metrics.carbsPerHour = gph;
      if (gph >= 60) out.wentWell.push(`Fueling ${Math.round(gph)} g/h — race-ready range.`);
      else if (gph >= 40) out.change.push(`Fueling ${Math.round(gph)} g/h — build toward 60–90 g/h on long sessions (gut training).`);
      else out.fellShort.push(`Fueling only ${Math.round(gph)} g/h for a ${Math.round(dur)} min session — under-fueling limits quality and recovery.`);
    } else {
      out.change.push('Log carbohydrate grams for long sessions so fueling practice can be tracked.');
    }
  }
  if (a.pain >= 4 || (a.notes || '').match(/\b(sharp|stabbing|dizz|faint|chest)\b/i)) {
    out.fellShort.push('Pain or concerning symptom reported.');
    out.change.push('Stop or modify training that provokes it and seek medical evaluation if it persists, worsens, or involves chest pain, dizziness, or fainting.');
  }
  if (!out.wentWell.length && !out.fellShort.length && !out.change.length) out.wentWell.push('Logged. Add RPE, duration and key metrics for more specific feedback.');
  return out;
}

/** Evidence for the prediction engine derived from logs. */
export function predictionEvidence(plan, state, bm) {
  let longestSwimM = Number(bm.longestSwimM) || 0;
  let longestRunMin = 0;
  let rehearsalSec = Number(bm.swimRehearsal) || 0;
  let brickCount = 0;
  let brickRatios = [];
  let carbs = 0;
  let carbHours = 0;
  for (const [id, l] of Object.entries(state.logs)) {
    const s = plan.sessions[id];
    if (!s || !DONE.has(l.status)) continue;
    const a = l.actual || {};
    if (s.sport === 'run' && !s.brick && Number(a.durationMin) > longestRunMin) longestRunMin = Number(a.durationMin);
    if (s.sport === 'swim' && s.type === 'Race rehearsal' && a.durationMin > 0) {
      longestSwimM = Math.max(longestSwimM, 1900);
    }
    if (s.brick && s.intensity === 'hard' && a.paceSecPerMile > 0 && bm.thresholdPace > 0) {
      brickCount += 1;
      brickRatios.push(a.paceSecPerMile / bm.thresholdPace);
    }
    if ((s.sport === 'bike' || s.sport === 'run') && Number(a.durationMin) >= 90 && a.carbsG !== undefined && a.carbsG !== '') {
      carbs += Number(a.carbsG);
      carbHours += Number(a.durationMin) / 60;
    }
  }
  return {
    longestSwimM, longestRunMin, rehearsalSec: rehearsalSec || null, brickCount,
    brickPaceRatio: brickRatios.length ? brickRatios.reduce((x, y) => x + y, 0) / brickRatios.length : null,
    fuelingGph: carbHours ? carbs / carbHours : null,
  };
}
