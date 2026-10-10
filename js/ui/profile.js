import { esc, toast, download, NE } from './h.js';
import { update, uid, exportJSON, importJSON, logsCSV, dailyCSV, benchmarksCSV, strengthCSV, resetAll, isPersistent } from '../store/store.js';
import { BENCHMARK_TYPES } from '../lib/benchmarks.js';
import { parseDuration, formatDuration } from '../lib/units.js';
import { powerZones, hrZones, runPaceZones, swimZones, maf180 } from '../lib/zones.js';
import { isISODate, formatShort } from '../lib/dates.js';
import { benchmarkTrend } from '../lib/benchmarks.js';
import { DAYS } from '../lib/adjustments.js';

const DAY_LABEL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

// Questionnaire definition: [key, label, type, options/hint]
const SECTIONS = [
  ['About you', [
    ['age', 'Age', 'number'], ['weightLb', 'Body weight (lb)', 'number', 'Currently 183 lb per your profile'], ['heightIn', 'Height (in)', 'number', '72 = 6\'0"'],
    ['bodyComp', 'Body-composition priority', 'select', ['Maintain weight, improve performance', 'Modest, slow reduction (base phase only)', 'Gain/maintain strength-muscle', 'Undecided — advise me']],
  ]],
  ['Equipment', [
    ['powerMeter', 'Power meter on race bike?', 'select', ['yes', 'no', 'smart trainer only']], ['hrm', 'Chest-strap HR monitor?', 'select', ['yes', 'no (wrist only)']],
    ['gps', 'GPS watch?', 'select', ['yes', 'no']], ['trainer', 'Smart trainer?', 'select', ['yes', 'no']],
    ['bikeType', 'Race bike setup', 'select', [['roadClipons', 'Road bike + clip-on aero bars'], ['tri', 'Tri/TT bike'], ['road', 'Road bike, no aero bars']]],
    ['wetsuit', 'Own a triathlon wetsuit?', 'select', ['yes', 'no']], ['poolUnit', 'Pool unit', 'select', [['yd', 'Yards'], ['m', 'Meters']]],
  ]],
  ['Swim', [
    ['swimPace', 'Typical steady pace per 100 (m:ss)', 'text', 'Self-estimate; the CSS test replaces it'], ['swimVolume', 'Recent weekly swim volume', 'text', 'e.g., 2 × 1,500 yd'],
    ['swimLongest', 'Longest continuous swim recently', 'text'], ['owComfort', 'Open-water comfort (1–10)', 'number'], ['swimHistory', 'Swim background', 'text', 'Lessons? Comfortable breathing bilaterally?'],
  ]],
  ['Bike', [
    ['bikeHours', 'Recent weekly bike hours', 'number'], ['bikeLongest', 'Longest recent ride (h)', 'number'], ['ftpKnown', 'Known FTP & how measured', 'text', 'Enter the validated number in Benchmarks below'],
  ]],
  ['Run', [
    ['runMiles', 'Recent weekly run miles', 'number'], ['runLongest', 'Longest recent run (min)', 'number'], ['runRecent', 'Recent run races (distance, time, date)', 'text', 'Enter results as benchmarks below too'],
  ]],
  ['Waco 70.3 (Oct 4, 2026) — swim canceled', [
    ['wacoBike', 'Bike split (h:mm:ss)', 'text'], ['wacoT2', 'T2 (m:ss)', 'text'], ['wacoRun', 'Run split (h:mm:ss)', 'text'],
    ['wacoBikeAvgW', 'Bike avg power (W)', 'number'], ['wacoBikeNP', 'Bike NP (W)', 'number'], ['wacoRunHr', 'Run avg HR', 'number'],
    ['wacoWeather', 'Conditions (heat, wind)', 'text'], ['wacoMistakes', 'What went wrong (in your words)', 'textarea'],
  ]],
  ['Time & life', [
    ['weeklyHours', 'Current weekly training hours', 'number'], ['weekdayMin', 'Realistic weekday time per day (min)', 'number', 'Plan assumes ~60–110 min incl. strength'],
    ['weekendHours', 'Weekend time available (h per day)', 'number'], ['amPm', 'Preferred training time', 'select', ['Morning', 'Midday', 'Evening', 'Varies']],
    ['busyWeeks', 'Known busy weeks (exams, travel)', 'textarea'],
  ]],
  ['Strength', [
    ['liftYears', 'Lifting experience (years)', 'number'], ['liftRoutine', 'Current routine', 'textarea'], ['liftBench', 'Recent best lifts (e.g., trap bar 315×5)', 'text'],
  ]],
  ['Health & recovery', [
    ['injuries', 'Injury history', 'textarea'], ['currentPain', 'Current pain or niggles', 'text'], ['sleepAvg', 'Average sleep (h)', 'number'], ['sleepQuality', 'Sleep quality (1–10)', 'number'],
  ]],
  ['Nutrition', [
    ['diet', 'Current eating pattern', 'textarea'], ['fuelGph', 'Carbohydrate you currently take per hour on long sessions (g)', 'number'], ['giIssues', 'GI issues in training/races', 'text'], ['caffeine', 'Caffeine use', 'text'],
  ]],
  ['Race logistics', [
    ['t1Est', 'Expected T1 (m:ss)', 'text', 'Leave blank to use a labeled default'], ['t2Est', 'Expected T2 (m:ss)', 'text'],
  ]],
];

