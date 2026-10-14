import { esc, NE } from './h.js';
import { formatDuration } from '../lib/units.js';
import { SCENARIOS } from '../lib/prediction.js';
import { pacingBands, hrCaps, splitBar } from './race.js';
import { RACE } from '../data/race.js';
import { update } from '../store/store.js';

const T = (s) => formatDuration(s, { forceHours: true });

const CHECKLISTS = {
  'Night before': ['Bike & run bags checked in (per Athlete Guide)', 'Race kit, wetsuit, cap, 2 pairs goggles laid out', 'Bottles filled/frozen; nutrition counted for the bike', 'Alarm set on a phone that auto-updates — clocks spring forward 2→3 a.m.', 'Breakfast prepared (practised foods only)', 'Lights out early; read tomorrow\'s passage'],
  'Race morning': ['Breakfast 3 h before start: 1–2 g/kg carbohydrate', 'Body-mark, timing chip on left ankle', 'Tires pumped, computer/power meter calibrated (zero-offset)', 'Bottles & nutrition on bike; gels taped/in bento', 'Helmet on bars, sunglasses inside; shoes set up', 'Wetsuit on with body glide; caffeine if practised', 'Last gel 15 min before start + water', 'Warm-up: 10 min jog + arm swings or water warm-up'],
  T1: ['Wetsuit to waist while running', 'Helmet ON and buckled before touching the bike', 'Shoes, glasses, race number (if required on bike)', 'Mount after the mount line'],
  T2: ['Dismount before the line', 'Rack bike, helmet off after racking', 'Shoes (elastic laces), race belt number front, visor', 'Grab gels/flask; go — first 3–5 min short quick steps'],
  Equipment: ['Wetsuit, 2 caps, 2 goggles (clear + tinted)', 'Bike: spare tube, CO₂ ×2, levers, multitool', 'Helmet, sunglasses, bike shoes', 'Run shoes, socks (if used), race belt, visor/cap', 'Bottles, bike nutrition, run gels, salt/electrolytes', 'Watch/bike computer charged; HR strap', 'Sunscreen, anti-chafe, pump, track bag, ID, USAT/IRONMAN docs'],
};

