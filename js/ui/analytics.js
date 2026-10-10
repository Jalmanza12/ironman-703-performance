import { esc } from './h.js';
import { stackedBars, lineChart } from './charts.js';
import { aggregate, dailyLoad, acuteChronic, DONE } from '../lib/load.js';
import { formatDuration, formatMinutes } from '../lib/units.js';
import { formatShort } from '../lib/dates.js';
import { strengthTrend } from '../lib/benchmarks.js';
import { STRENGTH_PHASES } from '../plan/strength.js';

const C = { swim: '#3987e5', bike: '#c98500', run: '#d55181', strength: '#9085e9', gold: '#e9c46a' };

export function analyticsView(ctx) {
  const { plan, state, history } = ctx;
  const upto = plan.weeks.filter((w) => w.start <= ctx.today);
  const weeks = upto.length ? upto : plan.weeks.slice(0, 1);
  const eff = { plan, state };
  const vols = weeks.map((w) => ({ w, a: aggregate(w.days, state.logs, eff) }));
  const sportSeries = [{ key: 'swim', name: 'Swim', color: C.swim }, { key: 'bike', name: 'Bike', color: C.bike }, { key: 'run', name: 'Run', color: C.run }, { key: 'strength', name: 'Strength', color: C.strength }];

  // Load series
  const pastDays = plan.days.filter((d) => d.date <= ctx.today);
  const series = dailyLoad(pastDays, state.logs);
  const weeklyLoad = weeks.map((w) => ({ label: `W${w.n}`, actual: aggregate(w.days, state.logs, eff).actual.load, planned: aggregate(w.days, state.logs, eff).planned.load }));
  const acr = series.length ? acuteChronic(series, series.length - 1) : null;

  // Benchmarks
  const bmLine = (type, name, color, fmt, invert = false) => {
    const h = history[type] || [];
    if (!h.length) return `<div class="chart-empty">${esc(name)}: no tests logged yet.</div>`;
    return lineChart([{ name, color, points: h.map((b, i) => ({ i, y: Number(b.value), tip: `${formatShort(b.date)}: ${fmt(b.value)} (${b.method || 'test'})` })) }], h.map((b) => formatShort(b.date).slice(4)), { yFmt: fmt, invert, height: 180 });
  };

  // Run pace vs HR (easy/long runs)
  const runs = Object.entries(state.logs).map(([id, l]) => ({ s: plan.sessions[id], l })).filter((x) => x.s?.sport === 'run' && DONE.has(x.l.status) && x.l.actual?.paceSecPerMile > 0 && x.l.actual?.avgHr > 0).sort((a, b) => a.s.date.localeCompare(b.s.date));
  const ef = runs.map((x, i) => ({ i, y: (1609.344 / x.l.actual.paceSecPerMile) * 60 / x.l.actual.avgHr, tip: `${formatShort(x.s.date)} ${x.s.type}: ${formatDuration(x.l.actual.paceSecPerMile)}/mi @ ${x.l.actual.avgHr} bpm` }));

  // Bike power (avg & NP of logged rides)
  const rides = Object.entries(state.logs).map(([id, l]) => ({ s: plan.sessions[id], l })).filter((x) => x.s?.sport === 'bike' && DONE.has(x.l.status) && x.l.actual?.np > 0).sort((a, b) => a.s.date.localeCompare(b.s.date));

  // Strength
  const lifts = [...new Set(state.strength.map((x) => x.exercise))];
  const strengthCharts = lifts.length ? lifts.slice(0, 4).map((ex) => {
    const t = strengthTrend(state.strength, ex);
    return `<div><h3 class="small">${esc(ex.split(' (')[0])} <span class="muted">— ${esc(t.status)}</span></h3>${lineChart([{ name: 'e1RM', color: C.strength, points: t.series.map((p, i) => ({ i, y: p.e1rm, tip: `${formatShort(p.date)}: e1RM ${Math.round(p.e1rm)} lb` })) }], t.series.map((p) => formatShort(p.date).slice(4)), { yFmt: (v) => Math.round(v), height: 150 })}</div>`;
  }).join('') : '<div class="chart-empty">Log load × reps on main lifts (strength session page) to track estimated 1RM.</div>';

  // Recovery
  const rec = Object.entries(state.daily).sort(([a], [b]) => a.localeCompare(b)).slice(-42);
  const recLabels = rec.map(([d]) => formatShort(d).slice(4));
  const recSeries = (k, name, color) => ({ name, color, points: rec.map(([, v], i) => ({ i, y: v[k] > 0 ? Number(v[k]) : null, tip: `${recLabels[i]}: ${name} ${v[k] ?? '—'}` })) });

  // Prediction history
  const ph = state.predictionHistory;

  return `<div class="page-head"><div><div class="eyebrow">Performance analytics</div><h1>Trends & progress</h1></div></div>
  <p class="disclaimer">Session-RPE load (minutes × RPE; Foster 2001) is a coarse internal-load index for spotting trends. It is not proof of fitness or readiness, and no single number here is.</p>
  <div class="grid g2" style="margin-top:14px">
    <div class="card span-all"><h2>Weekly volume by discipline — completed (bars) vs planned (dashed)</h2>${stackedBars(vols.map(({ w, a }) => ({ label: `W${w.n}`, values: { swim: a.actual.swim / 60, bike: a.actual.bike / 60, run: a.actual.run / 60, strength: a.actual.strength / 60 }, tip: `Week ${w.n}: ${formatMinutes(a.actual.total)} / ${formatMinutes(a.planned.total)} (${Math.round((a.completion || 0) * 100)}%)` })), sportSeries, { overlay: vols.map(({ a }) => a.planned.total / 60), yFmt: (v) => (v % 1 ? v.toFixed(1) : v), unit: ' h' })}</div>
    <div class="card"><h2>Weekly training load (session-RPE)</h2>${lineChart([{ name: 'Completed', color: C.gold, points: weeklyLoad.map((w, i) => ({ i, y: w.actual, tip: `${w.label}: ${Math.round(w.actual)} (planned ${Math.round(w.planned)})` })) }, { name: 'Planned', color: '#8d95a8', points: weeklyLoad.map((w, i) => ({ i, y: w.planned, tip: `${w.label} planned: ${Math.round(w.planned)}` })) }], weeklyLoad.map((w) => w.label), { yFmt: (v) => Math.round(v), yMin: 0 })}
      ${acr && acr.chronic > 0 ? `<p class="small muted">7-day avg ${Math.round(acr.acute)}/day vs 28-day avg ${Math.round(acr.chronic)}/day. Use as a prompt to check recovery — the ratio itself has weak predictive validity (Impellizzeri 2020).</p>` : ''}</div>
    <div class="card"><h2>Recovery indicators (last 6 weeks)</h2>${rec.length ? lineChart([recSeries('sleepH', 'Sleep h', C.swim), recSeries('fatigue', 'Fatigue', C.run), recSeries('soreness', 'Soreness', C.bike)], recLabels, { yFmt: (v) => v.toFixed(0), yMin: 0, height: 200 }) : '<div class="chart-empty">No daily check-ins yet.</div>'}</div>
    <div class="card"><h2>Swim — CSS progression</h2>${bmLine('css', 'CSS /100', C.swim, (v) => formatDuration(v), true)}<p class="small muted">Lower is faster (axis inverted so up = better).</p></div>
    <div class="card"><h2>Bike — FTP progression</h2>${bmLine('ftp', 'FTP (W)', C.bike, (v) => `${Math.round(v)}`)}</div>
    <div class="card"><h2>Bike — logged normalized power</h2>${rides.length ? lineChart([{ name: 'NP', color: C.bike, points: rides.map((x, i) => ({ i, y: x.l.actual.np, tip: `${formatShort(x.s.date)} ${x.s.type}: NP ${x.l.actual.np} W, avg ${x.l.actual.avgPower || '—'} W` })) }], rides.map((x) => formatShort(x.s.date).slice(4)), { yFmt: (v) => Math.round(v), height: 180 }) : '<div class="chart-empty">Log NP on rides to see it here.</div>'}</div>
    <div class="card"><h2>Run — threshold pace progression</h2>${bmLine('thresholdPace', 'Threshold /mi', C.run, (v) => formatDuration(v), true)}</div>
    <div class="card"><h2>Run — pace vs heart rate</h2>${ef.length >= 2 ? lineChart([{ name: 'Speed per beat', color: C.run, points: ef }], runs.map((x) => formatShort(x.s.date).slice(4)), { yFmt: (v) => v.toFixed(2), height: 180 }) : '<div class="chart-empty">Log pace and average HR on runs. Rising "metres per minute per beat" at similar conditions suggests improving aerobic efficiency.</div>'}</div>
    <div class="card"><h2>Strength — estimated 1RM</h2><div class="stack">${strengthCharts}</div><p class="small muted">A meaningful decline = two consecutive sessions below 90% of prior best. One low day is noise.</p></div>
    <div class="card span-all"><h2>Projected finish time history</h2>${ph.length ? lineChart([{ name: 'Likely', color: C.gold, points: ph.map((p, i) => ({ i, y: p.mid / 60, tip: `${formatShort(p.date)}: ${formatDuration(p.mid, { forceHours: true })} (${formatDuration(p.lo, { forceHours: true })}–${formatDuration(p.hi, { forceHours: true })})` })) }], ph.map((p) => formatShort(p.date).slice(4)), { yFmt: (v) => formatDuration(v * 60, { forceHours: true }).slice(0, -3), band: ph.map((p, i) => ({ i, lo: p.lo / 60, hi: p.hi / 60 })), refLine: { y: 315, label: '5:15 target' }, invert: false }) : '<div class="chart-empty">The projection history begins once swim, bike and run benchmarks exist.</div>'}</div>
  </div>
  <p class="small muted" style="margin-top:12px">Strength phases: ${Object.values(STRENGTH_PHASES).map((p) => esc(p.label)).join(' → ')}.</p>`;
}
