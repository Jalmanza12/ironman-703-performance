// Plan-adjustment layer. The generated plan (js/plan/) stays the source of truth; athlete-
// approved changes are stored as small overrides on top of it:
//   state.reschedules[id] = 'YYYY-MM-DD'                (existing move store — kept for compatibility)
//   state.overrides[id]   = { cancelled, durationMin, replacement, changeId }
//   state.changeHistory   = [{ id, at, source, summary, changes:[{workoutId, action, before, after, reason}], status }]
// Every AI or rules-based proposal goes through validateProposal() and is applied only by
// applyProposal() after explicit athlete approval. Logged results (state.logs) are never touched.

import { addDays, diffDays, dayOfWeek, isISODate, mondayOf } from './dates.js';
import { DONE } from './load.js';

export const ACTIONS = ['skip', 'move', 'shorten', 'replace'];
export const SPORTS = ['swim', 'bike', 'run', 'strength', 'mobility', 'other'];
export const INTENSITIES = ['easy', 'moderate', 'hard', 'long'];
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LEG = new Set(['bike', 'run']);
const DEMANDING = new Set(['hard', 'long', 'test', 'race']);
const RPE_BY_INTENSITY = { easy: 3, moderate: 5, hard: 7, long: 5 };

/** Session as it currently stands after overrides (never mutates the plan). */
export function effectiveSession(plan, state, id) {
  const s = plan.sessions[id];
  if (!s) return null;
  const o = state.overrides?.[id] || {};
  const date = state.reschedules?.[id] || s.date;
  const out = { ...s, date, originalDate: s.date, moved: date !== s.date, cancelled: !!o.cancelled, adjusted: false };
  if (o.durationMin) {
    out.durationMin = o.durationMin;
    out.originalDurationMin = s.durationMin;
    out.adjusted = true;
    if (s.plannedRPE) out.plannedRPE = s.plannedRPE;
  }
  if (o.replacement) {
    const r = o.replacement;
    Object.assign(out, {
      title: `${r.title} (replaces ${s.title})`, sport: r.sport, durationMin: r.durationMin, intensity: r.intensity,
      plannedRPE: RPE_BY_INTENSITY[r.intensity] ?? 4, replacedFrom: s.title, replacementDescription: r.description, adjusted: true,
    });
  }
  if (out.cancelled || out.moved) out.adjusted = true;
  return out;
}

/** Effective sessions on a date: own (not moved away) + moved in. Cancelled sessions included (flagged). */
export function effectiveSessionsOn(plan, state, date) {
  const ids = new Set();
  const day = plan.byDate[date];
  if (day) for (const s of day.sessions) if (!state.reschedules?.[s.id] || state.reschedules[s.id] === date) ids.add(s.id);
  for (const [id, d] of Object.entries(state.reschedules || {})) if (d === date) ids.add(id);
  return [...ids].map((id) => effectiveSession(plan, state, id)).filter(Boolean).sort((a, b) => a.seq - b.seq);
}

export function isDemandingLeg(s) {
  return s && !s.cancelled && LEG.has(s.sport) && DEMANDING.has(s.intensity);
}

function dayMinutes(sessions) {
  return sessions.filter((s) => !s.cancelled && s.sport !== 'rest').reduce((a, s) => a + (s.durationMin || 0), 0);
}

function weekLoad(plan, state, weekStart) {
  let load = 0;
  for (let i = 0; i < 7; i += 1) {
    for (const s of effectiveSessionsOn(plan, state, addDays(weekStart, i))) {
      if (s.cancelled || s.sport === 'rest' || s.sport === 'race') continue;
      load += (s.durationMin || 0) * (s.plannedRPE || 3);
    }
  }
  return load;
}

export function availabilityFor(state, date) {
  const a = state.profile?.availability;
  if (!a) return null;
  return a[DAYS[dayOfWeek(date)]] || null;
}

/** Fingerprint of everything a proposal depends on — detects plan edits while it is pending. */
export function fingerprint(state, ids = []) {
  const parts = ids.slice().sort().map((id) => [id, state.logs?.[id]?.status || '', state.reschedules?.[id] || '', JSON.stringify(state.overrides?.[id] || {})].join('|'));
  parts.push(JSON.stringify(state.profile?.availability || {}));
  return parts.join(';');
}

