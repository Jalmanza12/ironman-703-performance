import { esc, statusDot } from './h.js';
import { sessionCard } from './session.js';
import { sessionsOn, clampToPlan } from './day.js';
import { addDays, mondayOf, monthLabel, formatShort, DOW_SHORT, parseISO, toISO, isISODate } from '../lib/dates.js';
import { formatMinutes } from '../lib/units.js';
import { aggregate } from '../lib/load.js';
import { PHASES } from '../plan/weeks.js';

const WT_LABEL = { recovery: 'Recovery', test: 'Test', build: 'Build', peak: 'Peak', taper: 'Taper', race: 'Race' };
const SHORT = { swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Lift', mobility: 'Mob', rest: 'Rest', race: 'RACE', other: 'Walk' };

export function legend() {
  return `<div class="legend">
    <span><i style="background:var(--phase-recovery)"></i>Recovery / test week</span><span><i style="background:var(--phase-base)"></i>Build week</span><span><i style="background:var(--phase-peak)"></i>Peak</span><span><i style="background:var(--phase-taper)"></i>Taper</span><span><i style="background:var(--phase-race)"></i>Race week</span>
    <span>${statusDot('completed')} Completed</span><span>${statusDot('modified')} Modified</span><span>${statusDot('replaced')} Replaced</span><span>${statusDot('skipped')} Skipped</span><span>${statusDot('')} Not logged</span>
  </div>`;
}

export function calendarView(ctx, [mode = 'month', anchor]) {
  const base = clampToPlan(ctx, anchor && isISODate(anchor) ? anchor : ctx.today);
  return mode === 'week' ? weekView(ctx, base) : monthView(ctx, base);
}

function header(ctx, mode, base, prev, next, title) {
  return `<div class="page-head"><div><div class="eyebrow">Training calendar · Oct 5, 2026 → Mar 14, 2027</div><h1>${esc(title)}</h1></div>
    <div class="row no-print"><div class="seg"><a href="#/calendar/month/${base}" class="${mode === 'month' ? 'on' : ''}">Month</a><a href="#/calendar/week/${base}" class="${mode === 'week' ? 'on' : ''}">Week</a><a href="#/day/${base}">Day</a></div>
    <div class="seg"><a href="#/calendar/${mode}/${prev}" aria-label="Previous">←</a><a href="#/calendar/${mode}/${clampToPlan(ctx, ctx.today)}">Today</a><a href="#/calendar/${mode}/${next}" aria-label="Next">→</a></div></div></div>`;
}

function monthView(ctx, base) {
  const d = parseISO(base);
  const first = toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const last = toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  const start = mondayOf(first);
  const prev = toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)));
  const next = toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15)));
  let cells = `<div></div>${[1, 2, 3, 4, 5, 6, 0].map((i) => `<div class="dow">${DOW_SHORT[i]}</div>`).join('')}`;
  for (let wkStart = start; wkStart <= last; wkStart = addDays(wkStart, 7)) {
    const w = ctx.plan.weeks.find((x) => x.start === wkStart);
    cells += w ? `<a class="cal-wk wt-${w.type}" href="#/calendar/week/${wkStart}" title="Week ${w.n}: ${esc(w.title)}">W${w.n} · ${WT_LABEL[w.type]}</a>` : '<div></div>';
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(wkStart, i);
      const inMonth = date >= first && date <= last;
      const day = ctx.plan.byDate[date];
      if (!day) { cells += `<div class="cal-cell out"><span class="d">${parseISO(date).getUTCDate()}</span></div>`; continue; }
      const ss = sessionsOn(ctx, date).filter((s) => s.sport !== 'mobility');
      cells += `<a class="cal-cell ${inMonth ? '' : 'out'} ${date === ctx.today ? 'today' : ''} ${date < ctx.today ? 'past' : ''}" href="#/day/${date}" aria-label="${esc(formatShort(date))}: ${esc(ss.map((s) => s.title).join('; '))}">
        <span class="d"><span>${parseISO(date).getUTCDate()}</span></span>
        ${ss.map((s) => `<span class="cal-chip ${s.sport}">${statusDot(ctx.state.logs[s.id]?.status)}${esc(SHORT[s.sport] || s.sport)}${s.durationMin ? ` ${s.durationMin}'` : ''}${s.priority?.startsWith('Key') && s.sport !== 'rest' ? ' ★' : ''}</span>`).join('')}
      </a>`;
    }
  }
  return `${header(ctx, 'month', base, prev, next, monthLabel(base))}${legend()}<div class="card" style="margin-top:12px;padding:10px"><div class="cal-month">${cells}</div></div><p class="small muted" style="margin-top:8px">★ = key session. Tap a week label for the week view; tap a day for full workouts.</p>`;
}

