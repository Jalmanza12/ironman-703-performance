import { esc, sportChip, statusDot, priorityChip, toast, num } from './h.js';
import { describeTarget } from '../lib/targets.js';
import { formatLong, formatShort } from '../lib/dates.js';
import { formatMinutes, parseDuration, formatDuration, cssPacePer100, M_PER_MILE } from '../lib/units.js';
import { compareSession } from '../lib/load.js';
import { rescheduleOptions } from '../lib/reschedule.js';
import { ftpFrom20Min } from '../lib/zones.js';
import { update, uid } from '../store/store.js';
import { PHASES } from '../plan/weeks.js';
import { effectiveSession, applyProposal, undoChange } from '../lib/adjustments.js';
import { load, save } from '../store/store.js';

export function targetHTML(t, bm) {
  const d = describeTarget(t, bm);
  if (!d) return '';
  const parts = d.lines.map((l) => `<span class="tgt ${/not yet established/.test(l) ? 'prov' : ''}">${esc(l)}</span>`);
  if (d.rpe) parts.push(`<span class="tgt rpe">${esc(d.rpe)}</span>`);
  return `<div class="step-target">${parts.join('')}</div>`;
}

function stepsHTML(label, steps, bm) {
  if (!steps?.length) return '';
  return `<div class="block-label">${esc(label)}</div><ol class="steps">${steps.map((s) => `<li><span class="step-text">${esc(s.text)}</span>${targetHTML(s.target, bm)}${s.rest ? `<span class="step-rest">Recovery: ${esc(s.rest)}</span>` : ''}${s.note ? `<span class="step-note">${esc(s.note)}</span>` : ''}</li>`).join('')}</ol>`;
}

export function sessionMeta(s, ctx) {
  const unit = ctx.bm.poolUnit || 'yd';
  const bits = [];
  if (s.durationMin) bits.push(formatMinutes(s.durationMin));
  if (s.distance) bits.push(`${s.distance.toLocaleString()} ${unit}`);
  if (s.zone) bits.push(s.zone);
  return bits.map(esc).join(' · ');
}

export function adjustmentChips(e) {
  if (!e) return '';
  const out = [];
  if (e.cancelled) out.push('<span class="chip adj">Skipped (plan change)</span>');
  if (e.moved) out.push(`<span class="chip adj">Moved from ${esc(formatShort(e.originalDate))}</span>`);
  if (e.originalDurationMin) out.push(`<span class="chip adj">Shortened from ${e.originalDurationMin} min</span>`);
  if (e.replacedFrom) out.push('<span class="chip adj">Replaced</span>');
  return out.join('');
}

export function sessionCard(s0, ctx) {
  const s = s0.originalDate ? s0 : effectiveSession(ctx.plan, ctx.state, s0.id) || s0;
  const log = ctx.state.logs[s.id];
  return `<a class="session ${esc(s.sport)} ${s.cancelled ? 'cancelled' : ''}" href="#/session/${encodeURIComponent(s.id)}">
    <div class="row between"><span class="t">${esc(s.title)}</span><span class="row" style="gap:6px">${priorityChip(s.priority)}${statusDot(log?.status)}</span></div>
    <div class="meta"><span>${sessionMeta(s, ctx)}</span>${adjustmentChips(s)}</div>
  </a>`;
}

const MOD_LABEL = { fatigue: 'If fatigued / poor sleep', weather: 'Weather', time: 'Limited time', illness: 'Pain or illness' };