export function affectedIds(proposal) {
  return [...new Set((proposal?.changes || []).map((c) => c.workoutId))];
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Applies one change to a cloned state (no validation). */
function mutate(state, plan, c) {
  const s = plan.sessions[c.workoutId];
  state.overrides ||= {};
  state.reschedules ||= {};
  const o = { ...(state.overrides[c.workoutId] || {}) };
  if (c.action === 'skip') o.cancelled = true;
  if (c.action === 'shorten') o.durationMin = c.newDurationMin;
  if (c.action === 'replace') o.replacement = { ...c.replacement };
  if (c.action === 'move') {
    if (c.newDate === s.date) delete state.reschedules[c.workoutId];
    else state.reschedules[c.workoutId] = c.newDate;
    o.cancelled = false;
    if (c.newDurationMin) o.durationMin = c.newDurationMin;
  }
  for (const k of Object.keys(o)) if (o[k] === false || o[k] == null) delete o[k];
  if (Object.keys(o).length) state.overrides[c.workoutId] = o;
  else delete state.overrides[c.workoutId];
}

function snapshot(plan, state, id) {
  const e = effectiveSession(plan, state, id);
  return { date: e.date, durationMin: e.durationMin, cancelled: e.cancelled, title: e.title, sport: e.sport, intensity: e.intensity, reschedule: state.reschedules?.[id] || null, override: state.overrides?.[id] ? clone(state.overrides[id]) : null };
}

/**
 * Validate a proposal against the CURRENT plan/state. Returns
 * { ok, errors[], warnings[], items:[{change, before, after, errors, warnings}] }.
 * Changes are simulated in order on a clone so multi-change interactions are checked.
 */
export function validateProposal(plan, state, proposal, { today, raceDate = '2027-03-14' } = {}) {
  const errors = [];
  const warnings = [];
  const items = [];
  if (!proposal || typeof proposal !== 'object') return { ok: false, errors: ['Malformed proposal.'], warnings, items };
  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  if (!changes.length && !proposal.availabilityUpdate) errors.push('The proposal contains no changes.');
  if (changes.length > 14) errors.push('Too many changes in one proposal (max 14).');
  const seen = new Set();
  const sim = clone({ logs: state.logs || {}, reschedules: state.reschedules || {}, overrides: state.overrides || {}, profile: { availability: state.profile?.availability || null } });
  if (proposal.availabilityUpdate) {
    const av = validateAvailability(proposal.availabilityUpdate);
    errors.push(...av.errors);
    if (!av.errors.length) sim.profile.availability = mergeAvailability(sim.profile.availability, proposal.availabilityUpdate);
  }
  const weeksTouched = new Set();
  for (const c of changes) {
    const e = [];
    const w = [];
    const s = plan.sessions[c?.workoutId];
    if (!c || !ACTIONS.includes(c.action)) e.push(`Unknown action "${c?.action}".`);
    if (!s) {
      e.push(`Workout "${c?.workoutId}" does not exist in the plan.`);
      items.push({ change: c, errors: e, warnings: w });
      errors.push(...e);
      continue;
    }
    if (seen.has(c.workoutId)) e.push(`${s.title}: listed more than once.`);
    seen.add(c.workoutId);
    const before = snapshot(plan, sim, c.workoutId);
    const log = state.logs?.[c.workoutId];
    if (s.sport === 'race' || s.sport === 'rest') e.push(`${s.title} cannot be changed.`);
    if (log && DONE.has(log.status)) e.push(`${s.title} is already logged as ${log.status}; completed history is never changed.`);
    if (log?.status === 'skipped' && c.action !== 'move') e.push(`${s.title} is already logged as skipped.`);
    if (today && before.date < today && c.action !== 'move') e.push(`${s.title} (${before.date}) is in the past; past workouts are kept as history.`);
    if (c.action === 'skip' && before.cancelled) e.push(`${s.title} is already skipped.`);
    if (c.action === 'skip' && s.priority?.startsWith('Key')) w.push(`${s.title} is a key session; skipping it removes a planned stimulus — fine when recovery or life requires it.`);
    if (c.action === 'shorten') {
      const n = Number(c.newDurationMin);
      if (!Number.isInteger(n) || n < 10 || n >= (before.durationMin || 0)) e.push(`${s.title}: new duration must be a whole number of minutes from 10 to ${(before.durationMin || 11) - 1}.`);
    }
    if (c.action === 'replace') {
      const r = c.replacement || {};
      if (!r.title || typeof r.title !== 'string' || r.title.length > 80) e.push(`${s.title}: replacement needs a short title.`);
      if (!SPORTS.includes(r.sport)) e.push(`${s.title}: replacement sport is invalid.`);
      if (!INTENSITIES.includes(r.intensity)) e.push(`${s.title}: replacement intensity is invalid.`);
      if (!Number.isInteger(r.durationMin) || r.durationMin < 10 || r.durationMin > Math.min(240, Math.round((s.durationMin || 60) * 1.25))) e.push(`${s.title}: replacement duration must be 10–${Math.min(240, Math.round((s.durationMin || 60) * 1.25))} min.`);
    }
    let target = before.date;
    if (c.action === 'move' && c.newDurationMin != null) {
      const n = Number(c.newDurationMin);
      if (!Number.isInteger(n) || n < 10 || n > (s.durationMin || 0)) e.push(`${s.title}: new duration must be 10–${s.durationMin} min.`);
    }
    if (c.action === 'move') {
      target = c.newDate;
      if (!isISODate(c.newDate)) e.push(`${s.title}: "${c.newDate}" is not a valid date.`);
      else {
        if (today && c.newDate < today) e.push(`${s.title}: cannot move to a past date.`);
        if (c.newDate === before.date) e.push(`${s.title} is already on ${c.newDate}.`);
        if (c.newDate < plan.days[0].date || c.newDate >= raceDate) e.push(`${s.title}: ${c.newDate} is outside the training window.`);
        if (diffDays(c.newDate, raceDate) <= 5 && DEMANDING.has(s.intensity)) e.push(`${s.title}: demanding sessions cannot be moved into the final 5 days before the race.`);
        if (mondayOf(c.newDate) !== mondayOf(s.date)) w.push(`${s.title}: moves into a different training week, which changes that week's load.`);
        if (dayOfWeek(c.newDate) === 1) w.push(`${s.title}: ${c.newDate} is your planned rest day — losing it reduces recovery.`);
      }
    }
    if (!e.length) {
      mutate(sim, plan, c);
      weeksTouched.add(mondayOf(s.date));
      if (target) weeksTouched.add(mondayOf(target));
      items.push({ change: c, before, errors: e, warnings: w });
    } else items.push({ change: c, before, errors: e, warnings: w });
    errors.push(...e);
    warnings.push(...w);
  }
  // Phase 2: target-day checks against the FINAL simulated schedule, so swaps
  // (e.g., long run ⇄ long ride) are judged on the end result, not an intermediate state.
  for (const it of items) {
    if (it.errors.length || !it.before) continue;
    const c = it.change;
    const s = plan.sessions[c.workoutId];
    const after = snapshot(plan, sim, c.workoutId);
    it.after = after;
    if (!isISODate(after.date) || after.cancelled) continue;
    const e = it.errors;
    const w = it.warnings;
    const daySessions = effectiveSessionsOn(plan, sim, after.date);
    const me = daySessions.find((x) => x.id === c.workoutId);
    const others = daySessions.filter((x) => x.id !== c.workoutId);
    if (isDemandingLeg(me) && others.some(isDemandingLeg)) e.push(`${s.title}: ${after.date} already has a demanding bike/run session — stacking them is not allowed.`);
    if (me && LEG.has(me.sport) && others.some((x) => !x.cancelled && x.sport === me.sport && !(x.brick || me.brick) && c.action === 'move')) w.push(`${s.title}: ${after.date} already has a ${me.sport} session.`);
    if (isDemandingLeg(me) && c.action === 'move') {
      const adj = [addDays(after.date, -1), addDays(after.date, 1)].filter((d) => effectiveSessionsOn(plan, sim, d).some((x) => x.id !== c.workoutId && isDemandingLeg(x)));
      const weekendPair = me.intensity === 'long' && [0, 6].includes(dayOfWeek(after.date));
      if (adj.length && !weekendPair) w.push(`${s.title}: next to another hard day (${adj.join(', ')}); expect reduced quality.`);
    }
    const mins = dayMinutes(daySessions);
    const av = availabilityFor(sim, after.date);
    if (av && av.available === false && c.action !== 'skip') e.push(`${s.title}: you marked ${DAYS[dayOfWeek(after.date)].toUpperCase()} as unavailable.`);
    if (av?.maxMinutes && mins > av.maxMinutes) w.push(`${after.date} totals ${mins} min, above your ${av.maxMinutes}-min availability.`);
    if (mins > 330) e.push(`${after.date} would total ${mins} min of training — too much for one day.`);
    errors.push(...e);
    warnings.push(...w);
  }
  if (!errors.length) {
    for (const wk of weeksTouched) {
      const was = weekLoad(plan, { reschedules: state.reschedules || {}, overrides: state.overrides || {} }, wk);
      const now = weekLoad(plan, sim, wk);
      if (was > 0 && now > was * 1.1) errors.push(`The week of ${wk} would carry ${Math.round((now / was - 1) * 100)}% more training load than planned — missed work should not be crammed in.`);
    }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], items };
}