function input([key, label, type, opt], v) {
  const hint = typeof opt === 'string' ? `<span class="hint">${esc(opt)}</span>` : '';
  if (type === 'select') return `<label class="f">${esc(label)}<select name="${key}"><option value="">—</option>${opt.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${v === val ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select></label>`;
  if (type === 'textarea') return `<label class="f" style="grid-column:1/-1">${esc(label)} ${hint}<textarea name="${key}">${esc(v || '')}</textarea></label>`;
  return `<label class="f">${esc(label)} ${hint}<input name="${key}" type="${type}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(v ?? '')}"></label>`;
}

const BM_INPUT = {
  ftp: { hint: 'watts (validated: 20-min test × 0.95)', parse: Number },
  css: { hint: 'm:ss per 100 (pool unit)', parse: parseDuration },
  thresholdPace: { hint: 'm:ss per mile', parse: parseDuration },
  lthrRun: { hint: 'bpm', parse: Number }, lthrBike: { hint: 'bpm', parse: Number }, maxHr: { hint: 'bpm (observed, not 220−age)', parse: Number }, restingHr: { hint: 'bpm', parse: Number },
  raceHM: { hint: 'h:mm:ss', parse: parseDuration }, race10k: { hint: 'h:mm:ss or mm:ss', parse: parseDuration }, race5k: { hint: 'mm:ss', parse: parseDuration },
  longestSwimM: { hint: 'meters, continuous', parse: Number }, swimRehearsal: { hint: 'h:mm:ss for ~1.9 km continuous', parse: parseDuration },
};

function fmtBM(type, v) {
  if (['css', 'thresholdPace', 'raceHM', 'race10k', 'race5k', 'swimRehearsal'].includes(type)) return formatDuration(v);
  return String(v);
}