export function sessionView(ctx, [id], rerender) {
  const s = effectiveSession(ctx.plan, ctx.state, id);
  if (!s) return '<div class="card"><h2>Session not found</h2><a href="#/calendar">Back to calendar</a></div>';
  const day = ctx.plan.byDate[s.originalDate];
  const bm = ctx.bm;
  const log = ctx.state.logs[s.id];
  const fb = log ? compareSession(s, log, bm) : null;
  const provisional = [...s.warmup, ...s.main, ...s.cooldown].some((st) => describeTarget(st.target, bm)?.provisional);
  const moved = s.moved ? s.date : null;
  const lastChange = [...(ctx.state.changeHistory || [])].reverse().find((h) => h.status === 'applied' && h.changes.some((c) => c.workoutId === s.id));

  const html = `
  <div class="page-head">
    <div>
      <div class="eyebrow">${esc(formatLong(s.date))} · Week ${s.week} · <a href="#/day/${s.date}">day view</a></div>
      <h1>${esc(s.title)}</h1>
      ${s.adjusted ? `<div class="alert" style="margin:8px 0"><div class="h">Adjusted by an approved plan change</div><div class="row">${adjustmentChips(s)}</div>${lastChange ? `<div class="small muted">${esc(lastChange.source === 'ai' ? 'AI Coach' : lastChange.source === 'rules' ? 'Rules-based planner' : 'Manual')} · ${esc(lastChange.summary || '')} · ${esc(lastChange.changes.find((c) => c.workoutId === s.id)?.reason || '')}</div>` : ''}${s.replacementDescription ? `<p class="small">${esc(s.replacementDescription)}</p><p class="small muted">The original workout details below are kept for reference.</p>` : ''}</div>` : ''}
      <div class="row">${sportChip(s.sport)}${priorityChip(s.priority)}<span class="phase-pill ${PHASES[s.phase].color}">${esc(PHASES[s.phase].name)}</span><span class="chip">${esc(s.type)}</span>${moved ? `<span class="chip warn">Rescheduled to ${esc(formatShort(moved))}</span>` : ''}</div>
    </div>
  </div>
  <div class="grid g3">
    <div class="card span2">
      <div class="grid g4 stats" style="margin-bottom:12px">
        <div class="stat"><span class="l">Duration</span><span class="v sm">${s.durationMin ? esc(formatMinutes(s.durationMin)) : '—'}</span></div>
        <div class="stat"><span class="l">Distance</span><span class="v sm">${s.distance ? `${s.distance.toLocaleString()} ${esc(bm.poolUnit || 'yd')}` : '—'}</span></div>
        <div class="stat"><span class="l">Intensity</span><span class="v sm">${esc(s.zone || '—')}</span></div>
        <div class="stat"><span class="l">Planned RPE</span><span class="v sm">${s.plannedRPE ?? '—'}</span></div>
      </div>
      <p><strong>Objective:</strong> ${esc(s.objective)}</p>
      <p class="text-2"><strong>Why this session exists:</strong> ${esc(s.purpose)}</p>
      ${provisional ? '<p class="disclaimer">Some targets are <b>provisional</b> because a benchmark is not yet established. Use the RPE and heart-rate guidance; enter test results on the <a href="#/profile">Profile</a> page and these targets update automatically.</p>' : ''}
      ${stepsHTML('Warm-up', s.warmup, bm)}
      ${stepsHTML('Main set', s.main, bm)}
      ${stepsHTML('Cool-down', s.cooldown, bm)}
      ${s.exercises ? `<div class="block-label">Load guidance</div><p>${esc(s.loadGuidance)}</p>` : ''}
    </div>
    <div class="stack">
      <div class="card flat"><h3>Execution</h3>
        <div class="block-label">Technical cues</div><ul class="clean">${s.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        <div class="block-label">Success looks like</div><ul class="clean">${s.success.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        <div class="block-label">Terrain</div><p class="small">${esc(s.terrain)}</p>
        <div class="block-label">Equipment</div><p class="small">${esc(s.equipment)}</p>
      </div>
      ${s.fueling?.length ? `<div class="card flat"><h3>Fueling & hydration</h3><ul class="clean small">${s.fueling.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div class="card span-all"><h3>Modifications</h3><div class="mods">${Object.entries(s.modifications).filter(([, v]) => v && v !== '—').map(([k, v]) => `<div><b>${esc(MOD_LABEL[k] || k)}</b>${esc(v)}</div>`).join('')}</div></div>
    ${s.test ? testForm(s, ctx) : ''}
    <div class="card span2" id="log">${logForm(s, log, ctx)}</div>
    <div class="stack">
      ${fb ? feedbackCard(fb) : '<div class="card flat"><h3>Feedback</h3><p class="muted small">Log this session to compare it against its targets.</p></div>'}
      ${rescheduleCard(s, ctx)}
    </div>
    ${day ? `<div class="card faith span-all"><div class="theme">${esc(day.bible.theme)} · ${esc(day.bible.testament === 'OT' ? 'Old Testament' : 'New Testament')}</div><div class="ref">${esc(day.bible.ref)}</div><blockquote>${esc(day.bible.summary)}</blockquote><p>${esc(day.bible.reflection)}</p><p class="q">${esc(day.bible.question)}</p></div>` : ''}
  </div>`;

  return {
    html,
    mount(root) {
      const form = root.querySelector('#logform');
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const errors = validateLog(data, s);
        root.querySelectorAll('.err[data-for]').forEach((x) => { x.textContent = errors[x.dataset.for] || ''; });
        root.querySelectorAll('#logform input').forEach((x) => x.setAttribute('aria-invalid', errors[x.name] ? 'true' : 'false'));
        if (Object.keys(errors).length) return toast('Please fix the highlighted fields.');
        const actual = {
          durationMin: num(data.durationMin), distance: num(data.distance), distanceUnit: data.distanceUnit,
          avgPace: data.avgPace || '', paceSecPerMile: paceToSecPerMile(data.avgPace, data.paceUnit), paceUnit: data.paceUnit,
          avgHr: num(data.avgHr), avgPower: num(data.avgPower), np: num(data.np), cadence: num(data.cadence),
          intervalsCompleted: data.intervalsCompleted === '' ? '' : num(data.intervalsCompleted), rpe: num(data.rpe),
          carbsG: data.carbsG === '' ? '' : num(data.carbsG), fluidMl: num(data.fluidMl), sodiumMg: num(data.sodiumMg),
          pain: num(data.pain), notes: data.notes || '', replacement: data.replacement || '',
        };
        update((st) => {
          st.logs[s.id] = { status: data.status, actual, updatedAt: new Date().toISOString() };
          if (s.sport === 'strength') {
            st.strength = st.strength.filter((x) => x.sessionId !== s.id);
            (s.exercises || []).forEach((ex, i) => {
              const load = num(data[`ex${i}load`]);
              const reps = num(data[`ex${i}reps`]);
              if (load > 0 && reps > 0) st.strength.push({ id: uid(), date: s.date, sessionId: s.id, exercise: ex.name, load, reps, rir: num(data[`ex${i}rir`]) ?? 2 });
            });
          }
        });
        toast('Session saved.');
        rerender();
        setTimeout(() => document.getElementById('feedback')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      });
      root.querySelector('#clearlog')?.addEventListener('click', () => {
        if (!confirm('Delete this session log?')) return;
        update((st) => { delete st.logs[s.id]; st.strength = st.strength.filter((x) => x.sessionId !== s.id); });
        rerender();
      });
      // Manual moves use the same validated, history-tracked path as the AI Coach.
      root.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
        const to = b.dataset.move;
        const st = load();
        if (!to) {
          const entry = [...(st.changeHistory || [])].reverse().find((h) => h.status === 'applied' && h.changes.some((c) => c.workoutId === s.id));
          const r = entry ? undoChange(st, entry.id, { today: ctx.today }) : { ok: false, reason: 'No change to undo.' };
          if (!r.ok) return toast(`Can't undo: ${r.reason}`);
          save(r.state);
          toast('Change undone.');
          return rerender();
        }
        const res = applyProposal(ctx.plan, st, { summary: `Moved ${s.title} to ${formatShort(to)}`, changes: [{ action: 'move', workoutId: s.id, newDate: to, reason: 'Manual reschedule' }] }, { today: ctx.today, source: 'manual' });
        if (!res.ok) return toast(res.validation.errors[0] || 'That move is not allowed.');
        save(res.state);
        toast(`Moved to ${formatShort(to)}.`);
        rerender();
      }));
      const tf = root.querySelector('#testform');
      tf?.addEventListener('submit', (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(tf));
        const res = saveTest(s, d);
        const out = root.querySelector('#testresult');
        if (res.error) { out.textContent = res.error; out.className = 'err'; return; }
        toast(res.message);
        rerender();
      });
    },
  };
}