export function raceDayView(ctx, _p, rerender) {
  const bands = pacingBands(ctx.bm);
  const p = ctx.prediction;
  const race = ctx.plan.byDate[RACE.date];
  const checked = ctx.state.settings.raceChecklist || {};
  const reminders = ctx.state.profile.raceReminders || '';
  const tg = SCENARIOS.target;
  const fuel = ctx.bm.weightKg ? `${Math.round(ctx.bm.weightKg)}–${Math.round(ctx.bm.weightKg * 2)} g` : '1–2 g/kg';
  const spl = p.total ? { swim: p.splits.swim.mid, t1: p.splits.t1.mid, bike: p.splits.bike.mid, t2: p.splits.t2.mid, run: p.splits.run.mid } : { swim: tg.swim, t1: tg.t1, bike: tg.bike, t2: tg.t2, run: tg.run };
  const html = `<div class="raceday">
  <div class="page-head"><div><div class="eyebrow">Race-day mode · ${esc(RACE.name)}</div><h1>Sunday, March 14, 2027</h1><p class="text-2">Start ${esc(RACE.provisionalStartLocal)} CDT (provisional) · <b>Clocks spring forward overnight</b></p></div><button class="btn no-print" id="print">Print</button></div>
  <div class="grid g2">
    <div class="card span-all"><h2>Target splits ${p.total ? '(your projection)' : '(target budget — benchmarks not yet set)'}</h2>${splitBar(spl)}
      <div class="grid g4 stats" style="margin-top:12px">${['swim', 't1', 'bike', 't2', 'run'].map((k) => {
        const s = p.splits[k];
        return `<div class="stat"><span class="l">${k.toUpperCase()}</span><span class="v sm">${s?.established ? `${formatDuration(s.lo)}–${formatDuration(s.hi)}` : formatDuration(tg[k])}</span></div>`;
      }).join('')}<div class="stat"><span class="l">Finish</span><span class="v sm">${p.total ? `${T(p.total.lo)}–${T(p.total.hi)}` : `${T(Object.values(spl).reduce((a, b) => a + b, 0))} budget`}</span></div></div></div>
    <div class="card"><h2>Opening-effort reminders</h2><ul class="clean"><li><b>Swim:</b> first 200 controlled — breathe, find rhythm, then race.</li><li><b>Bike:</b> first 15 min below race power. Nobody wins in the first 15 minutes; many lose there.</li><li><b>Run:</b> miles 1–2 slower than goal. You will feel great — that is the bike adrenaline, not your fitness.</li></ul></div>
    <div class="card"><h2>Fueling & hydration schedule</h2><ul class="clean"><li>Breakfast (−3 h): ${fuel} carbohydrate, familiar foods, 500 mL fluid.</li><li>−15 min: gel (20–25 g) + sips of water.</li><li>Bike: start eating at 15 min; 60–90 g/h (what you practised), every 15–20 min; drink every 10–15 min to thirst; sodium per your sweat test.</li><li>Final 20 min of bike: last fuel, finish bottle.</li><li>Run: 40–60 g/h (gel every ~25–30 min + course drinks); water at every aid station; cola/caffeine after mile 8 if practised.</li><li>Heat: sponges/ice under cap; slow by HR.</li></ul></div>
    <div class="card"><h2>Bike pacing</h2>${bands.bike ? bands.bike.map(([a, b, c]) => `<p><b>${esc(a)}:</b> <span class="big" style="font-size:1.15rem">${esc(b)}</span><br><span class="small muted">${esc(c)}</span></p>`).join('') : `<p>${NE} — use RPE: 3–4 first 15 min, 5–6 flats, ≤7 on rises.</p>`}</div>
    <div class="card"><h2>Run pacing</h2>${bands.run ? bands.run.map(([a, b, c]) => `<p><b>${esc(a)}:</b> <span class="big" style="font-size:1.15rem">${esc(b)}</span><br><span class="small muted">${esc(c)}</span></p>`).join('') : `<p>${NE} — use RPE: 4 then 5–6, open up after mile 10 only if earned.</p>`}${hrCaps(ctx.bm).map((x) => `<p class="small">${esc(x)}</p>`).join('')}</div>
    ${Object.entries(CHECKLISTS).map(([name, items]) => `<div class="card checklist"><h2>${esc(name)}</h2>${items.map((it, i) => { const k = `${name}:${i}`; return `<label><input type="checkbox" data-ck="${esc(k)}" ${checked[k] ? 'checked' : ''}><span>${esc(it)}</span></label>`; }).join('')}</div>`).join('')}
    <div class="card"><h2>Personal reminders</h2><textarea id="rem" placeholder="e.g., Relax shoulders. Patience to mile 10. Smile at volunteers.">${esc(reminders)}</textarea><button class="btn sm" id="saverem" style="margin-top:8px">Save</button></div>
    ${race ? `<div class="card faith span-all"><div class="theme">Race-day passage</div><div class="ref">${esc(race.bible.ref)}</div><blockquote>${esc(race.bible.summary)}</blockquote><p>${esc(race.bible.reflection)}</p><p class="q">${esc(race.bible.question)}</p></div>` : ''}
  </div>
  <p class="small muted no-print" style="margin-top:10px"><button class="btn sm ghost" id="resetck">Reset checklists</button></p></div>`;
  return {
    html,
    mount(root) {
      root.querySelector('#print').addEventListener('click', () => window.print());
      root.querySelectorAll('[data-ck]').forEach((c) => c.addEventListener('change', () => update((s) => { s.settings.raceChecklist = { ...(s.settings.raceChecklist || {}), [c.dataset.ck]: c.checked }; })));
      root.querySelector('#saverem').addEventListener('click', () => { update((s) => { s.profile.raceReminders = root.querySelector('#rem').value; }); rerender(); });
      root.querySelector('#resetck').addEventListener('click', () => { update((s) => { s.settings.raceChecklist = {}; }); rerender(); });
    },
  };
}
