// Client-side tool executors for the AI Coach agent. The model requests a tool; the browser
// runs it here against the athlete's REAL data (generated plan + approved changes + logs in
// localStorage) and returns the result to the model. Read tools never change anything.
// propose_* tools only build a proposal and run the app's validator — applying it requires the
// athlete to press "Accept Changes" (js/ui/coach.js → applyProposal).

import { addDays, dayOfWeek, DOW, diffDays, isISODate, mondayOf } from './dates.js';
import { effectiveSession, effectiveSessionsOn, validateProposal, fingerprint, affectedIds } from './adjustments.js';
import { aggregate, DONE } from './load.js';
import { RACE } from '../data/race.js';
import { PHASES, WEEKS } from '../plan/weeks.js';

const MAX_RANGE_DAYS = 28;

function statusOf(s, state, today) {
  const log = state.logs?.[s.id];
  if (log) return log.status;
  if (s.cancelled) return 'cancelled-by-plan-change';
  return s.date < today ? 'not-logged' : 'scheduled';
}

export function sessionSummary(s, state, today) {
  const log = state.logs?.[s.id];
  const out = {
    id: s.id, date: s.date, weekday: DOW[dayOfWeek(s.date)], title: s.title, sport: s.sport, type: s.type,
    intensity: s.intensity, priority: s.priority, planned_min: s.durationMin || 0, status: statusOf(s, state, today),
  };
  if (s.moved) out.moved_from = s.originalDate;
  if (s.originalDurationMin) out.shortened_from_min = s.originalDurationMin;
  if (s.replacedFrom) out.replaces = s.replacedFrom;
  if (log?.actual) out.logged = { minutes: log.actual.durationMin ?? null, rpe: log.actual.rpe ?? null };
  return out;
}

function rangeSessions(ctx, start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    for (const s of effectiveSessionsOn(ctx.plan, ctx.state, d)) if (s.sport !== 'rest') out.push(sessionSummary(s, ctx.state, ctx.today));
    if (!effectiveSessionsOn(ctx.plan, ctx.state, d).some((s) => s.sport !== 'rest') && ctx.plan.byDate[d]) out.push({ date: d, weekday: DOW[dayOfWeek(d)], rest_day: true });
  }
  return out;
}

function planWeek(ctx, date) {
  return ctx.plan.weeks.find((w) => date >= w.start && date <= w.end) || null;
}

function err(message) {
  return { error: message };
}

// ---------- read tools ----------
function getAthleteProfile(ctx) {
  const p = ctx.state.profile || {};
  const day = ctx.plan.byDate[ctx.today];
  return {
    race: { name: RACE.name, date: RACE.date, days_to_race: diffDays(ctx.today, RACE.date), goal: 'Finish under 5:15', location: RACE.location },
    today: ctx.today,
    current_phase: day ? { name: PHASES[day.phase].name, week: day.week, week_type: day.weekType } : (ctx.today < ctx.plan.days[0].date ? 'Plan starts 2026-10-05' : 'Plan finished (race day passed)'),
    weekly_structure: 'Mon rest · Tue bike quality + strength · Wed CSS swim + easy run · Thu run quality + strength · Fri swim · Sat long ride + brick run · Sun long run',
    availability: p.availability || 'Not set (no restricted days recorded)',
    time_limits: { weekday_minutes: num(p.weekdayMin), weekend_hours: num(p.weekendHours), preferred_time: p.amPm || null },
    equipment: { power_meter: p.powerMeter || null, smart_trainer: p.trainer || null, bike: p.bikeType || null, pool_unit: p.poolUnit || 'yd' },
    body_weight_lb: ctx.bm?.weightLb ?? null,
    benchmarks: { ftp_w: ctx.bm?.ftp ?? 'not yet established', css_per_100: ctx.bm?.css ?? 'not yet established', run_threshold_s_per_mile: ctx.bm?.thresholdPace ?? 'not yet established' },
    waco_70_3: 'Oct 4 2026, 5:20 with the swim cancelled (athlete-reported)',
  };
}

