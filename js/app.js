// App shell: builds context (plan, saved state, benchmarks, prediction) and routes views.

import { buildPlan } from './plan/generator.js';
import { load, update } from './store/store.js';
import { currentBenchmarks } from './lib/benchmarks.js';
import { predictRace } from './lib/prediction.js';
import { predictionEvidence } from './lib/load.js';
import { runCoaching } from './lib/coaching.js';
import { todayLocalISO } from './lib/dates.js';
import { bindTooltips } from './ui/charts.js';
import { esc } from './ui/h.js';

import { dashboardView } from './ui/dashboard.js';
import { dayView } from './ui/day.js';
import { sessionView } from './ui/session.js';
import { calendarView } from './ui/calendar.js';
import { analyticsView } from './ui/analytics.js';
import { raceView } from './ui/race.js';
import { raceDayView } from './ui/raceday.js';
import { reviewsView } from './ui/reviews.js';
import { fuelView } from './ui/fuel.js';
import { profileView } from './ui/profile.js';
import { moreView, methodView } from './ui/more.js';

const ROUTES = {
  '': dashboardView, day: dayView, session: sessionView, calendar: calendarView, analytics: analyticsView,
  race: raceView, raceday: raceDayView, reviews: reviewsView, fuel: fuelView, profile: profileView, more: moreView, method: methodView,
};

export function context() {
  const plan = buildPlan();
  const state = load();
  const { values: bm, history } = currentBenchmarks(state);
  const today = todayLocalISO();
  const evidence = predictionEvidence(plan, state, bm);
  const prediction = predictRace(bm, state.profile, evidence);
  const coaching = runCoaching({ plan, state, bm, history, today });
  return { plan, state, bm, history, today, evidence, prediction, coaching };
}

/** Record the prediction once per day when it changes (for the history chart). */
function trackPrediction(ctx) {
  const t = ctx.prediction.total;
  if (!t) return;
  const h = ctx.state.predictionHistory;
  const last = h[h.length - 1];
  const rounded = { lo: Math.round(t.lo), mid: Math.round(t.mid), hi: Math.round(t.hi) };
  if (last && last.date === ctx.today) {
    if (last.mid !== rounded.mid || last.lo !== rounded.lo || last.hi !== rounded.hi) update((s) => { s.predictionHistory[s.predictionHistory.length - 1] = { date: ctx.today, ...rounded }; });
  } else if (!last || last.mid !== rounded.mid || last.lo !== rounded.lo || last.hi !== rounded.hi) {
    update((s) => s.predictionHistory.push({ date: ctx.today, ...rounded }));
  }
}

export function render() {
  const main = document.getElementById('main');
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, ...params] = hash.split('/').map(decodeURIComponent);
  const view = ROUTES[route] || ROUTES[''];
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', (a.dataset.nav === (route || 'dashboard')) || (route === '' && a.dataset.nav === 'dashboard') || (route === 'session' && a.dataset.nav === 'day')));
  try {
    const ctx = context();
    trackPrediction(ctx);
    const out = view(ctx, params, render);
    main.innerHTML = typeof out === 'string' ? out : out.html;
    if (out && typeof out.mount === 'function') out.mount(main);
    bindTooltips(main);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><p><a href="#/">Back to dashboard</a></p></div>`;
  }
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  document.getElementById('main')?.focus({ preventScroll: true });
});
render();
// Keep the countdown live without re-rendering the page.
setInterval(() => document.dispatchEvent(new CustomEvent('tick')), 1000);
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