export function validateAvailability(u) {
  const errors = [];
  const list = Array.isArray(u?.changes) ? u.changes : [];
  if (!list.length) errors.push('Availability update has no days.');
  for (const d of list) {
    if (!DAYS.includes(d?.day)) errors.push(`Unknown day "${d?.day}".`);
    if (typeof d?.available !== 'boolean') errors.push(`Availability for ${d?.day} must be yes/no.`);
    if (d?.maxMinutes != null && !(Number.isInteger(d.maxMinutes) && d.maxMinutes >= 0 && d.maxMinutes <= 600)) errors.push(`Max minutes for ${d?.day} must be 0–600.`);
  }
  return { errors };
}

export function mergeAvailability(current, u) {
  const out = { ...(current || {}) };
  for (const d of u.changes) out[d.day] = { available: d.available, maxMinutes: d.maxMinutes ?? out[d.day]?.maxMinutes ?? null };
  return out;
}

/**
 * Apply an approved proposal atomically. Returns { ok, state, entry } or { ok:false, stale?, validation }.
 * `stale` means the plan changed since the proposal was created: re-validate and re-confirm.
 */
export function applyProposal(plan, state, proposal, { today, source = 'ai', now = new Date().toISOString(), id } = {}) {
  if (proposal.fingerprint != null && proposal.fingerprint !== fingerprint(state, affectedIds(proposal))) {
    return { ok: false, stale: true, validation: validateProposal(plan, state, proposal, { today }) };
  }
  if (proposal.today && today && proposal.today !== today) {
    const v = validateProposal(plan, state, proposal, { today });
    return { ok: false, stale: true, validation: v };
  }
  const validation = validateProposal(plan, state, proposal, { today });
  if (!validation.ok) return { ok: false, validation };
  const next = clone(state);
  next.overrides ||= {};
  next.reschedules ||= {};
  next.changeHistory ||= [];
  const entry = { id: id || `chg-${Date.now().toString(36)}`, at: now, source, summary: proposal.summary || '', changes: [], status: 'applied' };
  for (const c of proposal.changes || []) {
    const before = snapshot(plan, next, c.workoutId);
    mutate(next, plan, c);
    const o = next.overrides[c.workoutId];
    if (o) o.changeId = entry.id;
    entry.changes.push({ workoutId: c.workoutId, action: c.action, reason: c.reason || '', before, after: snapshot(plan, next, c.workoutId) });
  }
  if (proposal.availabilityUpdate) {
    entry.availabilityBefore = clone(next.profile?.availability || null);
    next.profile = { ...(next.profile || {}), availability: mergeAvailability(next.profile?.availability, proposal.availabilityUpdate) };
    entry.availabilityAfter = clone(next.profile.availability);
  }
  next.changeHistory.push(entry);
  return { ok: true, state: next, entry };
}