function getSchedule(ctx, { start_date, end_date }) {
  if (!isISODate(start_date) || !isISODate(end_date)) return err('Dates must be YYYY-MM-DD.');
  if (end_date < start_date) return err('end_date is before start_date.');
  if (diffDays(start_date, end_date) > MAX_RANGE_DAYS) return err(`Range too long (max ${MAX_RANGE_DAYS} days).`);
  const first = ctx.plan.days[0].date;
  const last = ctx.plan.days[ctx.plan.days.length - 1].date;
  const sessions = rangeSessions(ctx, start_date < first ? first : start_date, end_date > last ? last : end_date);
  return { start_date, end_date, plan_window: `${first} to ${last}`, sessions, note: sessions.length ? undefined : 'No planned training in this range.' };
}

function getWeeklySchedule(ctx, { date }) {
  if (!isISODate(date)) return err('date must be YYYY-MM-DD.');
  const w = planWeek(ctx, date);
  if (!w) return err(`${date} is outside the training plan (${ctx.plan.days[0].date} to ${ctx.plan.days[ctx.plan.days.length - 1].date}).`);
  const agg = aggregate(w.days, ctx.state.logs, { plan: ctx.plan, state: ctx.state });
  const def = WEEKS[w.n];
  return {
    week: w.n, start: w.start, end: w.end, phase: PHASES[w.phase].name, week_type: w.type, title: w.title, focus: def.focus,
    deload: def.deload ? { volume: def.deload.volume, kept: def.deload.keeps, removed: def.deload.removed } : null,
    planned_minutes: { total: agg.planned.total, swim: agg.planned.swim, bike: agg.planned.bike, run: agg.planned.run, strength: agg.planned.strength },
    completed_minutes: { total: agg.actual.total, key_sessions: `${agg.actual.key}/${agg.planned.key}` },
    days: rangeSessions(ctx, w.start, w.end),
  };
}

function getWorkoutDetails(ctx, { workout_id }) {
  const s = effectiveSession(ctx.plan, ctx.state, workout_id);
  if (!s) return err(`No workout with id "${workout_id}". Use get_schedule to find ids.`);
  const steps = (arr) => (arr || []).map((x) => [x.text, x.rest ? `(recovery: ${x.rest})` : '', x.note || ''].filter(Boolean).join(' '));
  const log = ctx.state.logs?.[s.id];
  return {
    ...sessionSummary(s, ctx.state, ctx.today),
    objective: s.objective, why_it_exists: s.purpose, zone: s.zone,
    warmup: steps(s.warmup), main_set: steps(s.main), cooldown: steps(s.cooldown),
    replacement_description: s.replacementDescription || undefined,
    modifications: s.modifications, fueling: s.fueling,
    log: log ? { status: log.status, actual: log.actual } : null,
  };
}

function getRecentTraining(ctx, { days }) {
  const n = Math.max(1, Math.min(28, Number(days) || 7));
  const start = addDays(ctx.today, -n);
  const end = addDays(ctx.today, -1);
  const sessions = start <= end ? rangeSessions(ctx, start, end).filter((x) => !x.rest_day) : [];
  const checkins = [];
  for (let i = 0; i <= n; i += 1) {
    const d = addDays(ctx.today, -i);
    const c = ctx.state.daily?.[d];
    if (c) checkins.push({ date: d, sleep_h: c.sleepH ?? null, sleep_quality: c.sleepQ ?? null, fatigue: c.fatigue ?? null, soreness: c.soreness ?? null, motivation: c.motivation ?? null, pain: c.pain ?? null, pain_location: c.painLocation || null, symptoms: c.symptoms || [] });
  }
  const done = sessions.filter((x) => DONE.has(x.status)).length;
  return {
    range: `${start} to ${end}`,
    sessions,
    summary: { sessions_planned: sessions.length, completed_or_modified: done, skipped: sessions.filter((x) => x.status === 'skipped').length, not_logged: sessions.filter((x) => x.status === 'not-logged').length },
    checkins: checkins.length ? checkins : 'No daily check-ins logged in this period.',
    coaching_flags: (ctx.coaching || []).filter((c) => c.level !== 'info').map((c) => ({ level: c.level, title: c.title, observation: c.observation })),
    recent_plan_changes: (ctx.state.changeHistory || []).slice(-5).map((h) => ({ at: h.at, summary: h.summary, status: h.status, source: h.source })),
  };
}

