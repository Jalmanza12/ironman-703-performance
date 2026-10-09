import { esc, NE, toast } from './h.js';
import { dailyTargets, sweatRate, CARB_G_PER_KG, PROTEIN_G_PER_KG } from '../lib/nutrition.js';
import { lineChart } from './charts.js';
import { formatShort, addDays } from '../lib/dates.js';
import { kgFromLb } from '../lib/units.js';
import { update } from '../store/store.js';

export function fuelView(ctx, _p, rerender) {
  const kg = ctx.bm.weightKg;
  const lb = ctx.bm.weightLb;
  const rows = Object.keys(CARB_G_PER_KG).map((k) => ({ k, t: dailyTargets(kg, k) }));
  const weights = Object.entries(ctx.state.daily).filter(([, d]) => d.weightLb > 0).sort(([a], [b]) => a.localeCompare(b));
  // 7-day rolling average to separate trend from daily water/glycogen noise.
  const roll = weights.map(([d], i) => {
    const win = weights.filter(([d2]) => d2 > addDays(d, -7) && d2 <= d).map(([, v]) => Number(v.weightLb));
    return { d, avg: win.reduce((a, b) => a + b, 0) / win.length, raw: Number(weights[i][1].weightLb) };
  });
  const sw = ctx.state.profile.sweatTests || [];
  const bmi = lb && ctx.state.profile.heightIn ? (kgFromLb(lb) / ((Number(ctx.state.profile.heightIn) * 0.0254) ** 2)).toFixed(1) : null;

  const html = `<div class="page-head"><div><div class="eyebrow">Fuel, recovery & body composition</div><h1>Fuel the work</h1></div></div>
  <div class="grid g3">
    <div class="card span2"><h2>Body-composition assessment</h2>
      <p>At ${lb ?? 183} lb and 6'0"${bmi ? ` (BMI ${bmi} — a poor measure for muscular, athletic bodies)` : ''}, with a collegiate soccer and lifting background, there is <b>no evidence you must lose weight</b> to go sub-5:15. On a course with only ~1,400 ft of climbing, aerodynamics and sustainable power matter more on the bike than a few pounds, and run gains will come mostly from aerobic durability and pacing.</p>
      <p><b>Recommendation:</b> make performance the target, not a number on the scale. If you want a modest change, it belongs in the base phase (Oct–mid-Dec) only, at ≤0.25–0.5% of body weight per week (≈0.5–0.9 lb/week), achieved by trimming non-training-day extras — <b>never</b> by under-fueling sessions. From the build phase (late Dec) onward, eat for training: weight stability is the goal. Strength is protected by heavy lifting plus 1.6–2.2 g/kg/day protein.</p>
      <p class="disclaimer">No target weight is set. Aggressive restriction during heavy training risks low energy availability (REDs): impaired adaptation, illness, injury, hormonal and bone-health effects (IOC consensus, Mountjoy 2023). The coaching engine flags weekly loss >1% or loss with rising fatigue.</p>
    </div>
    <div class="card"><h2>Weight trend</h2>${roll.length >= 2 ? lineChart([{ name: '7-day avg', color: '#e9c46a', points: roll.map((r, i) => ({ i, y: r.avg, tip: `${formatShort(r.d)}: 7-day avg ${r.avg.toFixed(1)} lb (today ${r.raw})` })) }], roll.map((r) => formatShort(r.d).slice(4)), { yFmt: (v) => v.toFixed(0), height: 180 }) : `<p>${NE}</p><p class="small muted">Weigh in the morning after the bathroom, 2–4×/week, in the daily check-in. Read the 7-day average, not single days.</p>`}</div>

    <div class="card span2"><h2>Daily carbohydrate & protein by training demand</h2>${kg ? `<div class="table-wrap"><table class="ex"><thead><tr><th>Day type</th><th>Example</th><th>Carbohydrate</th><th>Protein</th></tr></thead><tbody>${rows.map(({ k, t }) => `<tr><td><b>${esc(k)}</b> <span class="muted small">${CARB_G_PER_KG[k][0]}–${CARB_G_PER_KG[k][1]} g/kg</span></td><td class="small">${esc({ rest: 'Monday rest', light: 'Easy swim only', moderate: 'Tue/Thu intervals + lift', high: '1.5–3 h days', veryHigh: 'Long ride + brick; carb-load days' }[k])}</td><td>${t.carbs[0]}–${t.carbs[1]} g</td><td>${t.protein[0]}–${t.protein[1]} g</td></tr>`).join('')}</tbody></table></div><p class="small muted">Based on ${kg.toFixed(1)} kg. Carbohydrate ranges: Burke 2011 / ACSM-AND-DC 2016. Protein ${PROTEIN_G_PER_KG.join('–')} g/kg/day (ISSN, Jäger 2017), in 4–5 feeds of ~0.3–0.4 g/kg (${Math.round(kg * 0.3)}–${Math.round(kg * 0.4)} g).</p>` : `<p>${NE}</p>`}
      <div class="block-label">Session fueling</div><ul class="clean small">
        <li><b>Before:</b> 1–4 g/kg carbohydrate 1–4 h before long/key sessions (e.g., ~80–160 g). Early easy sessions can be done after a small snack.</li>
        <li><b>During:</b> &lt;60 min — water; 60–150 min — 30–60 g/h; &gt;2.5 h — up to 90 g/h from glucose+fructose (Jeukendrup 2014). Build tolerance gradually (gut training; Jeukendrup 2017).</li>
        <li><b>After:</b> 25–35 g protein + carbohydrate within ~2 h; ~1–1.2 g/kg/h carbohydrate for a few hours when the next key session is &lt;24 h away.</li>
        <li><b>Caffeine:</b> optional, 3–6 mg/kg (~250–500 mg) ~60 min before or late in races — practise first (Guest 2021). Start at the low end.</li>
        <li><b>Hydration:</b> avoid >2% body-mass loss in training and never gain weight during long sessions (Sawka 2007). Sodium ~300–600 mg/L for long/hot sessions; heavy/salty sweaters may need more (McCubbin 2020).</li></ul></div>
    <div class="card"><h2>Sweat-rate test</h2><p class="small text-2">Do this on a 60-min steady session in race-like weather. Weigh nude before and after (towel dry).</p>
      <form id="swform" class="fields" style="grid-template-columns:1fr 1fr" novalidate>
        <label class="f">Pre (lb)<input name="pre" type="number" step="0.1" inputmode="decimal"></label><label class="f">Post (lb)<input name="post" type="number" step="0.1" inputmode="decimal"></label>
        <label class="f">Fluid drunk (mL)<input name="fluid" type="number" inputmode="decimal"></label><label class="f">Duration (min)<input name="min" type="number" inputmode="decimal"></label>
        <label class="f" style="grid-column:1/-1">Conditions<input name="cond" type="text" placeholder="e.g., 72 °F, humid, bike"></label>
        <button class="btn primary" style="grid-column:1/-1">Calculate & save</button></form>
      ${sw.length ? `<div class="block-label">Results</div><ul class="clean small">${sw.map((s) => `<li>${esc(formatShort(s.date))}: ${s.rate.toFixed(2)} L/h, ${s.pct.toFixed(1)}% mass change (${esc(s.cond || '')})</li>`).join('')}</ul><p class="small muted">Plan to replace roughly 50–80% of sweat losses on the bike, to thirst.</p>` : ''}
    </div>
    <div class="card span-all"><h2>Recovery fundamentals</h2><div class="mods">
      <div><b>Sleep</b>7–9 h in bed; consistent wake time; extra sleep in heavy weeks and race week (Walsh 2021). Sleep is the first lever when fatigue rises.</div>
      <div><b>Easy days easy</b>Most volume at low intensity keeps quality high where it matters (Seiler 2010).</div>
      <div><b>Deloads</b>Every 4th week is lighter; they are where adaptation consolidates.</div>
      <div><b>Monitor</b>Daily sleep, fatigue, soreness and motivation; subjective measures track training response well (Saw 2016).</div>
      <div><b>Red flags</b>Pain that changes movement, chest pain, dizziness, fainting, illness with fever — stop and seek medical evaluation.</div>
    </div></div>
  </div>`;
  return {
    html,
    mount(root) {
      root.querySelector('#swform').addEventListener('submit', (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        const r = sweatRate({ preKg: kgFromLb(Number(d.pre)), postKg: kgFromLb(Number(d.post)), fluidL: Number(d.fluid || 0) / 1000, hours: Number(d.min) / 60 });
        if (!r || !(r.rateLph > 0 && r.rateLph < 4)) return toast('Check the numbers — sweat rate should be roughly 0.2–3 L/h.');
        update((s) => { s.profile.sweatTests = [...(s.profile.sweatTests || []), { date: ctx.today, rate: r.rateLph, pct: r.pctLoss, cond: d.cond }]; });
        toast(`Sweat rate ${r.rateLph.toFixed(2)} L/h saved.`);
        rerender();
      });
    },
  };
}