/** Undo is safe only if the affected sessions were not logged or changed again since. */
export function canUndo(state, entry, { today } = {}) {
  if (!entry || entry.status !== 'applied') return { ok: false, reason: 'Already undone.' };
  for (const c of entry.changes) {
    const log = state.logs?.[c.workoutId];
    if (log) return { ok: false, reason: 'A session in this change has been logged since.' };
    const cur = { reschedule: state.reschedules?.[c.workoutId] || null, override: stripChangeId(state.overrides?.[c.workoutId]) };
    if (JSON.stringify(cur) !== JSON.stringify({ reschedule: c.after.reschedule, override: stripChangeId(c.after.override) })) return { ok: false, reason: 'These sessions were changed again later.' };
    if (today && c.before.date < today) return { ok: false, reason: 'The original date has passed.' };
  }
  return { ok: true };
}

function stripChangeId(o) {
  if (!o) return null;
  const { changeId, ...rest } = o;
  return Object.keys(rest).length ? rest : null;
}

export function undoChange(state, entryId, { today } = {}) {
  const next = clone(state);
  const entry = (next.changeHistory || []).find((e) => e.id === entryId);
  const check = canUndo(next, entry, { today });
  if (!check.ok) return { ok: false, reason: check.reason };
  for (const c of entry.changes) {
    if (c.before.reschedule) next.reschedules[c.workoutId] = c.before.reschedule; else delete next.reschedules[c.workoutId];
    if (c.before.override) next.overrides[c.workoutId] = c.before.override; else delete next.overrides[c.workoutId];
  }
  if (entry.availabilityBefore !== undefined) next.profile.availability = entry.availabilityBefore;
  entry.status = 'undone';
  entry.undoneAt = new Date().toISOString();
  return { ok: true, state: next };
}
