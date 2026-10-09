import { esc, toast, num } from './h.js';
import { sessionCard } from './session.js';
import { formatLong, addDays, isISODate } from '../lib/dates.js';
import { formatMinutes } from '../lib/units.js';
import { update } from '../store/store.js';
import { PHASES } from '../plan/weeks.js';
import { dayCarbClass, dailyTargets } from '../lib/nutrition.js';
import { RACE } from '../data/race.js';

const SYMPTOMS = ['sore throat', 'congestion', 'fever', 'chest pain', 'dizziness', 'fainting', 'palpitations', 'shortness of breath at rest', 'unusual swelling'];

export function clampToPlan(ctx, iso) {
  const first = ctx.plan.days[0].date;
  const last = ctx.plan.days[ctx.plan.days.length - 1].date;
  if (iso < first) return first;
  if (iso > last) return last;
  return iso;
}

export function sessionsOn(ctx, date) {
  const day = ctx.plan.byDate[date];
  const own = day ? day.sessions.filter((s) => !ctx.state.reschedules[s.id]) : [];
  const moved = Object.entries(ctx.state.reschedules).filter(([, d]) => d === date).map(([id]) => ctx.plan.sessions[id]).filter(Boolean);
  return [...own, ...moved];
}

export function faithCard(b, { compact = false } = {}) {
  return `<div class="card faith"><div class="theme">Today's passage · ${esc(b.theme)}</div><div class="ref">${esc(b.ref)}</div><blockquote>${esc(b.summary)}</blockquote>${compact ? '' : `<p>${esc(b.reflection)}</p>`}<p class="q">${esc(b.question)}</p>${compact ? '' : '<p class="small muted" style="margin-top:8px">Summary is a paraphrase — read the full passage in your translation.</p>'}</div>`;
}

