import { esc } from './h.js';
import { PHASES, WEEKS } from '../plan/weeks.js';
import { buildPlan } from '../plan/generator.js';
import { formatShort } from '../lib/dates.js';
import { formatMinutes } from '../lib/units.js';

const REPO = 'https://github.com/Jalmanza12/ironman-703-performance';

export function moreView() {
  const links = [['#/race', 'Prediction', 'Projected splits, readiness, pacing'], ['#/analytics', 'Analytics', 'Volume, load, benchmarks, strength, recovery'], ['#/reviews', 'Weekly reviews', 'Planned vs completed, lessons, next priorities'], ['#/fuel', 'Fuel & body comp', 'Daily targets, sweat test, weight trend'], ['#/raceday', 'Race-day mode', 'Splits, pacing, fueling, checklists'], ['#/profile', 'Profile & benchmarks', 'Onboarding, tests, zones, backup'], ['#/method', 'Method', 'How and why the plan is built']];
  return `<h1>More</h1><div class="stack">${links.map(([h, t, d]) => `<a class="session" href="${h}"><span class="t">${esc(t)}</span><div class="meta">${esc(d)}</div></a>`).join('')}</div>`;
}

export function methodView() {
  const plan = buildPlan();
  return `<div class="page-head"><div><div class="eyebrow">Methodology</div><h1>How this plan is built</h1></div></div>
  <div class="grid g2">
    <div class="card span-all"><h2>Principles (evidence vs. coaching judgment)</h2><ul class="clean">
      <li><b>Mostly easy, some hard (evidence).</b> Successful endurance athletes do most volume at low intensity with a smaller dose of high intensity (Seiler 2010; Stöggl & Sperlich 2014; Rosenblat 2019). Here: ~75–85% of time easy/steady; 2–3 quality sessions per week.</li>
      <li><b>Pyramidal-to-specific progression (coaching judgment).</b> Base phases use more sweet-spot/tempo (time-efficient for a time-limited athlete); build phases add VO₂ and race-specific work; final 8 weeks prioritize race power, race pace and fueling — a blend of Friel's classic periodization and Lorang/Seiler-style intensity discipline.</li>
      <li><b>3:1 loading with explicit deloads (coaching judgment, consistent with periodization literature).</b> Every 4th week reduces volume ~45–53% while keeping short intensity; tests sit at the end of deloads when fresh.</li>
      <li><b>Taper (evidence).</b> ~2 weeks, volume −34% then ~−70%, intensity and frequency kept (Bosquet 2007; Mujika & Padilla 2003).</li>
      <li><b>Heavy strength, maintained (evidence).</b> Heavy strength improves economy and late-race power (Rønnestad & Mujika 2014; Beattie 2014); load is maintained while sets fall (Rønnestad 2010; Spiering 2021).</li>
      <li><b>Bricks (evidence + judgment).</b> Cycling impairs subsequent running economy (Millet & Vleck 2000); bricks progress from 10 to 45 min.</li>
      <li><b>Whole-athlete balance (Dixon).</b> Recovery, nutrition and strength sit beside training; Monday rest is protected; graduate-school weeks have explicit time modifications.</li>
      <li><b>Maffetone's aerobic emphasis — partially adopted.</b> Easy means easy, but zones come from measured LTHR rather than the 180-formula, which is a population estimate.</li>
    </ul><p class="small">Full sources, limitations and translation into this plan: <a href="${REPO}/blob/main/docs/research-and-methodology.md" target="_blank" rel="noopener">docs/research-and-methodology.md ↗</a></p></div>
    <div class="card span-all"><h2>Phase map</h2><div class="table-wrap"><table class="ex"><thead><tr><th>Week</th><th>Dates</th><th>Phase</th><th>Type</th><th>Planned</th><th>Focus</th></tr></thead><tbody>${plan.weeks.map((w) => `<tr><td><a href="#/calendar/week/${w.start}">W${w.n}</a></td><td class="small">${esc(formatShort(w.start))} – ${esc(formatShort(w.end))}</td><td><span class="phase-pill ${PHASES[w.phase].color}">${esc(PHASES[w.phase].name)}</span></td><td>${esc(w.type)}</td><td>${esc(formatMinutes(w.totals.totalMin))}</td><td class="small">${esc(WEEKS[w.n].focus)}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
}
