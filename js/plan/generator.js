// Builds the dated calendar from WEEKS. Session ids are stable ("2026-11-03#0") so logs
// keyed by id survive code updates as long as the day's session order does not change.

import { WEEKS, PHASES, PLAN_START, RACE_DATE } from './weeks.js';
import { addDays, dayOfWeek, DOW } from '../lib/dates.js';
import { BIBLE } from '../data/bible.js';

let cache = null;

export function buildPlan() {
  if (cache) return cache;
  const days = [];
  const weeks = [];
  let offset = 0;
  for (const w of WEEKS) {
    if (w.days.length !== 7) throw new Error(`Week ${w.n} must define 7 days`);
    const weekStart = addDays(PLAN_START, w.n * 7);
    const weekDays = [];
    w.days.forEach((sessions, i) => {
      const date = addDays(weekStart, i);
      const passage = BIBLE[offset];
      const day = {
        date,
        dow: DOW[dayOfWeek(date)],
        dayIndex: offset,
        week: w.n,
        phase: w.phase,
        phaseName: PHASES[w.phase].name,
        weekType: w.type,
        sessions: sessions.map((s, j) => ({ ...s, id: `${date}#${j}`, date, week: w.n, phase: w.phase, weekType: w.type })),
        bible: passage,
      };
      day.objective = dayObjective(day);
      days.push(day);
      weekDays.push(day);
      offset += 1;
    });
    weeks.push({ ...w, start: weekStart, end: addDays(weekStart, 6), days: weekDays, totals: weekTotals(weekDays), phaseName: PHASES[w.phase].name });
  }
  if (days[days.length - 1].date !== RACE_DATE) throw new Error('Plan must end on race day');
  cache = { days, weeks, byDate: Object.fromEntries(days.map((d) => [d.date, d])), sessions: Object.fromEntries(days.flatMap((d) => d.sessions.map((s) => [s.id, s]))) };
  return cache;
}

export function dayObjective(day) {
  const main = day.sessions.filter((s) => s.sport !== 'rest' && s.sport !== 'mobility');
  if (!main.length) return 'Rest and recover — absorb the training.';
  const key = main.find((s) => s.priority?.startsWith('Key')) || main[0];
  return key.objective;
}

export function weekTotals(days) {
  const t = { swim: 0, bike: 0, run: 0, strength: 0, other: 0, totalMin: 0, swimDist: 0, sessions: 0, keySessions: 0, load: 0 };
  for (const d of days) {
    for (const s of d.sessions) {
      const min = s.durationMin || 0;
      if (s.sport === 'rest') continue;
      t.sessions += 1;
      if (s.priority?.startsWith('Key')) t.keySessions += 1;
      const k = ['swim', 'bike', 'run', 'strength'].includes(s.sport) ? s.sport : 'other';
      if (s.priority === 'Optional' && k === 'other') continue;
      t[k] += min;
      t.totalMin += min;
      t.load += min * (s.plannedRPE || 3);
      if (s.sport === 'swim') t.swimDist += s.distance || 0;
    }
  }
  return t;
}

export function weekOf(date) {
  const plan = buildPlan();
  return plan.weeks.find((w) => date >= w.start && date <= w.end) || null;
}