// ---------- proposal tools ----------
function toChange(c) {
  const out = { action: c.action, workoutId: c.workout_id, reason: String(c.reason || '').slice(0, 500) };
  if (c.new_date) out.newDate = c.new_date;
  if (c.new_duration_min != null) out.newDurationMin = c.new_duration_min;
  if (c.replacement) out.replacement = { title: c.replacement.title, sport: c.replacement.sport, durationMin: c.replacement.duration_min, intensity: c.replacement.intensity, description: c.replacement.description || '' };
  return out;
}

function describeChange(ctx, c) {
  const s = effectiveSession(ctx.plan, ctx.state, c.workoutId);
  const name = s ? `${s.title} (${DOW[dayOfWeek(s.date)]} ${s.date})` : c.workoutId;
  if (c.action === 'skip') return `Skip ${name}`;
  if (c.action === 'move') return `Move ${name} to ${DOW[dayOfWeek(c.newDate)] || ''} ${c.newDate}${c.newDurationMin ? ` (${c.newDurationMin} min)` : ''}`;
  if (c.action === 'shorten') return `Shorten ${name} to ${c.newDurationMin} min`;
  return `Replace ${name} with ${c.replacement?.title}`;
}

/** Validate and (if valid) register a proposal as the single pending proposal for this turn. */
function propose(ctx, turn, { summary, changes, expectedImpact = '', recoveryNotes = '', availabilityUpdate = null }) {
  const proposal = {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, source: 'ai',
    summary: summary || changes.map((c) => describeChange(ctx, c)).join('; ') || 'Availability update',
    changes, expectedImpact, recoveryNotes, availabilityUpdate, today: ctx.today,
  };
  const validation = validateProposal(ctx.plan, ctx.state, proposal, { today: ctx.today });
  if (!validation.ok) {
    return { status: 'rejected_by_validator', errors: validation.errors, warnings: validation.warnings, note: 'Nothing was shown to the athlete. Explain the conflict and, if appropriate, propose an alternative.' };
  }
  proposal.fingerprint = fingerprint(ctx.state, affectedIds(proposal));
  turn.proposal = { proposal, validation };
  return {
    status: 'pending_athlete_approval', proposal_id: proposal.id, summary: proposal.summary,
    changes: changes.map((c) => describeChange(ctx, c)), warnings: validation.warnings,
    note: 'Shown to the athlete with Accept/Reject buttons; it replaces any earlier pending proposal. The plan is unchanged until they accept.',
  };
}

export function executeTool(name, input, ctx, turn = {}) {
  try {
    switch (name) {
      case 'get_athlete_profile': return getAthleteProfile(ctx);
      case 'get_schedule': return getSchedule(ctx, input);
      case 'get_weekly_schedule': return getWeeklySchedule(ctx, input);
      case 'get_workout_details': return getWorkoutDetails(ctx, input);
      case 'get_recent_training': return getRecentTraining(ctx, input);
      case 'propose_skip_workout':
        return propose(ctx, turn, { changes: [toChange({ action: 'skip', workout_id: input.workout_id, reason: input.reason })] });
      case 'propose_reschedule_workout':
        return propose(ctx, turn, { changes: [toChange({ action: 'move', workout_id: input.workout_id, new_date: input.new_date, new_duration_min: input.new_duration_min, reason: input.reason })] });
      case 'propose_modify_workout':
        return propose(ctx, turn, { changes: [toChange({ action: 'shorten', workout_id: input.workout_id, new_duration_min: input.new_duration_min, reason: input.reason })] });
      case 'propose_replace_workout':
        return propose(ctx, turn, { changes: [toChange({ action: 'replace', workout_id: input.workout_id, replacement: input.replacement, reason: input.reason })] });
      case 'propose_weekly_adjustment':
        return propose(ctx, turn, { summary: input.summary, changes: (input.changes || []).map(toChange), expectedImpact: input.expected_impact, recoveryNotes: input.recovery_notes });
      case 'propose_availability_update':
        return propose(ctx, turn, { summary: `Update availability: ${(input.changes || []).map((d) => `${d.day} ${d.available ? 'available' : 'unavailable'}`).join(', ')}`, changes: [], availabilityUpdate: { changes: (input.changes || []).map((d) => ({ day: d.day, available: d.available, maxMinutes: d.max_minutes ?? null })) }, expectedImpact: input.reason });
      case 'withdraw_pending_proposal':
        turn.withdraw = true;
        turn.proposal = null;
        return { status: 'withdrawn', note: 'The pending proposal was withdrawn; the plan is unchanged.' };
      default:
        return err(`Unknown tool "${name}".`);
    }
  } catch (e) {
    return err(`Tool failed: ${e.message}`);
  }
}

