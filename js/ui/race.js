import { esc, NE } from './h.js';
import { formatDuration, paceSecPerMileToKm } from '../lib/units.js';
import { SCENARIOS, scenarioTotal, TARGET_SEC, limiters, ASSUMPTIONS } from '../lib/prediction.js';
import { readiness, WEIGHTS } from '../lib/readiness.js';
import { RACE, WACO } from '../data/race.js';
import { validFTP, validRunPace, validHR, validCSS } from '../lib/zones.js';

const T = (s) => formatDuration(s, { forceHours: true });
const COL = { swim: '#3987e5', t1: '#5d6a86', bike: '#c98500', t2: '#5d6a86', run: '#d55181' };

export function splitBar(spl) {
  const total = Object.values(spl).reduce((a, b) => a + b, 0);
  return `<div class="split-bar" role="img" aria-label="Split proportions">${Object.entries(spl).map(([k, v]) => `<div style="flex:${v};background:${COL[k]}" title="${k}: ${formatDuration(v)}">${v / total > 0.08 ? `${k.toUpperCase()} ${formatDuration(v)}` : ''}</div>`).join('')}</div>`;
}

/** Individualised pacing bands (shared with race-day view). */
export function pacingBands(bm) {
  const out = { bike: null, run: null, swim: null };
  if (validFTP(bm.ftp)) {
    const w = (x) => Math.round(bm.ftp * x);
    out.bike = [
      ['First 15 min', `${w(0.68)}–${w(0.73)} W`, 'Below race power. Let HR settle after the swim; this is where Waco was lost.'],
      ['Flats & false flats', `${w(0.75)}–${w(0.80)} W`, 'Race power. Aero, steady, smooth cadence 82–92.'],
      ['Gradual rises (<2 min)', `≤ ${w(0.90)} W`, 'Shift early; accept losing speed. Never chase a rider uphill.'],
      ['Longer rises / headwind', `≤ ${w(0.85)} W`, 'Hold the cap; wind costs speed, not watts.'],
      ['Descents / tailwind', `${w(0.55)}–${w(0.70)} W`, 'Keep pedaling lightly until spinning out; then tuck and drink.'],
      ['Final 20 min', `${w(0.72)}–${w(0.77)} W`, 'Slightly easier; spin 90+, eat/drink last fuel, prepare to run.'],
      ['Absolute ceiling', `${w(1.0)} W`, 'Any effort above FTP is a mistake on this course.'],
    ];
  }
  if (validRunPace(bm.thresholdPace)) {
    const p = (m) => `${formatDuration(bm.thresholdPace * m)}`;
    out.run = [
      ['Miles 0–2', `${p(1.12)}–${p(1.15)} /mi`, 'Deliberately 10–15 s/mi slower than goal. Short quick steps.'],
      ['Miles 2–10 flat', `${p(1.07)}–${p(1.10)} /mi`, 'Goal band. Effort and HR first, watch second.'],
      ['Short rises', 'Effort-matched', 'Hold effort, let pace drop 10–20 s/mi; do not surge.'],
      ['Descents', '+0 effort', 'Quick cadence, relaxed; take the free speed without braking.'],
      ['Miles 10–13.1', `≤ ${p(1.04)} /mi if earned`, 'Only accelerate if HR is in range, fueling is on, and form is good.'],
    ];
  }
  if (validCSS(bm.css)) {
    const u = bm.poolUnit || 'yd';
    out.swim = [['Opening 200', `Effort ~RPE 5`, 'Controlled; find feet or clear water; breathe every 2–3.'], ['Body', `≈ ${formatDuration(bm.css + 4)}–${formatDuration(bm.css + 7)} /100${u} pool-equivalent`, 'Race effort (CSS +3–6 s); sight every 6–8 strokes.'], ['Final 200', 'Same effort', 'Kick slightly more to wake the legs; plan T1.']];
  }
  return out;
}

export function hrCaps(bm) {
  const r = [];
  if (validHR(bm.lthrBike)) r.push(`Bike HR ceiling on flats ≈ ${Math.round(bm.lthrBike * 0.92)} bpm (92% bike LTHR) after the first 15 min.`);
  if (validHR(bm.lthrRun)) r.push(`Run HR: miles 0–6 ≤ ${Math.round(bm.lthrRun * 0.92)} bpm; miles 6–10 ≤ ${Math.round(bm.lthrRun * 0.95)}; final 3 miles open.`);
  return r;
}

