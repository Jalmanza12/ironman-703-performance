import { esc, NE } from './h.js';
import { sessionCard } from './session.js';
import { sessionsOn, clampToPlan, faithCard } from './day.js';
import { countdown, formatLong, diffDays, addDays } from '../lib/dates.js';
import { formatDuration, formatMinutes, lbFromKg } from '../lib/units.js';
import { aggregate } from '../lib/load.js';
import { stackedBars, lineChart, hbars } from './charts.js';
import { RACE } from '../data/race.js';
import { PHASES } from '../plan/weeks.js';
import { TARGET_SEC, limiters } from '../lib/prediction.js';
import { readiness } from '../lib/readiness.js';
import { formatShort } from '../lib/dates.js';

const C = { swim: '#3987e5', bike: '#c98500', run: '#d55181', strength: '#9085e9' };

function cdHTML() {
  const c = countdown(new Date(), RACE.provisionalStartUtcMs);
  if (c.past) return '<div class="countdown"><span class="cd-num">Race day has passed</span></div>';
  const u = (n, l) => `<div class="cd-unit"><span class="cd-num">${String(n).padStart(2, '0')}</span><span class="cd-lab">${l}</span></div>`;
  return `<div class="countdown" aria-live="off">${u(c.days, 'days')}<span class="cd-sep">:</span>${u(c.hours, 'hours')}<span class="cd-sep">:</span>${u(c.minutes, 'min')}<span class="cd-sep">:</span>${u(c.seconds, 'sec')}</div>`;
}

