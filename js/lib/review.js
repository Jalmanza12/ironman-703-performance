// Weekly and 4-week (block) reviews generated from logs + plan. Text is assembled from data;
// where data is missing, the review says so instead of guessing.

import { aggregate, compareSession, DONE } from './load.js';
import { strengthTrend } from './benchmarks.js';
import { formatMinutes } from './units.js';
import { formatShort } from './dates.js';

export function weeklyReview({ plan, state, bm, weekN, prediction, coaching }) {
  const w = plan.weeks[weekN];
  if (!w) return null;
  const agg = aggregate(w.days, state.logs, { plan, state });
  const sessions = w.days.flatMap((d) => d.sessions).filter((s) => s.sport !== 'rest');
  const logged = sessions.filter((s) => state.logs[s.id]);
  const keys = sessions.filter((s) => s.priority?.startsWith('Key'));
  const successes = [];
  const missed = [];
  const lessons = new Set();
  for (const s of logged) {
    const l = state.logs[s.id];
    const fb = compareSession(s, l, bm);
    if (DONE.has(l.status) && !fb.fellShort.length && fb.wentWell.length) successes.push(`${formatShort(s.date)} — ${s.title}: ${fb.wentWell[0]}`);
    if (fb.fellShort.length) missed.push(`${formatShort(s.date)} — ${s.title}: ${fb.fellShort.join(' ')}`);
    fb.change.forEach((c) => lessons.add(c));
  }
  for (const s of keys) if (!state.logs[s.id] && s.date < todayISO()) missed.push(`${formatShort(s.date)} — ${s.title}: not logged.`);

  const daily = w.days.map((d) => state.daily[d.date]).filter(Boolean);
  const avgOf = (k) => {
    const v = daily.map((d) => Number(d[k])).filter((x) => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const recovery = {
    sleep: avgOf('sleepH'), fatigue: avgOf('fatigue'), soreness: avgOf('soreness'), motivation: avgOf('motivation'), checkins: daily.length,
  };
  const longOnes = logged.filter((s) => (s.sport === 'bike' || s.sport === 'run') && Number(state.logs[s.id].actual?.durationMin) >= 90);
  const fuelLogged = longOnes.filter((s) => state.logs[s.id].actual?.carbsG !== undefined && state.logs[s.id].actual?.carbsG !== '');
  const fueling = longOnes.length
    ? `${fuelLogged.length}/${longOnes.length} long sessions had fueling logged${fuelLogged.length ? `; average ${Math.round(fuelLogged.reduce((a, s) => a + Number(state.logs[s.id].actual.carbsG) / (Number(state.logs[s.id].actual.durationMin) / 60), 0) / fuelLogged.length)} g/h` : ''}.`
    : 'No long sessions logged this week.';

  const lifts = ['Trap-bar deadlift (or barbell RDL if no trap bar)', 'Back squat or goblet/safety-bar squat', 'Rear-foot-elevated split squat (per leg)', 'Dumbbell bench press or push-up variation'];
  const strength = lifts.map((ex) => ({ ex, t: strengthTrend(state.strength, ex) })).filter((x) => x.t);
  const next = plan.weeks[weekN + 1];
  return {
    week: w, agg,
    byDiscipline: ['swim', 'bike', 'run', 'strength'].map((k) => ({ sport: k, planned: agg.planned[k], actual: agg.actual[k] })),
    successes, missed, lessons: [...lessons].slice(0, 6), recovery, fueling,
    strength: strength.length ? strength.map((x) => `${x.ex.split(' (')[0]}: ${x.t.status} (best e1RM ${Math.round(x.t.best)}).`) : ['No strength sets logged — log load × reps on main lifts to track maintenance.'],
    recommendations: (coaching || []).filter((c) => c.level !== 'info').slice(0, 4).map((c) => `${c.title}: ${c.suggestion}`),
    prediction,
    nextPriorities: next ? next.days.flatMap((d) => d.sessions).filter((s) => s.priority?.startsWith('Key')).map((s) => `${formatShort(s.date)}: ${s.title}`) : ['Race day.'],
    summary: agg.planned.total
      ? `Completed ${formatMinutes(agg.actual.total)} of ${formatMinutes(agg.planned.total)} planned (${Math.round((agg.completion || 0) * 100)}%); ${agg.actual.key}/${agg.planned.key} key sessions.`
      : 'No planned training this week.',
  };
}

/** 4-week block review: benchmarks, consistency, trends, and whether a retest is justified. */
export function blockReview({ plan, state, history, endWeekN }) {
  const weeks = plan.weeks.slice(Math.max(0, endWeekN - 3), endWeekN + 1);
  const days = weeks.flatMap((w) => w.days);
  const agg = aggregate(days, state.logs, { plan, state });
  const perWeek = weeks.map((w) => ({ n: w.n, ...aggregate(w.days, state.logs, { plan, state }) }));
  const tests = Object.fromEntries(['ftp', 'css', 'thresholdPace'].map((t) => [t, (history[t] || []).filter((b) => b.date >= weeks[0].start && b.date <= weeks[weeks.length - 1].end)]));
  const recs = [];
  if ((agg.keyCompletion ?? 0) < 0.7) recs.push('Key-session completion under 70%: before adding load, solve the scheduling problem — move key sessions to the most reliable days and treat others as optional.');
  if ((agg.keyCompletion ?? 0) >= 0.85) recs.push('Consistency is strong (≥85% key sessions). Progress as planned.');
  if (!Object.values(tests).some((t) => t.length)) recs.push('No benchmark tests logged this block — enter results from the scheduled tests so zones and predictions stay accurate.');
  return { weeks: weeks.map((w) => w.n), agg, perWeek, tests, recs };
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