function paceToSecPerMile(str, unit) {
  const sec = parseDuration(str || '');
  if (!Number.isFinite(sec) || sec <= 0) return undefined;
  if (unit === 'km') return sec * (M_PER_MILE / 1000);
  if (unit === 'mi') return sec;
  return undefined; // swim/bike paces are not converted
}

function validateLog(d, s) {
  const e = {};
  const range = (k, lo, hi, msg) => { if (d[k] !== '' && d[k] != null && !(Number(d[k]) >= lo && Number(d[k]) <= hi)) e[k] = msg; };
  if (!['completed', 'modified', 'skipped', 'replaced'].includes(d.status)) e.status = 'Choose a status.';
  range('durationMin', 0, 900, '0–900 min');
  range('distance', 0, 300000, 'Check distance');
  range('avgHr', 40, 220, '40–220 bpm');
  range('avgPower', 0, 1500, '0–1500 W');
  range('np', 0, 1500, '0–1500 W');
  range('cadence', 0, 220, '0–220');
  range('rpe', 0, 10, '0–10');
  range('pain', 0, 10, '0–10');
  range('carbsG', 0, 1000, '0–1000 g');
  range('fluidMl', 0, 15000, 'Check fluid');
  range('sodiumMg', 0, 15000, 'Check sodium');
  range('intervalsCompleted', 0, 100, '0–100');
  if (d.avgPace && !Number.isFinite(parseDuration(d.avgPace))) e.avgPace = 'Use m:ss';
  if (d.np && d.avgPower && Number(d.np) < Number(d.avgPower) * 0.97) e.np = 'NP is normally ≥ average power';
  if (d.status === 'replaced' && !d.replacement) e.replacement = 'Describe what you did instead';
  return e;
}

