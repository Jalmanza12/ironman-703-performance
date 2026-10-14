// Headless smoke test: renders every view with empty and populated state.
import { buildPlan } from '../js/plan/generator.js';
import { emptyState } from '../js/store/store.js';
import { currentBenchmarks } from '../js/lib/benchmarks.js';
import { predictRace } from '../js/lib/prediction.js';
import { predictionEvidence } from '../js/lib/load.js';
import { runCoaching } from '../js/lib/coaching.js';
const views = {
  dashboard: (await import('../js/ui/dashboard.js')).dashboardView,
  day: (await import('../js/ui/day.js')).dayView,
  session: (await import('../js/ui/session.js')).sessionView,
  calendar: (await import('../js/ui/calendar.js')).calendarView,
  analytics: (await import('../js/ui/analytics.js')).analyticsView,
  race: (await import('../js/ui/race.js')).raceView,
  raceday: (await import('../js/ui/raceday.js')).raceDayView,
  reviews: (await import('../js/ui/reviews.js')).reviewsView,
  fuel: (await import('../js/ui/fuel.js')).fuelView,
  profile: (await import('../js/ui/profile.js')).profileView,
  more: (await import('../js/ui/more.js')).moreView,
  method: (await import('../js/ui/more.js')).methodView,
};
const plan = buildPlan();
function ctxFor(state, today) {
  const { values: bm, history } = currentBenchmarks(state);
  const evidence = predictionEvidence(plan, state, bm);
  return { plan, state, bm, history, today, evidence, prediction: predictRace(bm, state.profile, evidence), coaching: runCoaching({ plan, state, bm, history, today }) };
}
const empty = emptyState();
const full = emptyState();
full.benchmarks.push({ id: 'a', type: 'ftp', value: 240, date: '2026-10-27' }, { id: 'b', type: 'css', value: 108, date: '2026-10-28' }, { id: 'c', type: 'thresholdPace', value: 450, date: '2026-11-01' }, { id: 'd', type: 'lthrRun', value: 172, date: '2026-11-01' }, { id: 'e', type: 'ftp', value: 252, date: '2026-11-28' });
for (const d of plan.days.slice(0, 60)) {
  full.daily[d.date] = { sleepH: 7, fatigue: 4, soreness: 3, motivation: 7, weightLb: 183 - d.dayIndex * 0.02 };
  d.sessions.forEach((s, i) => { if (s.sport !== 'rest' && i === 0) full.logs[s.id] = { status: 'completed', actual: { durationMin: s.durationMin, rpe: s.plannedRPE, avgHr: 145, paceSecPerMile: 560, np: s.sport === 'bike' ? 190 : undefined, avgPower: s.sport === 'bike' ? 182 : undefined, carbsG: 120 } }; });
}
full.strength.push({ date: '2026-10-27', exercise: 'Trap-bar deadlift (or barbell RDL if no trap bar)', load: 275, reps: 5, rir: 2 }, { date: '2026-11-03', exercise: 'Trap-bar deadlift (or barbell RDL if no trap bar)', load: 285, reps: 5, rir: 2 });
full.predictionHistory.push({ date: '2026-11-01', lo: 17500, mid: 19000, hi: 21000 }, { date: '2026-11-28', lo: 17200, mid: 18700, hi: 20700 });
let fails = 0;
for (const [label, state, today] of [['empty', empty, '2026-10-09'], ['full', full, '2026-12-03'], ['raceday', full, '2027-03-14'], ['before', empty, '2026-09-01']]) {
  const ctx = ctxFor(state, today);
  const sid = plan.weeks[4].days[1].sessions[1].id;
  const params = { session: [sid], day: [], calendar: ['month'], reviews: [] };
  for (const [name, v] of Object.entries(views)) {
    try {
      const out = v(ctx, params[name] || [], () => {});
      const html = typeof out === 'string' ? out : out.html;
      if (!html || html.length < 100) throw new Error('empty');
      if (/undefined|NaN|\[object Object\]/.test(html.replace(/<[^>]+>/g, ''))) throw new Error('contains undefined/NaN: ' + (html.replace(/<[^>]+>/g, ' ').match(/.{0,60}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]);
    } catch (e) { fails++; console.log('FAIL', label, name, e.message); }
  }
  // also week calendar + every session page for test sessions
  try { views.calendar(ctx, ['week', today], () => {}); } catch (e) { fails++; console.log('FAIL week', e.message); }
}
// Render every session detail once (full state) to catch per-session issues.
const ctx = ctxFor(full, '2026-12-03');
for (const id of Object.keys(plan.sessions)) {
  const out = views.session(ctx, [id], () => {});
  const text = out.html.replace(/<[^>]+>/g, ' ');
  if (/undefined|NaN/.test(text)) { fails++; console.log('FAIL session', id, (text.match(/.{0,60}(undefined|NaN).{0,40}/) || [])[0]); }
}
console.log(fails ? `${fails} failures` : 'All views rendered cleanly.');
const p = ctx.prediction; console.log('sample prediction', p.total && Object.fromEntries(Object.entries(p.splits).map(([k, s]) => [k, Math.round(s.mid / 60)])), p.total && Math.round(p.total.mid / 60));