export function profileView(ctx, _p, rerender) {
  const pr = ctx.state.profile;
  const bm = ctx.bm;
  const unit = bm.poolUnit || 'yd';
  const answered = SECTIONS.flatMap(([, f]) => f).filter(([k]) => pr[k] !== undefined && pr[k] !== '').length;
  const total = SECTIONS.flatMap(([, f]) => f).length;
  const zones = [
    ['Bike power (Coggan)', powerZones(bm.ftp)?.map((z) => `${z.id} ${z.name}: ${z.watts[0]}${z.watts[1] ? `–${z.watts[1]}` : '+'} W`)],
    ['Bike HR (Friel, %LTHR)', hrZones(bm.lthrBike, 'bike')?.map((z) => `${z.id} ${z.name}: ${z.bpm[0]}–${z.bpm[1]}`)],
    ['Run HR (Friel, %LTHR)', hrZones(bm.lthrRun, 'run')?.map((z) => `${z.id} ${z.name}: ${z.bpm[0]}–${z.bpm[1]}`)],
    ['Run pace', runPaceZones(bm.thresholdPace)?.map((z) => `${z.name}: ${formatDuration(z.pace[0])}–${formatDuration(z.pace[1])}/mi`)],
    [`Swim (CSS, /100${unit})`, swimZones(bm.css)?.map((z) => `${z.name}: ${formatDuration(z.pace[0])}–${formatDuration(z.pace[1])}`)],
  ];
  const maf = maf180(Number(pr.age));
  const hist = [...ctx.state.benchmarks].sort((a, b) => b.date.localeCompare(a.date));

  const html = `<div class="page-head"><div><div class="eyebrow">Athlete onboarding & benchmarks</div><h1>Profile</h1><p class="text-2">${answered}/${total} questions answered. Nothing here is required to use the plan — missing values simply keep targets provisional.</p></div></div>
  <div class="grid g3">
    <div class="card span2"><h2>Onboarding questionnaire</h2>
      <form id="pform">${SECTIONS.map(([title, fields]) => `<fieldset><legend>${esc(title)}</legend><div class="fields">${fields.map((f) => input(f, pr[f[0]])).join('')}</div></fieldset>`).join('')}
      <button class="btn primary">Save profile</button></form>
    </div>
    <div class="stack">
      <div class="card"><h2>Weekly availability</h2><p class="small text-2">Used by the AI Coach and the plan validator: changes are never moved onto unavailable days, and days over your time limit are flagged. You can also change this by telling the AI Coach.</p>
        <form id="avform" novalidate><table class="ex"><thead><tr><th>Day</th><th>Can train</th><th>Max min</th></tr></thead><tbody>${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => { const a = (pr.availability || {})[d] || {}; return `<tr><td>${DAY_LABEL[d]}</td><td><input type="checkbox" name="av_${d}" aria-label="${DAY_LABEL[d]} available" ${a.available === false ? '' : 'checked'} style="width:auto;min-height:0"></td><td><input type="number" name="mx_${d}" min="0" max="600" inputmode="numeric" value="${esc(a.maxMinutes ?? '')}" aria-label="${DAY_LABEL[d]} max minutes" placeholder="—"></td></tr>`; }).join('')}</tbody></table>
        <div class="row" style="margin-top:8px"><button class="btn primary sm">Save availability</button><span class="err" id="averr"></span></div></form></div>
      <div class="card"><h2>Add benchmark</h2><p class="small text-2">Only enter results from a valid test or race. Test days in the plan have a built-in form that calculates these for you.</p>
        <form id="bform" novalidate><div class="fields" style="grid-template-columns:1fr">
          <label class="f">Type<select name="type" id="btype">${Object.entries(BENCHMARK_TYPES).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('')}</select></label>
          <label class="f">Value <span class="hint" id="bhint">${esc(BM_INPUT.ftp.hint)}</span><input name="value" type="text" required></label>
          <label class="f">Date<input name="date" type="date" value="${ctx.today}" required></label>
          <label class="f">Method / notes<input name="method" type="text" placeholder="e.g., 20-min test on trainer"></label>
        </div><div class="row" style="margin-top:10px"><button class="btn primary">Add</button><span class="err" id="berr"></span></div></form></div>
      <div class="card flat"><h2>Current zones</h2>${zones.map(([t, z]) => `<div class="block-label">${esc(t)}</div>${z ? `<ul class="clean small">${z.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="small">${NE}</p>`}`).join('')}
        ${maf ? `<p class="small muted" style="margin-top:8px">Maffetone 180-formula cross-check: ~${maf} bpm. Shown for reference only — your Z2 ceiling comes from measured LTHR, which is more individual.</p>` : ''}</div>
    </div>
    <div class="card span-all"><h2>Benchmark history</h2>${hist.length ? `<div class="table-wrap"><table class="ex"><thead><tr><th>Date</th><th>Type</th><th>Value</th><th>Method</th><th>Trend</th><th></th></tr></thead><tbody>${hist.map((b) => { const tr = benchmarkTrend(ctx.history, b.type); return `<tr><td>${esc(formatShort(b.date))}</td><td>${esc(BENCHMARK_TYPES[b.type]?.label || b.type)}</td><td>${esc(fmtBM(b.type, b.value))}</td><td class="small">${esc(b.method || '')}</td><td class="small">${tr && ctx.history[b.type]?.at(-1) === b ? `${esc(tr.direction)}${tr.meaningful ? ` (${tr.pct > 0 ? '+' : ''}${tr.pct.toFixed(1)}%)${tr.confirmed ? ', confirmed' : ', confirm with next test'}` : ' (within test noise)'}` : ''}</td><td><button class="btn sm danger" data-del="${esc(b.id)}" aria-label="Delete">✕</button></td></tr>`; }).join('')}</tbody></table></div>` : `<p>${NE}</p><p class="small muted">Baseline tests are scheduled Oct 27 (FTP), Oct 28 (CSS) and Nov 1 (run) — ≥3 weeks after Waco.</p>`}</div>
    <div class="card span-all" id="data"><h2>Data, backup & privacy</h2>
      <p class="small text-2">Your data is stored only in this browser (localStorage) on this device — ${isPersistent() ? 'storage is working' : '<b>storage is NOT available (private mode?) — data will be lost when you close the tab</b>'}. Nothing is sent to any server, and nothing private is in the public source code. Limitations: no automatic sync between phone and laptop; clearing browser data deletes it. <b>Export a JSON backup weekly</b> and import it on another device to move your data.</p>
      <div class="row"><button class="btn primary" data-exp="json">Export JSON backup</button><button class="btn" data-exp="logs">Workouts CSV</button><button class="btn" data-exp="daily">Check-ins CSV</button><button class="btn" data-exp="bm">Benchmarks CSV</button><button class="btn" data-exp="str">Strength CSV</button>
      <label class="btn">Import JSON<input type="file" accept="application/json,.json" id="imp" hidden></label><button class="btn danger" id="reset">Erase all data</button></div>
    </div>
  </div>`;

  return {
    html,
    mount(root) {
      root.querySelector('#pform').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        for (const k of ['t1Est', 't2Est', 'wacoBike', 'wacoRun', 'wacoT2', 'swimPace']) if (fd[k] && !Number.isFinite(parseDuration(fd[k]))) return toast(`Check the time format for "${k}" (use m:ss or h:mm:ss).`);
        update((s) => {
          s.profile = { ...s.profile, ...fd, t1Sec: parseDuration(fd.t1Est) || undefined, t2Sec: parseDuration(fd.t2Est) || undefined };
          s.settings.poolUnit = fd.poolUnit || s.settings.poolUnit;
        });
        toast('Profile saved.');
        rerender();
      });
      root.querySelector('#avform').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const av = {};
        for (const d of DAYS) {
          const raw = fd.get(`mx_${d}`);
          const mx = raw === '' || raw == null ? null : Number(raw);
          if (mx != null && !(Number.isInteger(mx) && mx >= 0 && mx <= 600)) { root.querySelector('#averr').textContent = 'Max minutes must be a whole number 0–600.'; return; }
          av[d] = { available: fd.get(`av_${d}`) === 'on', maxMinutes: mx };
        }
        update((s) => { s.profile.availability = av; });
        toast('Availability saved.');
        rerender();
      });
      const btype = root.querySelector('#btype');
      btype.addEventListener('change', () => { root.querySelector('#bhint').textContent = BM_INPUT[btype.value]?.hint || ''; });
      root.querySelector('#bform').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        const def = BENCHMARK_TYPES[fd.type];
        const v = BM_INPUT[fd.type].parse(String(fd.value).trim());
        const err = root.querySelector('#berr');
        if (!isISODate(fd.date)) { err.textContent = 'Invalid date.'; return; }
        if (!def.valid(v)) { err.textContent = `That value is outside the plausible range for ${def.label}.`; return; }
        update((s) => s.benchmarks.push({ id: uid(), type: fd.type, value: v, date: fd.date, method: fd.method || 'manual entry', createdAt: new Date().toISOString() }));
        toast(`${def.label} saved — targets updated.`);
        rerender();
      });
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        if (!confirm('Delete this benchmark?')) return;
        update((s) => { s.benchmarks = s.benchmarks.filter((x) => x.id !== b.dataset.del); });
        rerender();
      }));
      const stamp = ctx.today;
      root.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => {
        const t = b.dataset.exp;
        if (t === 'json') download(`im703-backup-${stamp}.json`, exportJSON(), 'application/json');
        if (t === 'logs') download(`im703-workouts-${stamp}.csv`, logsCSV(ctx.state, ctx.plan), 'text/csv');
        if (t === 'daily') download(`im703-checkins-${stamp}.csv`, dailyCSV(ctx.state), 'text/csv');
        if (t === 'bm') download(`im703-benchmarks-${stamp}.csv`, benchmarksCSV(ctx.state), 'text/csv');
        if (t === 'str') download(`im703-strength-${stamp}.csv`, strengthCSV(ctx.state), 'text/csv');
      }));
      root.querySelector('#imp').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!confirm('Importing replaces all data in this browser with the backup. Continue?')) return;
        try { importJSON(await file.text()); toast('Backup imported.'); rerender(); } catch (er) { toast(er.message); }
      });
      root.querySelector('#reset').addEventListener('click', () => {
        if (!confirm('Erase ALL logs, check-ins, benchmarks and profile from this browser? Export a backup first.')) return;
        if (!confirm('This cannot be undone. Erase everything?')) return;
        resetAll();
        rerender();
      });
    },
  };
}