function f(name, label, value = '', { type = 'number', hint = '', step = 'any', attrs = '' } = {}) {
  return `<label class="f">${esc(label)}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}<input name="${name}" type="${type}" ${type === 'number' ? `step="${step}" inputmode="decimal"` : ''} value="${esc(value ?? '')}" ${attrs}><span class="err" data-for="${name}"></span></label>`;
}

function logForm(s, log, ctx) {
  if (s.sport === 'rest') return '<h2>Rest day</h2><p class="muted">Nothing to log here — fill in the daily check-in on the <a href="#/day/' + s.date + '">day view</a>.</p>';
  const a = log?.actual || {};
  const st = log?.status || 'completed';
  const reps = (s.main || []).reduce((n, x) => n + (Number(/^(\d+)\s*×/.exec(x.text || '')?.[1]) || 0), 0);
  const isBike = s.sport === 'bike';
  const isRun = s.sport === 'run';
  const isSwim = s.sport === 'swim';
  const strengthRows = s.sport === 'strength' ? `<fieldset><legend>Strength sets (main working set per exercise)</legend><div class="table-wrap"><table class="ex"><thead><tr><th>Exercise</th><th>Prescribed</th><th>Load (lb)</th><th>Reps</th><th>RIR</th></tr></thead><tbody>${(s.exercises || []).map((ex, i) => {
    const prev = ctx.state.strength.find((x) => x.sessionId === s.id && x.exercise === ex.name) || {};
    return `<tr><td>${esc(ex.name)}</td><td class="small muted">${ex.sets} × ${esc(ex.reps)} @ RIR ${esc(ex.rir)}, rest ${esc(ex.rest)}</td><td><input name="ex${i}load" type="number" inputmode="decimal" step="any" min="0" value="${esc(prev.load ?? '')}" aria-label="${esc(ex.name)} load"></td><td><input name="ex${i}reps" type="number" inputmode="numeric" min="0" value="${esc(prev.reps ?? '')}" aria-label="${esc(ex.name)} reps"></td><td><input name="ex${i}rir" type="number" inputmode="numeric" min="0" max="6" value="${esc(prev.rir ?? '')}" aria-label="${esc(ex.name)} RIR"></td></tr>`;
  }).join('')}</tbody></table></div></fieldset>` : '';
  return `<h2>Log this session</h2>
  <form id="logform" novalidate>
    <fieldset><legend>Status</legend><div class="seg" role="radiogroup">${['completed', 'modified', 'replaced', 'skipped'].map((v) => `<label class="checks" style="padding:4px 8px"><input type="radio" name="status" value="${v}" ${st === v ? 'checked' : ''}> ${v[0].toUpperCase() + v.slice(1)}</label>`).join('')}</div>
      <label class="f" style="margin-top:8px">If replaced, what did you do instead?<input name="replacement" type="text" value="${esc(a.replacement || '')}"><span class="err" data-for="replacement"></span></label></fieldset>
    <fieldset><legend>Actual performance</legend><div class="fields">
      ${f('durationMin', 'Duration (min)', a.durationMin, { hint: `plan ${s.durationMin || '—'}` })}
      ${!['strength', 'mobility', 'other'].includes(s.sport) ? f('distance', 'Distance', a.distance) + `<label class="f">Distance unit<select name="distanceUnit">${['mi', 'km', 'yd', 'm'].map((u) => `<option ${((a.distanceUnit || (isSwim ? ctx.bm.poolUnit || 'yd' : 'mi')) === u) ? 'selected' : ''}>${u}</option>`).join('')}</select></label>` : ''}
      ${isRun || isSwim ? f('avgPace', isSwim ? 'Avg pace (m:ss /100)' : 'Avg pace (m:ss)', a.avgPace, { type: 'text', attrs: 'placeholder="8:30" inputmode="numeric"' }) + (isRun ? `<label class="f">Pace unit<select name="paceUnit"><option value="mi" ${a.paceUnit !== 'km' ? 'selected' : ''}>per mile</option><option value="km" ${a.paceUnit === 'km' ? 'selected' : ''}>per km</option></select></label>` : '<input type="hidden" name="paceUnit" value="100">') : ''}
      ${['bike', 'run', 'swim'].includes(s.sport) ? f('avgHr', 'Avg HR (bpm)', a.avgHr) : ''}
      ${isBike ? f('avgPower', 'Avg power (W)', a.avgPower) + f('np', 'Normalized power (W)', a.np) : ''}
      ${isBike || isRun ? f('cadence', isBike ? 'Cadence (rpm)' : 'Cadence (spm)', a.cadence) : ''}
      ${reps ? f('intervalsCompleted', 'Intervals completed', a.intervalsCompleted, { hint: `of ${reps}` }) : ''}
      ${f('rpe', 'Session RPE (0–10)', a.rpe, { hint: `plan ~${s.plannedRPE ?? '—'}` })}
      ${f('pain', 'Pain (0–10)', a.pain, { hint: '0 = none' })}
    </div></fieldset>
    ${s.durationMin >= 60 && ['bike', 'run'].includes(s.sport) ? `<fieldset><legend>Fueling & hydration</legend><div class="fields">${f('carbsG', 'Carbohydrate (g total)', a.carbsG)}${f('fluidMl', 'Fluid (mL)', a.fluidMl)}${f('sodiumMg', 'Sodium (mg)', a.sodiumMg)}</div></fieldset>` : ''}
    ${strengthRows}
    <label class="f">Notes (how it felt, conditions, anything unusual)<textarea name="notes">${esc(a.notes || '')}</textarea></label>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Save log</button>${log ? '<button class="btn danger" type="button" id="clearlog">Delete log</button>' : ''}</div>
  </form>`;
}