export function raceView(ctx) {
  const p = ctx.prediction;
  const rd = readiness({ plan: ctx.plan, state: ctx.state, bm: ctx.bm, evidence: ctx.evidence, today: ctx.today });
  const bands = pacingBands(ctx.bm);
  const splitRow = (k, label) => {
    const s = p.splits[k];
    if (!s.established) return `<tr><td>${label}</td><td colspan="3">${NE}</td><td class="small muted">Needs: ${esc(s.needed)}</td></tr>`;
    return `<tr><td>${label}</td><td>${T(s.lo)}</td><td><b>${T(s.mid)}</b></td><td>${T(s.hi)}</td><td class="small"><span class="chip ${s.confidence === 'moderate' ? 'good' : 'warn'}">${esc(s.confidence)} confidence</span><div class="muted">${esc(s.source)}</div></td></tr>`;
  };
  const scenarioRows = Object.values(SCENARIOS).map((s) => `<tr><td><b>${esc(s.label)}</b></td><td>${formatDuration(s.swim)}</td><td>${formatDuration(s.t1)}</td><td>${T(s.bike)}</td><td>${formatDuration(s.t2)}</td><td>${T(s.run)}</td><td><b>${T(scenarioTotal(s))}</b></td><td class="small">${scenarioTotal(s) <= TARGET_SEC ? `${formatDuration(TARGET_SEC - scenarioTotal(s))} under` : `${formatDuration(scenarioTotal(s) - TARGET_SEC)} over`}</td></tr>`).join('');
  const tgt = SCENARIOS.target;

  return `<div class="page-head"><div><div class="eyebrow">Race-prediction engine</div><h1>Sub-5:15 projection</h1></div></div>
  <div class="grid g3">
    <div class="card span2"><h2>Current projection (modeled from your benchmarks)</h2>
      ${p.total ? `<div class="row" style="gap:28px;margin:6px 0 12px"><div class="stat"><span class="v">${T(p.total.mid)}</span><span class="l">Likely</span></div><div class="stat"><span class="v sm">${T(p.total.lo)} – ${T(p.total.hi)}</span><span class="l">Range (fast → slow)</span></div><div class="stat"><span class="v sm">5:15:00</span><span class="l">Target</span></div></div>${splitBar({ swim: p.splits.swim.mid, t1: p.splits.t1.mid, bike: p.splits.bike.mid, t2: p.splits.t2.mid, run: p.splits.run.mid })}<p class="small" style="margin-top:8px">${esc(p.total.probBelowTargetNote)}.</p>`
        : `<p>${NE}</p><p class="text-2">A finish-time projection appears only when real swim, bike, and run benchmarks exist. Your Waco result (${esc(WACO.finish)}, swim canceled) is not used as a full-triathlon benchmark.</p>`}
      <div class="table-wrap"><table class="ex"><thead><tr><th>Split</th><th>Fast</th><th>Likely</th><th>Slow</th><th>Basis</th></tr></thead><tbody>
        ${splitRow('swim', 'Swim 1.2 mi')}${splitRow('t1', 'T1')}${splitRow('bike', 'Bike 56 mi')}${splitRow('t2', 'T2')}${splitRow('run', 'Run 13.1 mi')}
      </tbody></table></div>
      <details style="margin-top:10px"><summary>How each split is modeled</summary><ul class="clean small">
        ${Object.entries(p.splits).filter(([, s]) => s.established).map(([k, s]) => `<li><b>${k}</b>: ${s.notes.map(esc).join(' ')}</li>`).join('')}
        <li>Total range = sum of all fast bounds to sum of all slow bounds — deliberately conservative (real outcomes are rarely all-best or all-worst).</li>
        <li>Swim: open-water factor ${ASSUMPTIONS.swim.paceFactor.join('/')} × CSS, wetsuit factor ${ASSUMPTIONS.swim.wetsuitFactor}, navigation +1–6%. Bike: ${ASSUMPTIONS.bike.intensity.map((x) => `${x * 100}%`).join('/')} FTP, physics model over a ~1,400 ft rolling profile with 1–5.5 m/s wind. Run: off-bike factor ${ASSUMPTIONS.run.offBikeFactor.join('/')} × open half-marathon estimate. These factors are coaching judgment, not measured on you — your logged bricks and race-distance swim progressively replace them.</li>
      </ul></details>
    </div>
    <div class="card"><h2>What is helping / limiting</h2><ul class="clean">${limiters(p).map((l) => `<li>${l.kind === 'helping' ? '✅' : l.kind === 'limiting' ? '⚠️' : '•'} ${esc(l.text)}</li>`).join('')}</ul>
      <p class="small muted" style="margin-top:8px">Compared with the target budget below. Observed data (tests, logged sessions) is kept separate from modeled assumptions; one unusual workout never moves the projection — only benchmarks and multi-session evidence do.</p></div>

    <div class="card span-all"><h2>Race-time budgets (planning scenarios, not predictions)</h2><div class="table-wrap"><table class="ex"><thead><tr><th>Scenario</th><th>Swim</th><th>T1</th><th>Bike</th><th>T2</th><th>Run</th><th>Total</th><th>vs 5:15</th></tr></thead><tbody>${scenarioRows}</tbody></table></div>
      <p class="small text-2" style="margin-top:8px">Target needs roughly: swim ≈ ${formatDuration(tgt.swim / 19.31)}/100 m incl. sighting (wetsuit), bike ≈ ${(56 / (tgt.bike / 3600)).toFixed(1)} mph average, run ≈ ${formatDuration(tgt.run / 13.109)}/mi (${formatDuration(paceSecPerMileToKm(tgt.run / 13.109))}/km). The target scenario leaves ${formatDuration(TARGET_SEC - scenarioTotal(tgt))} of margin.</p>
      <p class="disclaimer">Honest context: Waco (${esc(WACO.finish)}) had no swim. Adding a ~35–42 min swim and a longer T1 means bike + run + T2 must be ~45–50 min faster than Waco's comparable segments for sub-5:15. That is ambitious — achievable only if Waco's run was heavily compromised by pacing/heat and your bike improves. Enter your Waco splits on the Profile page to evaluate this with data.</p></div>

    <div class="card span2"><h2>Race-readiness indicator</h2><div class="row" style="gap:18px;align-items:flex-start"><div class="ring" style="--p:${rd.score ?? 0}"><div><span><b>${rd.score ?? '—'}</b><br><span class="small muted">/100</span></span></div></div>
      <div style="flex:1;min-width:240px"><table class="ex"><thead><tr><th>Component (weight)</th><th>Score</th><th>Basis</th></tr></thead><tbody>${Object.entries(rd.components).map(([k, c]) => `<tr><td>${esc(k)} (${WEIGHTS[k]}%)</td><td>${c.score == null ? '<span class="muted">no data</span>' : c.score}</td><td class="small">${esc(c.basis)}</td></tr>`).join('')}</tbody></table></div></div>
      <p class="disclaimer" style="margin-top:10px">${esc(rd.disclaimer)} Coverage: ${Math.round(rd.coverage * 100)}% of weighted components have data.</p></div>
    <div class="card"><h2>Course facts (verified)</h2><ul class="clean small"><li>${esc(RACE.swim.description)} ${esc(RACE.swim.note2026)}</li><li>Bike: ${esc(RACE.bike.character)} ~${RACE.bike.elevationGainFt} ft gain.</li><li>Run: ${esc(RACE.run.description)} ${esc(RACE.run.character)}</li><li>${esc(RACE.dst)}</li></ul><a class="small" href="${RACE.sources.coursePage}" target="_blank" rel="noopener">Official course page ↗</a></div>

    <div class="card span-all"><h2>Pacing strategy — lessons from Waco</h2>
      <div class="grid g3">
        <div><h3>Bike</h3>${bands.bike ? bandTable(bands.bike) : `<p>${NE}</p><p class="small">Until FTP is set: first 15 min RPE 3–4; flats RPE 5–6 (conversational in short phrases); rises never above RPE 7; final 20 min RPE 4–5.</p>`}
          <ul class="clean small" style="margin-top:8px"><li>Judge the ride by Variability Index (NP ÷ avg power ≤ 1.05) and IF (0.75–0.80), not by speed or average power alone.</li><li>Cadence: 85–95 on flats, 75–85 on rises; shift before the slope.</li><li>False flats: hold watts, ignore speed.</li><li>Wind: watts are the plan; speed is the weather's decision.</li></ul></div>
        <div><h3>Run</h3>${bands.run ? bandTable(bands.run) : `<p>${NE}</p><p class="small">Until threshold pace is set: miles 0–2 RPE 4; miles 2–10 RPE 5–6; final 5K RPE 7–8 only if earned.</p>`}
          <ul class="clean small" style="margin-top:8px">${hrCaps(ctx.bm).map((x) => `<li>${esc(x)}</li>`).join('')}<li>HR drift: if HR rises >5% at the same pace before mile 8, slow 10 s/mi and take fluid + carbs.</li><li>Walk aid stations briefly (5–10 s) to drink properly — it costs less than a late fade.</li><li>Decision at mile 10: HR in range + fueling on track + form good → accelerate. Otherwise hold.</li></ul></div>
        <div><h3>Swim</h3>${bands.swim ? bandTable(bands.swim) : `<p>${NE}</p>`}
          <ul class="clean small" style="margin-top:8px"><li>Seed yourself honestly in the rolling start by expected time.</li><li>Sight every 6–8 strokes; pick a landmark taller than the buoys.</li><li>Draft on feet or hip where legal and calm; leave if pace drops.</li><li>Practice in your race wetsuit ≥3 times before race day.</li><li>The swim split is not treated as predictable until you have logged a continuous ~1,900 swim (Week 20 rehearsal).</li></ul></div>
      </div></div>
  </div>`;
}

function bandTable(rows) {
  return `<table class="ex"><tbody>${rows.map(([a, b, c]) => `<tr><td><b>${esc(a)}</b><div class="small muted">${esc(c)}</div></td><td style="white-space:nowrap">${esc(b)}</td></tr>`).join('')}</tbody></table>`;
}
