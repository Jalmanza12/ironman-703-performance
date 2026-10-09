import { esc } from './h.js';
import { weeklyReview, blockReview } from '../lib/review.js';
import { formatMinutes, formatDuration } from '../lib/units.js';
import { formatShort } from '../lib/dates.js';
import { hbars } from './charts.js';

const C = { swim: '#3987e5', bike: '#c98500', run: '#d55181', strength: '#9085e9' };
const BLOCK_ENDS = [3, 7, 11, 15, 19, 22];

export function reviewsView(ctx, [wParam]) {
  const current = ctx.plan.weeks.find((w) => ctx.today >= w.start && ctx.today <= w.end) || (ctx.today < ctx.plan.weeks[0].start ? ctx.plan.weeks[0] : ctx.plan.weeks[22]);
  const n = wParam !== undefined && wParam !== '' && !Number.isNaN(Number(wParam)) ? Math.max(0, Math.min(22, Number(wParam))) : Math.max(0, current.n - (ctx.today > current.start ? 0 : 1));
  const r = weeklyReview({ plan: ctx.plan, state: ctx.state, bm: ctx.bm, weekN: n, prediction: ctx.prediction, coaching: ctx.coaching });
  const isBlockEnd = BLOCK_ENDS.includes(n);
  const br = isBlockEnd ? blockReview({ plan: ctx.plan, state: ctx.state, history: ctx.history, endWeekN: n }) : null;
  const list = (arr, empty) => (arr.length ? `<ul class="clean small">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="small muted">${esc(empty)}</p>`);
  const p = ctx.prediction;
  const T = (s) => formatDuration(s, { forceHours: true });

  return `<div class="page-head"><div><div class="eyebrow">Weekly review${isBlockEnd ? ' + 4-week block review' : ''}</div><h1>Week ${n} — ${esc(r.week.title)}</h1><p class="text-2">${esc(formatShort(r.week.start))} – ${esc(formatShort(r.week.end))}</p></div>
    <div class="seg"><a href="#/reviews/${Math.max(0, n - 1)}">← Week ${Math.max(0, n - 1)}</a><a href="#/reviews/${Math.min(22, n + 1)}">Week ${Math.min(22, n + 1)} →</a></div></div>
  <div class="grid g3">
    <div class="card span2"><h2>Planned vs completed</h2><p>${esc(r.summary)}</p>${hbars(r.byDiscipline.map((d) => ({ label: d.sport[0].toUpperCase() + d.sport.slice(1), planned: d.planned, actual: d.actual, plannedText: formatMinutes(d.planned), actualText: formatMinutes(d.actual), color: C[d.sport] })))}</div>
    <div class="card"><h2>Recovery & fatigue</h2>${r.recovery.checkins ? `<dl class="kv"><dt>Sleep</dt><dd>${r.recovery.sleep?.toFixed(1) ?? '—'} h</dd><dt>Fatigue</dt><dd>${r.recovery.fatigue?.toFixed(1) ?? '—'}/10</dd><dt>Soreness</dt><dd>${r.recovery.soreness?.toFixed(1) ?? '—'}/10</dd><dt>Motivation</dt><dd>${r.recovery.motivation?.toFixed(1) ?? '—'}/10</dd><dt>Check-ins</dt><dd>${r.recovery.checkins}/7</dd></dl>` : '<p class="small muted">No check-ins logged this week.</p>'}<div class="block-label">Fueling consistency</div><p class="small">${esc(r.fueling)}</p></div>
    <div class="card"><h2>Key successes</h2>${list(r.successes, 'Log sessions to see successes here.')}</div>
    <div class="card"><h2>Missed objectives</h2>${list(r.missed, 'Nothing missed (or nothing logged yet).')}</div>
    <div class="card"><h2>Strength maintenance</h2>${list(r.strength, '')}</div>
    <div class="card span2"><h2>Lessons & recommended changes</h2>${list([...r.lessons, ...r.recommendations], 'No changes recommended from the available data.')}<p class="disclaimer" style="margin-top:8px">Generated from your logs by transparent rules — automated observations, not professional coaching or medical judgment.</p></div>
    <div class="card"><h2>Prediction & uncertainty</h2>${p.total ? `<p><b>${T(p.total.mid)}</b> likely (${T(p.total.lo)}–${T(p.total.hi)}).</p><p class="small muted">${p.missing.length ? '' : 'Width of the range reflects modeled assumptions; it narrows as bricks, long runs and the race-distance swim are logged.'}</p>` : `<p class="small">Not yet established — needs ${esc(p.missing.map((m) => m.split).join(', '))} benchmark(s).</p>`}</div>
    <div class="card span-all"><h2>Next week's priorities</h2>${list(r.nextPriorities, '')}</div>
    ${br ? `<div class="card span-all"><h2>4-week block review (weeks ${br.weeks[0]}–${br.weeks[br.weeks.length - 1]})</h2>
      <div class="table-wrap"><table class="ex"><thead><tr><th>Week</th><th>Completed / planned</th><th>Key sessions</th><th>Load (sRPE)</th></tr></thead><tbody>${br.perWeek.map((w) => `<tr><td>W${w.n}</td><td>${formatMinutes(w.actual.total)} / ${formatMinutes(w.planned.total)}</td><td>${w.actual.key}/${w.planned.key}</td><td>${Math.round(w.actual.load)} / ${Math.round(w.planned.load)}</td></tr>`).join('')}</tbody></table></div>
      <div class="block-label">Benchmarks this block</div>${list(Object.entries(br.tests).flatMap(([t, arr]) => arr.map((b) => `${t}: ${b.value} (${formatShort(b.date)}, ${b.method || ''})`)), 'No tests logged in this block.')}
      <div class="block-label">Assessment</div>${list(br.recs, '')}
      <p class="small muted">Zones change only from repeatable tests. A single unusual workout never triggers a zone change.</p></div>` : ''}
    <div class="card span-all"><h2>All coaching observations (today)</h2><div class="stack">${ctx.coaching.map((c) => `<div class="alert ${c.level}"><div class="h">${esc(c.title)}</div><div><b>Observed:</b> ${esc(c.observation)}</div><div><b>Suggestion:</b> ${esc(c.suggestion)}</div><div class="why"><b>Why:</b> ${esc(c.why)}</div></div>`).join('')}</div></div>
  </div>`;
}