function feedbackCard(fb) {
  const list = (t, arr, cls) => (arr.length ? `<div class="block-label">${t}</div><ul class="clean small">${arr.map((x) => `<li class="${cls}">${esc(x)}</li>`).join('')}</ul>` : '');
  return `<div class="card flat" id="feedback"><h3>Planned vs. actual</h3>${list('What went well', fb.wentWell, '')}${list('What fell short', fb.fellShort, '')}${list('What to change', fb.change, '')}<p class="disclaimer" style="margin-top:10px">Automated comparison against the plan — not medical or professional coaching judgment.</p></div>`;
}

function rescheduleCard(s, ctx) {
  if (s.sport === 'rest' || s.sport === 'race') return '';
  const moved = s.moved ? s.date : null;
  const r = rescheduleOptions(ctx.plan, s.id, { today: ctx.today, reschedules: ctx.state.reschedules });
  return `<div class="card flat"><h3>Reschedule</h3>
    ${moved ? `<p>Currently moved to <b>${esc(formatLong(moved))}</b>. <button class="btn sm" data-move="">Undo last change</button></p>` : ''}${s.adjusted && !moved ? '<p class="small"><button class="btn sm" data-move="">Undo last change</button></p>' : ''}
    <p class="small text-2">${esc(r.reason)}</p>
    ${r.options.length ? `<div class="stack">${r.options.map((o) => `<div><button class="btn sm" data-move="${o.date}">Move to ${esc(formatShort(o.date))}</button><div class="small muted">${esc(o.note)}</div></div>`).join('')}</div>` : ''}
    ${r.rejected?.length ? `<details class="small" style="margin-top:8px"><summary class="muted">Why not other days?</summary><ul class="clean">${r.rejected.map((x) => `<li>${esc(formatShort(x.date))}: ${esc(x.why.join('; '))}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

// ---------- Benchmark test entry ----------
function testForm(s, ctx) {
  const unit = ctx.bm.poolUnit || 'yd';
  const body = {
    ftp: `<p class="small text-2">Enter your 20-minute test result. FTP = 95% of 20-min average power. The 20-min average HR is saved as an approximate bike LTHR (Friel).</p><div class="fields">${f('p20', '20-min average power (W)', '')}${f('hr20', '20-min average HR (bpm)', '', { hint: 'optional' })}</div>`,
    css: `<p class="small text-2">Enter both time-trial times. CSS = (T400 − T200) ÷ 2 per 100 ${unit}. Pool unit: <b>${esc(unit)}</b> (change on Profile).</p><div class="fields">${f('t400', '400 time (m:ss)', '', { type: 'text', attrs: 'placeholder="7:20"' })}${f('t200', '200 time (m:ss)', '', { type: 'text', attrs: 'placeholder="3:30"' })}</div>`,
    run: `<p class="small text-2">Enter the distance covered in 30 minutes and the average HR of the final 20 minutes (Friel). Threshold pace = 30-min average pace.</p><div class="fields">${f('dist30', 'Distance in 30 min', '')}<label class="f">Unit<select name="u30"><option value="mi">miles</option><option value="km">km</option></select></label>${f('hr20', 'Avg HR, final 20 min', '', { hint: 'optional' })}</div>`,
  }[s.test];
  return `<div class="card span-all"><h2>Enter benchmark result</h2><form id="testform" novalidate>${body}<div class="row" style="margin-top:10px"><button class="btn primary">Save benchmark</button><span id="testresult"></span></div></form></div>`;
}

function saveTest(s, d) {
  const add = (st, type, value, method) => st.benchmarks.push({ id: uid(), type, value, date: s.date, method, createdAt: new Date().toISOString() });
  if (s.test === 'ftp') {
    const p = Number(d.p20);
    const ftp = ftpFrom20Min(p);
    if (!ftp) return { error: 'Enter a realistic 20-min average power (80–700 W).' };
    const hr = Number(d.hr20);
    update((st) => {
      add(st, 'ftp', ftp, `20-min test: ${p} W × 0.95`);
      if (hr >= 100 && hr <= 215) add(st, 'lthrBike', Math.round(hr), '20-min test average HR');
    });
    return { message: `FTP set to ${ftp} W. Bike targets updated.` };
  }
  if (s.test === 'css') {
    const t4 = parseDuration(d.t400);
    const t2 = parseDuration(d.t200);
    const css = cssPacePer100(t4, t2);
    if (!Number.isFinite(css) || css < 55 || css > 240) return { error: 'Check the times: the 400 must be slower than the 200 and CSS between 0:55 and 4:00 per 100.' };
    update((st) => add(st, 'css', Math.round(css * 10) / 10, `CSS test: 400 ${d.t400}, 200 ${d.t200}`));
    return { message: `CSS set to ${formatDuration(css)} /100. Swim targets updated.` };
  }
  if (s.test === 'run') {
    const dist = Number(d.dist30);
    const miles = d.u30 === 'km' ? (dist * 1000) / M_PER_MILE : dist;
    if (!(miles > 2 && miles < 7.5)) return { error: 'Distance in 30 min should be roughly 2–7.5 miles.' };
    const pace = 1800 / miles;
    const hr = Number(d.hr20);
    update((st) => {
      add(st, 'thresholdPace', Math.round(pace), `30-min TT: ${dist} ${d.u30}`);
      if (hr >= 100 && hr <= 215) add(st, 'lthrRun', Math.round(hr), '30-min TT, final 20-min avg HR');
    });
    return { message: `Threshold pace set to ${formatDuration(pace)}/mi. Run targets updated.` };
  }
  return { error: 'Unknown test.' };
}
