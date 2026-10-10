// AI Coach core: builds the minimal coaching context sent to the backend, calls the backend,
// and turns any response (AI or rules-based) into a validated, renderable proposal.

import { addDays, dayOfWeek, DOW, mondayOf, diffDays } from './dates.js';
import { effectiveSessionsOn, validateProposal, fingerprint, affectedIds } from './adjustments.js';
import { RACE } from '../data/race.js';
import { PHASES } from '../plan/weeks.js';

export const MAX_HISTORY = 16;

/** Coaching context: only training-relevant data (no notes, injury history text, or contact info). */
export function buildCoachContext(ctx, { activeProposal = null, timeZone = safeTz() } = {}) {
  const { plan, state, today } = ctx;
  const day = plan.byDate[today] || (today < plan.days[0].date ? plan.days[0] : plan.days[plan.days.length - 1]);
  const start = addDays(mondayOf(today), -7);
  const sessions = [];
  for (let i = 0; i < 21; i += 1) {
    const d = addDays(start, i);
    for (const s of effectiveSessionsOn(plan, state, d)) {
      if (s.sport === 'rest' && !s.title) continue;
      const log = state.logs?.[s.id];
      sessions.push({
        id: s.id, date: s.date, day: DOW[dayOfWeek(s.date)].slice(0, 3), title: s.title, sport: s.sport, type: s.type,
        intensity: s.intensity, priority: s.priority, durationMin: s.durationMin || 0, objective: s.objective,
        status: log?.status || (s.cancelled ? 'cancelled-by-plan-change' : s.date < today ? 'not-logged' : 'scheduled'),
        rpe: log?.actual?.rpe ?? null, adjusted: s.adjusted || false, originalDate: s.moved ? s.originalDate : undefined,
      });
    }
  }
  const checkins = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(today, -i);
    const c = state.daily?.[d];
    if (c) checkins.push({ date: d, sleepH: c.sleepH ?? null, fatigue: c.fatigue ?? null, soreness: c.soreness ?? null, motivation: c.motivation ?? null, pain: c.pain ?? null, symptoms: c.symptoms || [] });
  }
  const p = state.profile || {};
  return {
    today, todayWeekday: DOW[dayOfWeek(today)], timeZone,
    dateTable: Array.from({ length: 15 }, (_, i) => `${DOW[dayOfWeek(addDays(today, i - 1))]} ${addDays(today, i - 1)}${i === 1 ? ' (today)' : i === 0 ? ' (yesterday)' : i === 2 ? ' (tomorrow)' : ''}`),
    race: { name: RACE.name, date: RACE.date, daysToRace: diffDays(today, RACE.date), goal: 'Sub-5:15 finish', taperStarts: '2027-03-01' },
    phase: { name: PHASES[day.phase].name, week: day.week, weekType: day.weekType },
    weekStructure: 'Mon rest · Tue bike quality + strength · Wed swim (CSS) + easy run · Thu run quality + strength · Fri swim · Sat long ride + brick run · Sun long run',
    sessions,
    availability: p.availability || null,
    profile: { weekdayMinutes: num(p.weekdayMin), weekendHours: num(p.weekendHours), preferredTime: p.amPm || null, bikeType: p.bikeType || null, powerMeter: p.powerMeter || null, hasTrainer: p.trainer || null, poolUnit: p.poolUnit || 'yd' },
    benchmarks: { ftp: !!ctx.bm?.ftp, css: !!ctx.bm?.css, runThreshold: !!ctx.bm?.thresholdPace },
    recentCheckins: checkins,
    coachingFlags: (ctx.coaching || []).filter((c) => c.level !== 'info').slice(0, 4).map((c) => `${c.level}: ${c.title}`),
    activeProposal: activeProposal ? { summary: activeProposal.summary, changes: activeProposal.changes } : null,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? n : null;
}

function safeTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
}

export class CoachError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'not_configured' | 'timeout' | 'network' | 'unauthorized' | 'rate_limited' | 'server' | 'malformed'
  }
}