/** Compact facts prepended to each athlete message (appended once, never edited later). */
export function buildSnapshot(ctx, { timeZone, pending = null, events = [] } = {}) {
  const t = ctx.today;
  const table = Array.from({ length: 16 }, (_, i) => {
    const d = addDays(t, i - 2);
    const tag = i === 1 ? ' (yesterday)' : i === 2 ? ' (today)' : i === 3 ? ' (tomorrow)' : '';
    return `${DOW[dayOfWeek(d)]} ${d}${tag}`;
  });
  const wkStart = mondayOf(t);
  const lines = [];
  for (let d = wkStart; d <= addDays(wkStart, 13); d = addDays(d, 1)) {
    const ss = effectiveSessionsOn(ctx.plan, ctx.state, d).filter((s) => s.sport !== 'rest');
    lines.push(`${DOW[dayOfWeek(d)].slice(0, 3)} ${d}${d === t ? ' (today)' : ''}: ${ss.length ? ss.map((s) => `[${s.id}] ${s.title} · ${s.durationMin || 0} min · ${s.intensity} · ${(s.priority || '').split(' ')[0]} · ${statusOf(s, ctx.state, t)}${s.adjusted ? ' · adjusted' : ''}`).join(' | ') : (ctx.plan.byDate[d] ? 'rest' : 'outside plan')}`);
  }
  const day = ctx.plan.byDate[t];
  const out = [
    `Local date: ${DOW[dayOfWeek(t)]} ${t} · time zone: ${timeZone || 'unknown'}`,
    `Race: ${RACE.name} on Sunday ${RACE.date} (${diffDays(t, RACE.date)} days away). Goal: under 5:15.`,
    day ? `Phase: ${PHASES[day.phase].name}, week ${day.week} of 22 (${day.weekType} week).` : `Today is outside the plan window (${ctx.plan.days[0].date} to ${RACE.date}).`,
    `Date table: ${table.join('; ')}`,
    `This week and next (effective schedule; [id] title · minutes · intensity · priority · status):\n${lines.join('\n')}`,
    `Pending proposal: ${pending ? `${pending.summary} — ${pending.changes.map((c) => describeChange(ctx, c)).join('; ') || 'availability update'}` : 'none'}`,
  ];
  if (events.length) out.push(`Since your last reply: ${events.join(' ')}`);
  return `<app_snapshot>\n${out.join('\n')}\n</app_snapshot>`;
}

export const TOOL_LABELS = {
  get_athlete_profile: 'Read your profile',
  get_schedule: 'Checked your schedule',
  get_weekly_schedule: 'Reviewed the training week',
  get_workout_details: 'Read workout details',
  get_recent_training: 'Reviewed recent training',
  propose_skip_workout: 'Prepared a proposal',
  propose_reschedule_workout: 'Prepared a proposal',
  propose_modify_workout: 'Prepared a proposal',
  propose_replace_workout: 'Prepared a proposal',
  propose_weekly_adjustment: 'Prepared a proposal',
  propose_availability_update: 'Prepared a proposal',
  withdraw_pending_proposal: 'Withdrew the proposal',
};

function num(v) {
  const n = Number(v);
  return v !== '' && v != null && Number.isFinite(n) ? n : null;
}