export function dashboardView(ctx) {
  const date = clampToPlan(ctx, ctx.today);
  const day = ctx.plan.byDate[date];
  const week = ctx.plan.weeks[day.week];
  const wk = aggregate(week.days, ctx.state.logs);
  const sessions = sessionsOn(ctx, date);
  const pct = Math.max(0, Math.min(1, diffDays(ctx.plan.days[0].date, ctx.today) / (ctx.plan.days.length - 1)));
  const p = ctx.prediction;
  const rd = readiness({ plan: ctx.plan, state: ctx.state, bm: ctx.bm, evidence: ctx.evidence, today: ctx.today });

  // Weekly volume chart (planned dashed overlay vs completed stacked by sport) through this week.
  const weeks = ctx.plan.weeks.filter((w) => w.n <= Math.min(day.week + 2, 22));
  const vol = weeks.map((w) => {
    const a = aggregate(w.days, ctx.state.logs);
    return { label: `W${w.n}`, values: { swim: a.actual.swim / 60, bike: a.actual.bike / 60, run: a.actual.run / 60, strength: a.actual.strength / 60 }, tip: `Week ${w.n}: ${formatMinutes(a.actual.total)} done of ${formatMinutes(a.planned.total)} planned`, planned: a.planned.total / 60 };
  });
  const weights = Object.entries(ctx.state.daily).filter(([, d]) => d.weightLb > 0).sort(([a], [b]) => a.localeCompare(b)).slice(-60);
  const fmtT = (s) => formatDuration(s, { forceHours: true });
  const bmRow = (label, v) => `<dt>${esc(label)}</dt><dd>${v == null ? NE : v}</dd>`;
  const unit = ctx.bm.poolUnit || 'yd';
  const alerts = ctx.coaching.filter((c) => c.level !== 'info').slice(0, 3);

  const html = `
  <section class="hero">
    <div class="row between"><div class="eyebrow">${esc(RACE.name)} · ${esc(formatLong(RACE.date))}</div><span class="phase-pill ${PHASES[day.phase].color}">${esc(day.phaseName)}</span></div>
    <div id="cd">${cdHTML()}</div>
    <div class="hero-meta"><span>Week ${day.week} of 22 — ${esc(week.title)}</span><span>Little Elm, TX · Lewisville Lake</span><span>Goal: sub-5:15</span><span title="Not on the official page yet">Start ${esc(RACE.provisionalStartLocal)} CDT (provisional)</span></div>
    <div class="progress-track" aria-label="Plan progress ${Math.round(pct * 100)}%"><div class="progress-fill" style="width:${pct * 100}%"></div></div>
  </section>
  <div class="grid g3" style="margin-top:16px">
    <div class="card span2"><div class="card-head"><h2>${date === ctx.today ? 'Today' : esc(formatLong(date))}</h2><a href="#/day/${date}">Open day →</a></div>
      <p class="text-2">${esc(day.objective)}</p><div class="stack">${sessions.map((s) => sessionCard(s, ctx)).join('')}</div>
      ${alerts.length ? `<div class="stack" style="margin-top:14px">${alerts.map((c) => `<div class="alert ${c.level}"><div class="h">${esc(c.title)}</div><div class="small">${esc(c.observation)} ${esc(c.suggestion)}</div></div>`).join('')}<a class="small" href="#/reviews">All coaching notes →</a></div>` : ''}
    </div>
    ${faithCard(day.bible, { compact: true })}

    <div class="card"><div class="card-head"><h2>Race projection</h2><a href="#/race">Details →</a></div>
      ${p.total ? `<div class="stat"><span class="v">${fmtT(p.total.mid)}</span><span class="l">likely · range ${fmtT(p.total.lo)} – ${fmtT(p.total.hi)}</span></div>
        <p class="small" style="margin-top:8px">${p.total.mid <= TARGET_SEC ? `<span class="chip good">${formatDuration(TARGET_SEC - p.total.mid)} under 5:15</span>` : `<span class="chip warn">${formatDuration(p.total.mid - TARGET_SEC)} over 5:15</span>`} <span class="muted">${esc(p.total.probBelowTargetNote)}</span></p>
        <ul class="clean small">${limiters(p).slice(0, 2).map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>`
        : `<div class="stat"><span class="v sm">${NE}</span><span class="l">Needs ${p.missing.map((m) => m.split).join(', ')} benchmarks</span></div><p class="small muted" style="margin-top:8px">Target: 5:15:00. Baseline tests are scheduled in Week 3 (Oct 27 – Nov 1). No time is predicted until real data exists.</p>`}
    </div>
    <div class="card"><div class="card-head"><h2>This week</h2><span class="muted small">Week ${week.n}</span></div>
      ${hbars(['swim', 'bike', 'run', 'strength'].map((k) => ({ label: k[0].toUpperCase() + k.slice(1), planned: wk.planned[k], actual: wk.actual[k], plannedText: formatMinutes(wk.planned[k]), actualText: formatMinutes(wk.actual[k]), color: C[k] })))}
      <p class="small muted" style="margin-top:8px">${formatMinutes(wk.actual.total)} of ${formatMinutes(wk.planned.total)} · ${wk.actual.key}/${wk.planned.key} key sessions</p>
    </div>
    <div class="card"><div class="card-head"><h2>Readiness</h2><a href="#/race">Breakdown →</a></div>
      <div class="row" style="gap:16px"><div class="ring" style="--p:${rd.score ?? 0}"><div><span><b>${rd.score ?? '—'}</b><br><span class="small muted">/100</span></span></div></div>
      <div class="small text-2">${rd.score == null ? 'Not enough data yet.' : `Based on ${Math.round(rd.coverage * 100)}% of components with data.`}<br><span class="muted">Coaching aid — not a validated prediction.</span></div></div>
    </div>

    <div class="card span2"><div class="card-head"><h2>Weekly volume (hours)</h2><a href="#/analytics">Analytics →</a></div>
      ${stackedBars(vol, [{ key: 'swim', name: 'Swim', color: C.swim }, { key: 'bike', name: 'Bike', color: C.bike }, { key: 'run', name: 'Run', color: C.run }, { key: 'strength', name: 'Strength', color: C.strength }], { overlay: vol.map((v) => v.planned), yFmt: (v) => v.toFixed(v < 10 && v % 1 ? 1 : 0), unit: ' h' })}
    </div>
    <div class="card"><div class="card-head"><h2>Benchmarks</h2><a href="#/profile">Update →</a></div>
      <dl class="kv">
        ${bmRow('FTP', ctx.bm.ftp ? `${ctx.bm.ftp} W${ctx.bm.weightKg ? ` · ${(ctx.bm.ftp / ctx.bm.weightKg).toFixed(2)} W/kg` : ''}` : null)}
        ${bmRow('CSS', ctx.bm.css ? `${formatDuration(ctx.bm.css)} /100${unit}` : null)}
        ${bmRow('Run threshold', ctx.bm.thresholdPace ? `${formatDuration(ctx.bm.thresholdPace)} /mi` : null)}
        ${bmRow('Run LTHR', ctx.bm.lthrRun ? `${ctx.bm.lthrRun} bpm` : null)}
        ${bmRow('Bike LTHR', ctx.bm.lthrBike ? `${ctx.bm.lthrBike} bpm` : null)}
        ${bmRow('Body weight', ctx.bm.weightLb ? `${ctx.bm.weightLb} lb (${ctx.bm.weightKg.toFixed(1)} kg)` : null)}
      </dl>
    </div>
    <div class="card span2"><div class="card-head"><h2>Body-weight trend</h2><a href="#/fuel">Fuel & body comp →</a></div>
      ${weights.length >= 2 ? lineChart([{ name: 'Weight', color: '#e9c46a', points: weights.map(([d2, v], i) => ({ i, y: Number(v.weightLb), tip: `${formatShort(d2)}: ${v.weightLb} lb` })) }], weights.map(([d2]) => formatShort(d2).slice(4)), { yFmt: (v) => v.toFixed(0), height: 180 }) : '<div class="chart-empty">Log morning weight in the daily check-in to see the trend. There is no target weight; the goal is a stable or slowly changing trend while performance improves.</div>'}
    </div>
    <div class="card"><div class="card-head"><h2>Recovery (7 days)</h2></div>${recoverySummary(ctx)}</div>
  </div>`;
  return {
    html,
    mount(root) {
      const el = root.querySelector('#cd');
      const h = () => { if (document.body.contains(el)) el.innerHTML = cdHTML(); else document.removeEventListener('tick', h); };
      document.addEventListener('tick', h);
    },
  };
}

function recoverySummary(ctx) {
  const days = Array.from({ length: 7 }, (_, i) => ctx.state.daily[addDays(ctx.today, -i)]).filter(Boolean);
  if (!days.length) return `<p>${NE}</p><p class="small muted">Complete the daily check-in (sleep, fatigue, soreness) — these subjective markers respond to training stress faster than most objective measures.</p>`;
  const avg = (k) => {
    const v = days.map((d) => Number(d[k])).filter((x) => x > 0);
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—';
  };
  return `<dl class="kv"><dt>Sleep</dt><dd>${avg('sleepH')} h</dd><dt>Fatigue</dt><dd>${avg('fatigue')}/10</dd><dt>Soreness</dt><dd>${avg('soreness')}/10</dd><dt>Motivation</dt><dd>${avg('motivation')}/10</dd><dt>Check-ins</dt><dd>${days.length}/7</dd></dl>`;
}

export { lbFromKg };
