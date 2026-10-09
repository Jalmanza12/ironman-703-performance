// Recovery-aware rescheduling. A missed session is NOT automatically pushed to tomorrow.
// Rules:
//  1. Only key sessions (and tests) are worth moving; others are dropped.
//  2. Stay inside the same training week (Mon–Sun) — never spill into the next block's load.
//  3. Never onto a Monday rest day, never onto a day that already has a hard/long/test session.
//  4. Hard sessions need ≥1 day separation from other hard/long sessions (no back-to-back
//     hard days, except the planned Sat/Sun long pair).
//  5. Long sessions only move to Sat/Sun (weekday time is limited).
//  6. Never into race week or taper days within 5 days of the race.

import { addDays, dayOfWeek, diffDays } from './dates.js';

const HARD = new Set(['hard', 'test', 'long', 'race']);

export function dayIsHard(day, reschedules = {}, excludeId = null, plan = null) {
  const own = day.sessions.filter((s) => s.id !== excludeId && !reschedules[s.id] && HARD.has(s.intensity));
  const moved = plan ? Object.entries(reschedules).filter(([id, d]) => d === day.date && id !== excludeId).map(([id]) => plan.sessions[id]).filter((s) => s && HARD.has(s.intensity)) : [];
  return own.length + moved.length > 0;
}

export function rescheduleOptions(plan, sessionId, { today, reschedules = {}, raceDate = '2027-03-14' } = {}) {
  const s = plan.sessions[sessionId];
  if (!s) return { allowed: false, reason: 'Unknown session.', options: [] };
  if (s.sport === 'rest' || s.sport === 'race') return { allowed: false, reason: 'This day cannot be moved.', options: [] };
  if (!s.priority?.startsWith('Key') && s.intensity !== 'test') {
    return { allowed: false, reason: 'Not a key session — let it go. Adding missed volume to other days increases fatigue without meaningful benefit.', options: [] };
  }
  const week = plan.weeks.find((w) => s.date >= w.start && s.date <= w.end);
  const options = [];
  const rejected = [];
  for (let d = week.start; d <= week.end; d = addDays(d, 1)) {
    if (d === s.date) continue;
    const why = [];
    if (today && d < today) why.push('in the past');
    if (diffDays(d, raceDate) <= 5) why.push('too close to race day');
    const dow = dayOfWeek(d);
    if (dow === 1) why.push('Monday is the protected rest day');
    const day = plan.byDate[d];
    if (dayIsHard(day, reschedules, sessionId, plan)) why.push('already a hard/long day');
    if (s.intensity === 'long' && dow !== 0 && dow !== 6) why.push('long sessions need a weekend slot');
    if (HARD.has(s.intensity)) {
      const prev = plan.byDate[addDays(d, -1)];
      const next = plan.byDate[addDays(d, 1)];
      const isWeekendPair = s.intensity === 'long' && (dow === 0 || dow === 6);
      if (!isWeekendPair && ((prev && dayIsHard(prev, reschedules, sessionId, plan)) || (next && dayIsHard(next, reschedules, sessionId, plan)))) why.push('adjacent to another hard day — no recovery between');
    }
    if (why.length) rejected.push({ date: d, why });
    else options.push({ date: d, note: `Fits: ${day.sessions.filter((x) => x.sport !== 'rest').map((x) => x.type).join(' + ') || 'rest'} already planned — keep this day's other sessions easy.` });
  }
  return {
    allowed: options.length > 0,
    reason: options.length ? 'Options respect recovery: no back-to-back hard days, no Monday, same week only.' : 'No recovery-safe slot this week. Skip it and continue the plan — consistency beats catching up.',
    options, rejected,
  };
}