function weekView(ctx, base) {
  const start = mondayOf(base);
  const w = ctx.plan.weeks.find((x) => x.start === start) || ctx.plan.weeks[0];
  const agg = aggregate(w.days, ctx.state.logs);
  const days = w.days.map((d) => `<div class="week-day ${d.date === ctx.today ? 'today' : ''}"><div class="row between"><a class="wd" href="#/day/${d.date}">${esc(formatShort(d.date))}</a></div>${sessionsOn(ctx, d.date).map((s) => sessionCard(s, ctx)).join('')}<div class="small muted">📖 ${esc(d.bible.ref)}</div></div>`).join('');
  const dl = w.deload;
  return `${header(ctx, 'week', w.start, addDays(w.start, -7), addDays(w.start, 7), `Week ${w.n} — ${w.title}`)}
  <div class="grid g3">
    <div class="card span2" style="border-left:4px solid var(--wt)"><div class="row"><span class="phase-pill ${PHASES[w.phase].color}">${esc(PHASES[w.phase].name)}</span><span class="chip wt-${w.type}">${WT_LABEL[w.type]} week</span></div><p style="margin-top:10px">${esc(w.focus)}</p><p class="small muted">${esc(PHASES[w.phase].summary)}</p>${w.testNote ? `<p class="small">${esc(w.testNote)}</p>` : ''}</div>
    <div class="card"><h3>Planned vs completed</h3><dl class="kv small"><dt>Total</dt><dd>${formatMinutes(agg.actual.total)} / ${formatMinutes(agg.planned.total)}</dd><dt>Swim</dt><dd>${formatMinutes(agg.actual.swim)} / ${formatMinutes(agg.planned.swim)} (${w.totals.swimDist.toLocaleString()} ${esc(ctx.bm.poolUnit || 'yd')})</dd><dt>Bike</dt><dd>${formatMinutes(agg.actual.bike)} / ${formatMinutes(agg.planned.bike)}</dd><dt>Run</dt><dd>${formatMinutes(agg.actual.run)} / ${formatMinutes(agg.planned.run)}</dd><dt>Strength</dt><dd>${formatMinutes(agg.actual.strength)} / ${formatMinutes(agg.planned.strength)}</dd><dt>Key sessions</dt><dd>${agg.actual.key}/${agg.planned.key}</dd></dl><a class="small" href="#/reviews/${w.n}">Weekly review →</a></div>
    ${dl ? `<div class="card span-all" style="border-left:4px solid var(--wt)"><h3>${w.type === 'taper' || w.type === 'race' ? 'Taper structure' : 'Deload structure'}</h3><div class="mods"><div><b>Volume change</b>${esc(dl.volume)}</div><div><b>Intensity kept</b>${esc(dl.keeps)}</div><div><b>Shortened / removed</b>${esc(dl.removed)}</div><div><b>Lifting</b>${esc(dl.lifting)}</div><div><b>Schedule</b>${esc(dl.structure)}</div><div><b>Recovery markers</b>${esc(dl.markers)}</div></div></div>` : ''}
  </div>
  <div class="week-strip" style="margin-top:16px">${days}</div>`;
}