/** POST to the coach backend. Never sends or stores any AI-provider key. */
export async function callCoachAPI({ endpoint, accessCode, messages, context }, { timeoutMs = 60000, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint) throw new CoachError('not_configured', 'AI backend not configured.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${endpoint.replace(/\/$/, '')}/coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessCode ? { 'X-Coach-Access': accessCode } : {}) },
      body: JSON.stringify({ messages: messages.slice(-MAX_HISTORY), context }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new CoachError(e?.name === 'AbortError' ? 'timeout' : 'network', e?.name === 'AbortError' ? 'The AI coach took too long to respond.' : 'Could not reach the AI coach.');
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    throw new CoachError('malformed', 'The AI coach returned an unreadable response.');
  }
  if (res.status === 401 || res.status === 403) throw new CoachError('unauthorized', body?.error || 'Access code rejected.');
  if (res.status === 429) throw new CoachError('rate_limited', body?.error || 'Too many requests — try again in a minute.');
  if (res.status === 503 && body?.code === 'not_configured') throw new CoachError('not_configured', body.error || 'AI backend is missing its API key.');
  if (!res.ok) throw new CoachError('server', body?.error || `AI coach error (${res.status}).`);
  if (!body || typeof body.message !== 'string') throw new CoachError('malformed', 'The AI coach returned an invalid response.');
  return body;
}

/**
 * Convert an AI or rules reply into a coach message with a validated proposal.
 * Proposals are re-validated against the CURRENT local plan — the backend's check is not trusted alone.
 */
export function toCoachMessage(reply, ctx, { mode, id = `m-${Date.now().toString(36)}`, at = new Date().toISOString() } = {}) {
  const msg = { id, role: 'coach', mode, at, text: reply.message, intents: reply.intents || [], safetyLevel: reply.safetyLevel || 'none', followUpQuestion: reply.followUpQuestion || null, pending: reply.pending || null };
  const raw = reply.proposal && Array.isArray(reply.proposal.changes) && reply.proposal.changes.length ? reply.proposal : null;
  if (raw || reply.availabilityUpdate) {
    const proposal = {
      id: `p-${id}`, source: mode, summary: raw?.summary || reply.availabilityUpdate?.reason || 'Proposed change',
      changes: (raw?.changes || []).map(cleanChange), expectedImpact: raw?.expectedImpact || '', recoveryNotes: raw?.recoveryNotes || '',
      availabilityUpdate: reply.availabilityUpdate?.changes?.length ? { changes: reply.availabilityUpdate.changes } : null,
      today: ctx.today,
    };
    if (reply.safetyLevel === 'urgent') {
      msg.text += '\n\n(A schedule change was withheld because you reported potentially serious symptoms.)';
    } else {
      proposal.fingerprint = fingerprint(ctx.state, affectedIds(proposal));
      msg.proposal = proposal;
      msg.proposalStatus = 'pending';
      msg.validation = validateProposal(ctx.plan, ctx.state, proposal, { today: ctx.today });
      if (!msg.validation.ok) msg.proposalStatus = 'invalid';
    }
  }
  return msg;
}

function cleanChange(c) {
  const out = { action: c.action, workoutId: c.workoutId, reason: typeof c.reason === 'string' ? c.reason.slice(0, 400) : '' };
  if (c.newDate) out.newDate = c.newDate;
  if (c.newDurationMin != null) out.newDurationMin = c.newDurationMin;
  if (c.replacement) out.replacement = { title: c.replacement.title, sport: c.replacement.sport, durationMin: c.replacement.durationMin, intensity: c.replacement.intensity, description: c.replacement.description || '' };
  return out;
}

/** Only one proposal may be pending: earlier pending ones become "superseded". */
export function supersedePending(messages) {
  for (const m of messages) if (m.proposal && m.proposalStatus === 'pending') m.proposalStatus = 'superseded';
}

export function activeProposal(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].proposal && messages[i].proposalStatus === 'pending') return messages[i].proposal;
  return null;
}

export function lastPending(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'coach') return messages[i].pending || null;
  }
  return null;
}

/** Transcript for the model: plain text turns (proposals summarised), newest last. */
export function transcript(messages) {
  return messages.filter((m) => m.role === 'athlete' || m.role === 'coach').slice(-MAX_HISTORY).map((m) => ({
    role: m.role === 'athlete' ? 'user' : 'assistant',
    text: m.role === 'coach' && m.proposal ? `${m.text}\n[Proposal ${m.proposalStatus}: ${m.proposal.summary}]` : m.text,
  }));
}