export function dayView(ctx, [dateParam], rerender) {
  const date = clampToPlan(ctx, dateParam && isISODate(dateParam) ? dateParam : ctx.today);
  const day = ctx.plan.byDate[date];
  const week = ctx.plan.weeks[day.week];
  const sessions = sessionsOn(ctx, date);
  const d = ctx.state.daily[date] || {};
  const tgt = dailyTargets(ctx.bm.weightKg, dayCarbClass({ sessions }));
  const totalMin = sessions.reduce((a, s) => a + (s.sport === 'rest' ? 0 : s.durationMin || 0), 0);
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const isToday = date === ctx.today;

  const html = `
  <div class="page-head">
    <div><div class="eyebrow">${isToday ? 'Today' : 'Day view'} · Week ${day.week} — ${esc(week.title)}</div><h1>${esc(formatLong(date))}</h1>
      <div class="row"><span class="phase-pill ${PHASES[day.phase].color}">${esc(day.phaseName)}</span><span class="chip">${esc(week.type === 'recovery' ? 'Recovery week' : week.type === 'test' ? 'Test week' : week.type[0].toUpperCase() + week.type.slice(1) + ' week')}</span>${totalMin ? `<span class="chip">${esc(formatMinutes(totalMin))} planned</span>` : ''}</div></div>
    <div class="seg no-print"><a href="#/day/${prev}">← Prev</a><a href="#/day/${ctx.today}" class="${isToday ? 'on' : ''}">Today</a><a href="#/day/${next}">Next →</a></div>
  </div>
  ${ctx.today < ctx.plan.days[0].date || ctx.today > RACE.date ? '<p class="disclaimer">Today is outside the plan window; showing the nearest plan day.</p>' : ''}
  <div class="grid g3">
    <div class="span2 stack">
      <div class="card"><div class="card-head"><h2>Primary objective</h2></div><p>${esc(day.objective)}</p><div class="stack">${sessions.map((s) => sessionCard(s, ctx)).join('')}</div></div>
      ${ctx.coaching.filter((c) => ['stop', 'warning'].includes(c.level)).map((c) => `<div class="alert ${c.level}"><div class="h">${c.level === 'stop' ? '⛔' : '⚠️'} ${esc(c.title)}</div><div>${esc(c.observation)}</div><div>${esc(c.suggestion)}</div></div>`).join('')}
      <div class="card" id="checkin"><h2>Daily check-in</h2>
        <form id="dailyform" novalidate>
          <div class="fields">
            ${field('sleepH', 'Sleep (hours)', d.sleepH, 0, 14, '0.25')}
            ${field('sleepQ', 'Sleep quality (1–10)', d.sleepQ, 1, 10)}
            ${field('fatigue', 'Fatigue (1–10)', d.fatigue, 1, 10, '1', '10 = exhausted')}
            ${field('soreness', 'Soreness (1–10)', d.soreness, 1, 10)}
            ${field('motivation', 'Motivation (1–10)', d.motivation, 1, 10)}
            ${field('hunger', 'Hunger (1–10)', d.hunger, 1, 10)}
            ${field('pain', 'Pain (0–10)', d.pain, 0, 10)}
            <label class="f">Pain location<input name="painLocation" type="text" value="${esc(d.painLocation || '')}" placeholder="e.g., left Achilles"></label>
            ${field('weightLb', 'Body weight (lb)', d.weightLb, 90, 400, '0.1', 'morning, after bathroom')}
          </div>
          <fieldset style="margin-top:12px"><legend>Unusual symptoms</legend><div class="checks">${SYMPTOMS.map((x) => `<label><input type="checkbox" name="symptoms" value="${x}" ${(d.symptoms || []).includes(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div></fieldset>
          <label class="f">Notes<textarea name="notes">${esc(d.notes || '')}</textarea></label>
          <div class="row" style="margin-top:10px"><button class="btn primary">Save check-in</button><span class="err" id="dailyerr"></span></div>
        </form>
      </div>
    </div>
    <div class="stack">
      ${faithCard(day.bible)}
      <div class="card flat"><h3>Today's fueling targets</h3>${tgt ? `<dl class="kv"><dt>Carbohydrate</dt><dd>${tgt.carbs[0]}–${tgt.carbs[1]} g <span class="muted small">(${esc(tgt.carbClass)} day)</span></dd><dt>Protein</dt><dd>${tgt.protein[0]}–${tgt.protein[1]} g</dd><dt>Per meal</dt><dd>${tgt.proteinPerMeal[0]}–${tgt.proteinPerMeal[1]} g protein × 4–5</dd></dl><p class="small muted" style="margin-top:8px">Ranges from sports-nutrition position stands, scaled to today's planned load. See <a href="#/fuel">Fuel</a>.</p>` : '<p class="muted small">Enter body weight on Profile to calculate.</p>'}</div>
      ${week.deload ? `<div class="card flat"><h3>${esc(week.type === 'taper' || week.type === 'race' ? 'Taper' : 'Deload')} this week</h3><dl class="kv small"><dt>Volume</dt><dd>${esc(week.deload.volume)}</dd><dt>Kept</dt><dd>${esc(week.deload.keeps)}</dd><dt>Removed</dt><dd>${esc(week.deload.removed)}</dd><dt>Lifting</dt><dd>${esc(week.deload.lifting)}</dd><dt>Monitor</dt><dd>${esc(week.deload.markers)}</dd></dl></div>` : ''}
    </div>
  </div>`;
  return {
    html,
    mount(root) {
      const form = root.querySelector('#dailyform');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const rec = {};
        let bad = '';
        for (const [k, lo, hi] of [['sleepH', 0, 14], ['sleepQ', 1, 10], ['fatigue', 1, 10], ['soreness', 1, 10], ['motivation', 1, 10], ['hunger', 1, 10], ['pain', 0, 10], ['weightLb', 90, 400]]) {
          const v = fd.get(k);
          if (v === '' || v == null) continue;
          const n = num(v);
          if (n == null || n < lo || n > hi) bad = `${k} must be ${lo}–${hi}`;
          else rec[k] = n;
        }
        if (bad) { root.querySelector('#dailyerr').textContent = bad; return; }
        rec.painLocation = fd.get('painLocation') || '';
        rec.symptoms = fd.getAll('symptoms');
        rec.notes = fd.get('notes') || '';
        update((st) => { st.daily[date] = rec; });
        const red = rec.symptoms.some((x) => ['chest pain', 'fainting', 'dizziness', 'palpitations', 'shortness of breath at rest'].includes(x));
        toast(red ? 'Saved. Symptoms logged — do not train; seek medical evaluation.' : 'Check-in saved.');
        rerender();
      });
    },
  };
}

function field(name, label, value, min, max, step = '1', hint = '') {
  return `<label class="f">${esc(label)}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}<input name="${name}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${esc(value ?? '')}"></label>`;
}
