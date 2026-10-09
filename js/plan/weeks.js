// The periodized plan: Week 0 (post-Waco recovery, Oct 5 2026) → Week 22 (race week, Mar 14 2027).
// Each week lists its seven days (Mon→Sun) as arrays of sessions.
// Rationale for structure is documented in docs/research-and-methodology.md (§ Plan design).

import { T, Z, PRIORITY } from './common.js';
import * as B from './bike.js';
import * as R from './run.js';
import * as S from './swim.js';
import { strengthSession as ST, mobility, rest, raceDay, recoveryWalk } from './strength.js';

export const PLAN_START = '2026-10-05'; // Monday after Waco
export const RACE_DATE = '2027-03-14';

export const PHASES = {
  recovery: { name: 'Recovery & transition', color: 'phase-recovery', summary: 'Absorb Waco, restore motivation, re-groove technique and strength. No hard training.' },
  base1: { name: 'Aerobic base + swim technique', color: 'phase-base', summary: 'Aerobic volume, swim technique, sweet-spot bike work, hill running, heavy-strength development, baseline tests.' },
  base2: { name: 'Bike power & climbing / run durability', color: 'phase-base', summary: 'Threshold bike work and seated climbing strength, threshold runs and longer long runs, swim endurance.' },
  build1: { name: 'Build — threshold & race-specific endurance', color: 'phase-build', summary: 'VO₂ and threshold sharpening, race-power blocks on long rides, longer bricks, strength maintained.' },
  build2: { name: 'Race-specific build', color: 'phase-build', summary: 'Rolling-terrain over-unders, long race-power rides with full fueling, race-pace long runs, open-water skills.' },
  peak: { name: 'Peak', color: 'phase-peak', summary: 'One final race simulation and the highest race-specific load.' },
  taper: { name: 'Taper', color: 'phase-taper', summary: 'Volume −35–40%, intensity kept, fatigue falls, sharpness rises.' },
  race: { name: 'Race week', color: 'phase-race', summary: 'Volume −60%, short openers, logistics, sleep, carbohydrate, calm.' },
};

const sat = (bike, brick) => (brick ? [bike, brick] : [bike]);

/**
 * Week definitions. type: recovery | build | test | peak | taper | race
 * deload: explicit description for recovery weeks.
 */
export const WEEKS = [
  {
    n: 0, phase: 'recovery', type: 'recovery', title: 'Post-Waco recovery',
    focus: 'Recover from Waco (Oct 4). Sleep, eat well, walk. Light movement only from day 4.',
    days: [
      [recoveryWalk(20, 'Day 1 after Waco.')],
      [recoveryWalk(30, 'Day 2 after Waco.')],
      [rest('Day 3 after Waco — full rest.')],
      [S.swimEasy(1000, { ctx: 'First swim back — easy, no clock.' })],
      [B.bikeRecoverySpin(30, 'Legs only — Z1.')],
      [mobility(20), S.swimEasy(1200, { ctx: 'Optional.' })],
      [B.bikeRecoverySpin(45, 'If the legs feel normal, finish with 5 min at Z2.'), recoveryWalk(20, 'Or a 15–20 min run-walk (1 min jog / 1 min walk) only if there is no pain.')],
    ],
  },
  {
    n: 1, phase: 'recovery', type: 'recovery', title: 'Transition — re-entry',
    focus: 'Re-establish routine. Everything easy. Strength re-introduction. First runs.',
    days: [
      [rest('Start each week rested.')],
      [B.bikeEndurance(45, { drills: 'cadence', priority: PRIORITY.support }), ST('A', 'intro')],
      [S.swimTechnique(1600)],
      [R.runEasy(30, { strides: 4, ctx: 'First structured run since Waco — stop if anything hurts.' }), ST('B', 'intro')],
      [S.swimTechnique(1800)],
      [B.bikeLong(90, { ctx: 'Easy aerobic ride — reconnect with the bike, no targets beyond Z2.', priority: PRIORITY.support })],
      [R.runEasy(45, { ctx: 'Longest run of the week, all easy.' })],
    ],
  },
  {
    n: 2, phase: 'recovery', type: 'recovery', title: 'Transition — rebuild rhythm',
    focus: 'Light tempo touches; strength re-introduction continues.',
    days: [
      [rest()],
      [B.bikeEndurance(60, { drills: 'single-leg' }), ST('A', 'intro')],
      [S.swimTechnique(2000), R.runEasy(30)],
      [R.runEasy(40, { strides: 6 }), ST('B', 'intro')],
      [S.swimTechnique(1800)],
      [B.bikeLong(105, { blocks: [{ reps: 3, min: 5, recMin: 5, label: 'tempo', target: Z.bikeTempo }], ctx: 'Short tempo touches remind the legs of steady pressure.', priority: PRIORITY.support })],
      [R.runEasy(55)],
    ],
  },
  {
    n: 3, phase: 'base1', type: 'test', title: 'Base 1 — baseline testing',
    focus: 'Three weeks after Waco: establish FTP, CSS, threshold pace, and strength baselines.',
    testNote: 'Tests fall ≥22 days after Waco — appropriate timing for maximal efforts after a 70.3 recovery. Move any test 1–3 days if you are still unusually sore or tired.',
    days: [
      [rest('Rested for tomorrow\'s FTP test.')],
      [B.bikeFTPTest(), ST('A', 'baseline', { ctx: 'Log e1RM benchmarks today.' })],
      [S.swimCSSTest()],
      [R.runEasy(40, { strides: 4 }), ST('B', 'baseline')],
      [S.swimTechnique(2000)],
      [B.bikeLong(120)],
      [R.runTest()],
    ],
  },
  {
    n: 4, phase: 'base1', type: 'build', title: 'Base 1 — week 2',
    focus: 'Sweet-spot bike, hills, CSS swimming, heavy strength.',
    days: [
      [rest(), mobility(20)],
      [B.bikeSweetSpot(3, 10, 5), ST('A', 'base')],
      [S.swimCSS(10, 100, 15, [2, 4]), R.runEasy(30)],
      [R.runHills(6, 60), ST('B', 'base')],
      [S.swimTechnique(2000)],
      sat(B.bikeLong(135, { blocks: [{ reps: 3, min: 10, recMin: 5, label: 'tempo', target: Z.bikeTempo }], brickAfter: true }), R.runBrick(10)),
      [R.runLong(65)],
    ],
  },
  {
    n: 5, phase: 'base1', type: 'build', title: 'Base 1 — week 3',
    focus: 'Extend sweet spot and long run.',
    days: [
      [rest(), mobility(20)],
      [B.bikeSweetSpot(3, 12, 5), ST('A', 'base')],
      [S.swimCSS(12, 100, 15, [1, 3]), R.runEasy(35)],
      [R.runHills(8, 60), ST('B', 'base')],
      [S.swimEndurance(3, 300, 30)],
      sat(B.bikeLong(150, { blocks: [{ reps: 3, min: 15, recMin: 5, label: 'tempo', target: Z.bikeTempo }], brickAfter: true }), R.runBrick(15)),
      [R.runLong(70)],
    ],
  },
  {
    n: 6, phase: 'base1', type: 'build', title: 'Base 1 — week 4 (block peak)',
    focus: 'Highest load of Base 1.',
    days: [
      [rest(), mobility(20)],
      [B.bikeSweetSpot(3, 15, 5), ST('A', 'base')],
      [S.swimCSS(5, 200, 20, [2, 4]), R.runEasy(40)],
      [R.runCruise(4, 5, 90), ST('B', 'base')],
      [S.swimEndurance(4, 300, 30)],
      sat(B.bikeLong(165, { blocks: [{ reps: 2, min: 20, recMin: 10, label: 'upper tempo', target: T.bike(0.80, 0.85, { hr: [0.89, 0.93], rpe: [5, 6] }) }], brickAfter: true }), R.runBrick(15, { racePaceMin: 5 })),
      [R.runLong(80)],
    ],
  },
  {
    n: 7, phase: 'base1', type: 'recovery', title: 'Recovery + retest (Thanksgiving week)',
    focus: 'Thanksgiving Thursday is a planned rest day. CSS and FTP retests at week end when fresh.',
    deload: {
      volume: '≈47% less than Week 6 (10.8 h → 5.7 h, including two test sessions). Base-phase fatigue is moderate, but two benchmark tests need genuinely fresh legs.',
      keeps: 'One short sweet-spot touch (Tue) and short strides — intensity is kept, volume is removed.',
      removed: 'Long ride replaced by the FTP retest (Sat); long run shortened to 50 min; brick removed; Thursday is rest (Thanksgiving).',
      lifting: 'Two sessions at deload dose: same loads (~90%), sets halved, RIR 4.',
      structure: 'Two rest days (Mon, Thu), tests Fri/Sat, short easy Sunday.',
      markers: 'Morning resting HR back to baseline, sleep ≥7 h, soreness ≤3/10, motivation returning by Friday. If not, delay the retests.',
    },
    days: [
      [rest()],
      [B.bikeSweetSpot(2, 8, 4), ST('A', 'deload')],
      [S.swimTechnique(1800), R.runEasy(30, { strides: 4 })],
      [rest('Thanksgiving — rest, gratitude, and a full plate (carbohydrate and protein are recovery tools, not rewards).')],
      [S.swimCSSTest(), ST('B', 'deload', { after: 'Light — 2 sets only.' })],
      [B.bikeFTPTest()],
      [R.runEasy(50, { ctx: 'Easy, enjoy it.' })],
    ],
  },
  {
    n: 8, phase: 'base2', type: 'build', title: 'Base 2 — week 1',
    focus: 'Threshold bike, seated climbing strength, longer long run. (Finals season — use the time modifications freely.)',
    days: [
      [rest(), mobility(20)],
      [B.bikeThreshold(4, 8, 4), ST('A', 'base')],
      [S.swimCSS(4, 300, 30, [2, 4]), R.runEasy(35)],
      [R.runCruise(4, 6, 90), ST('B', 'base')],
      [S.swimTechnique(2200)],
      sat(B.bikeLong(165, { climbing: true, blocks: [{ reps: 5, min: 6, recMin: 4, label: 'seated climbing (low cadence 65–75 rpm)', target: T.bike(0.85, 0.90, { rpe: [6, 7], cad: '65–75 rpm' }), note: 'Seated, quiet upper body; a force builder, not a sprint.' }], brickAfter: true }), R.runBrick(15)),
      [R.runLong(80)],
    ],
  },
  {
    n: 9, phase: 'base2', type: 'build', title: 'Base 2 — week 2',
    focus: 'Longer threshold reps, hill strength running.',
    days: [
      [rest(), mobility(20)],
      [B.bikeThreshold(3, 12, 5), ST('A', 'base')],
      [S.swimCSS(3, 400, 30, [3, 5], { extra: { text: '4 × 50 fast — 30 s rest', dist: 200, target: Z.swimFast } }), R.runEasy(40)],
      [R.runHills(8, 90), ST('B', 'base')],
      [S.swimEndurance(3, 500, 40)],
      sat(B.bikeLong(180, { blocks: [{ reps: 2, min: 25, recMin: 10, label: 'tempo / race power', target: T.bike(0.78, 0.85, { hr: [0.88, 0.93], rpe: [5, 6] }), note: 'Hold steady through rollers — no surges above 95% FTP.' }], brickAfter: true }), R.runBrick(20)),
      [R.runLong(85)],
    ],
  },
  {
    n: 10, phase: 'base2', type: 'build', title: 'Base 2 — week 3 (block peak)',
    focus: 'First sustained race-power work; first race-pace brick.',
    days: [
      [rest(), mobility(20)],
      [B.bikeThreshold(2, 20, 6), ST('A', 'base')],
      [S.swimCSS(15, 100, 10, [0, 2]), R.runEasy(40)],
      [R.runCruise(3, 10, 120), ST('B', 'base')],
      [S.swimOWSkills(2200)],
      sat(B.bikeLong(180, { blocks: [{ reps: 3, min: 20, recMin: 5, label: 'race power', target: Z.bikeRace }], brickAfter: true }), R.runBrick(20, { racePaceMin: 10 })),
      [R.runLong(90)],
    ],
  },
  {
    n: 11, phase: 'base2', type: 'recovery', title: 'Recovery + retest (Christmas week)',
    focus: 'Christmas Day is rest. CSS retest Wed, run threshold retest Sat.',
    deload: {
      volume: '≈53% less than Week 10 (11.4 h → 5.4 h). The largest cut of the plan because Base 2 added threshold density and the holidays bring travel and disrupted sleep.',
      keeps: 'Short threshold touch on the bike (3 × 6 min), CSS retest, run retest.',
      removed: 'Long ride shortened to 1:45 easy (moved to Sunday); no brick; no long run; Friday (Christmas) rest.',
      lifting: 'One deload session (Tue) only — holidays; loads ~90%, sets halved.',
      structure: 'Rest Mon + Fri; tests Wed/Sat when fresh.',
      markers: 'Sleep, resting HR, and motivation. Holiday food is welcome — this is not a week to restrict.',
    },
    days: [
      [rest()],
      [B.bikeThreshold(3, 6, 4), ST('A', 'deload')],
      [S.swimCSSTest()],
      [R.runEasy(35, { strides: 4 })],
      [rest('Christmas Day — rest and celebrate.')],
      [R.runTest()],
      [B.bikeLong(105, { ctx: 'Easy aerobic ride, no targets.', priority: PRIORITY.support })],
    ],
  },
  {
    n: 12, phase: 'build1', type: 'build', title: 'Build 1 — week 1',
    focus: 'VO₂ bike, longer race-power blocks, race pace on the long run. Strength: heavy, lower volume.',
    days: [
      [rest(), mobility(20)],
      [B.bikeVO2(5, 3, 3, 10), ST('A', 'build')],
      [S.swimCSS(4, 400, 30, [3, 5]), R.runEasy(40)],
      [R.runCruise(2, 15, 180), ST('B', 'build')],
      [S.swimEndurance(3, 600, 40)],
      sat(B.bikeLong(180, { blocks: [{ reps: 3, min: 20, recMin: 5, label: 'race power', target: Z.bikeRace }], brickAfter: true }), R.runBrick(20, { racePaceMin: 10 })),
      [R.runLong(90, { blocks: [{ reps: 1, min: 15, label: 'at 70.3 race pace (final segment)', target: Z.runHIM }] })],
    ],
  },
  {
    n: 13, phase: 'build1', type: 'build', title: 'Build 1 — week 2',
    focus: 'Longer VO₂ reps; hill simulation in the long ride.',
    days: [
      [rest(), mobility(20)],
      [B.bikeVO2(5, 4, 4), ST('A', 'build')],
      [S.swimCSS(20, 100, 10, [1, 3]), R.runEasy(40)],
      [R.runVO2(5, 3, 2), ST('B', 'build')],
      [S.swimOWSkills(2400)],
      sat(B.bikeLong(195, { climbing: true, blocks: [{ reps: 2, min: 30, recMin: 10, label: 'race power', target: Z.bikeRace }, { reps: 4, min: 3, recMin: 3, label: 'seated hill simulation', target: T.bike(0.95, 1.0, { rpe: [7, 8], cad: '70–80 rpm' }) }], brickAfter: true }), R.runBrick(25)),
      [R.runLong(95)],
    ],
  },
  {
    n: 14, phase: 'build1', type: 'build', title: 'Build 1 — week 3 (block peak)',
    focus: '75 min of race power on the long ride; 20 min race-pace brick.',
    days: [
      [rest(), mobility(20)],
      [B.bikeVO2(4, 5, 5), ST('A', 'build')],
      [S.swimEndurance(3, 600, 40, { plus: [4, 6] }), R.runEasy(40)],
      [R.runCruise(3, 12, 120), ST('B', 'build')],
      [S.swimTechnique(2200)],
      sat(B.bikeLong(210, { blocks: [{ reps: 3, min: 25, recMin: 5, label: 'race power', target: Z.bikeRace }], brickAfter: true }), R.runBrick(30, { racePaceMin: 20 })),
      [R.runLong(100, { blocks: [{ reps: 2, min: 15, recMin: 5, label: 'at 70.3 race pace', target: Z.runHIM }] })],
    ],
  },
  {
    n: 15, phase: 'build1', type: 'recovery', title: 'Recovery + full retest',
    focus: 'CSS (Wed), run threshold (Thu), FTP (Sat). Mid-plan performance review.',
    deload: {
      volume: '≈46% less than Week 14 (11.9 h → 6.4 h). Build 1 carried the plan\'s first high-intensity density; a full test battery needs fresh legs.',
      keeps: 'Three benchmark tests and short strides; one CSS touch through the test itself.',
      removed: 'Long ride → FTP test + easy brick; long run → 70 min easy; VO₂ work removed.',
      lifting: 'Two deload sessions — same loads (~90%), sets halved — then re-test e1RM next week only if fresh.',
      structure: 'Rest Mon; tests spaced Wed/Thu/Sat with easy days between.',
      markers: 'Compare morning HR, sleep, and the "legs" feeling to Week 7 and 11. Persisting heaviness → extend recovery 2–3 days before Build 2.',
    },
    days: [
      [rest()],
      [B.bikeEndurance(50, { drills: 'cadence' }), ST('A', 'deload')],
      [S.swimCSSTest()],
      [R.runTest(), ST('B', 'deload', { after: 'Light — after the run test, 2 sets only.' })],
      [S.swimEasy(1400)],
      sat(B.bikeFTPTest(), R.runBrick(10)),
      [R.runLong(70, { priority: PRIORITY.support })],
    ],
  },
  {
    n: 16, phase: 'build2', type: 'build', title: 'Race-specific build — week 1',
    focus: 'Rolling-terrain over-unders; 80 min race power with full race fueling. Strength: one heavy + one short session.',
    days: [
      [rest(), mobility(20)],
      [B.bikeOverUnder(3, 12, 5), ST('A', 'race')],
      [S.swimEndurance(2, 800, 60, { plus: [4, 6] }), R.runEasy(40)],
      [R.runCruise(4, 8, 120), ST('B', 'race')],
      [S.swimOWSkills(2400)],
      sat(B.bikeLong(195, { blocks: [{ reps: 2, min: 40, recMin: 10, label: 'race power — full race fueling (80–90 g/h)', target: Z.bikeRace }], brickAfter: true }), R.runBrick(30, { racePaceMin: 20 })),
      [R.runLong(100, { blocks: [{ reps: 3, min: 15, recMin: 5, label: 'at 70.3 race pace', target: Z.runHIM }] })],
    ],
  },
  {
    n: 17, phase: 'build2', type: 'build', title: 'Race-specific build — week 2',
    focus: 'Longest long run (105 min). 90 min race power.',
    days: [
      [rest(), mobility(20)],
      [B.bikeOverUnder(3, 15, 5), ST('A', 'race')],
      [S.swimCSS(5, 300, 20, [2, 4], { extra: { text: '300 continuous sighting every 6 strokes', dist: 300, target: Z.swimRace } }), R.runEasy(40)],
      [R.runCruise(5, 7, 90), ST('B', 'race')],
      [S.swimEndurance(3, 600, 30, { plus: [4, 6] })],
      sat(B.bikeLong(210, { blocks: [{ reps: 1, min: 60, label: 'race power', target: Z.bikeRace }, { reps: 1, min: 30, label: 'race power', target: Z.bikeRace }], brickAfter: true }), R.runBrick(35, { racePaceMin: 25 })),
      [R.runLong(105, { blocks: [{ reps: 1, min: 30, label: 'at 70.3 race pace (final 30 min)', target: Z.runHIM }] })],
    ],
  },
  {
    n: 18, phase: 'build2', type: 'build', title: 'Race-specific build — week 3 (block peak)',
    focus: '2 × 45 min race power + 40 min brick — the hardest weekend before the peak simulation.',
    days: [
      [rest(), mobility(20)],
      [B.bikeThreshold(2, 15, 5), ST('A', 'race')],
      [S.swimEndurance(1, 1500, 0, { plus: [4, 7] }), R.runEasy(40)],
      [R.runCruise(2, 15, 180), ST('B', 'race')],
      [S.swimOWSkills(2400)],
      sat(B.bikeLong(210, { blocks: [{ reps: 2, min: 45, recMin: 10, label: 'race power — rehearse race nutrition exactly', target: Z.bikeRace }], brickAfter: true }), R.runBrick(40, { racePaceMin: 30 })),
      [R.runLong(90, { ctx: 'All easy — yesterday was the key session.' })],
    ],
  },
  {
    n: 19, phase: 'build2', type: 'recovery', title: 'Absorb + final benchmarks',
    focus: 'CSS (Wed) and FTP (Sat) to set final race targets. Optional open-water test swim if conditions are safe.',
    deload: {
      volume: '≈45% less than Week 18 (11.2 h → 6.2 h). Enough to absorb Build 2 and test fresh, while short intensity keeps you race-sharp for next week\'s simulation.',
      keeps: 'Short threshold run touch, CSS test, FTP test, 15-min easy brick.',
      removed: 'Long ride → FTP test; long run → 75 min easy; over-unders removed.',
      lifting: 'One maintenance session (Tue), loads kept, 2 sets.',
      structure: 'Rest Mon; tests Wed/Sat; long easy Sunday.',
      markers: 'Race targets are set from these tests — only accept results from a genuinely fresh day.',
    },
    days: [
      [rest()],
      [B.bikeEndurance(50, { drills: 'cadence' }), ST('A', 'race')],
      [S.swimCSSTest()],
      [R.runEasy(40, { strides: 6 })],
      [S.swimOWSkills(2000, { ctx: 'If a safe, supervised open-water option exists (wetsuit, buddy, tow buoy, water ≳55–60 °F), swim 20–30 min there instead.' })],
      sat(B.bikeFTPTest(), R.runBrick(15)),
      [R.runLong(75, { priority: PRIORITY.support })],
    ],
  },
  {
    n: 20, phase: 'peak', type: 'peak', title: 'Peak — race simulation',
    focus: 'Saturday half-distance simulation: 2:45 ride with 90 min race power + 45 min run (30 min race pace). Last heavy lift.',
    days: [
      [rest(), mobility(20)],
      [B.bikeOverUnder(2, 12, 5), ST('A', 'peak')],
      [S.swimRaceRehearsal(1900), R.runEasy(40)],
      [R.runCruise(3, 10, 120)],
      [S.swimTechnique(1800, { ctx: 'Easy before the simulation.' })],
      sat(B.bikeLong(165, { raceSim: true, blocks: [{ reps: 1, min: 90, label: 'race power — race kit, race nutrition, race position', target: Z.bikeRace }], brickAfter: true }), R.runBrick(45, { racePaceMin: 30 })),
      [R.runEasy(60, { ctx: 'Recovery long run — easy only.', priority: PRIORITY.support })],
    ],
  },
  {
    n: 21, phase: 'taper', type: 'taper', title: 'Taper',
    focus: 'Same rhythm, shorter sessions, intensity kept. Final strength session Tuesday.',
    deload: {
      volume: '≈34% below the Build 2 average (11.5 h → 7.7 h), then ≈70% below in race week excluding the race itself — a 2-week progressive taper (Bosquet 2007 found 8–14 days with 41–60% volume reduction most effective).',
      keeps: 'Race-pace bike, threshold run reps, race-pace swimming — intensity and frequency maintained (Mujika & Padilla 2003).',
      removed: 'Long-ride duration (3:30 → 2:00); long run (105 → 60 min); second strength session.',
      lifting: 'One short session, ~80% loads, ≥10 days before race.',
      structure: 'Same weekly pattern so routine and sleep stay stable.',
      markers: 'Expect restless "taper legs." Fatigue should fall; resting HR and mood should improve. Do not add sessions.',
    },
    days: [
      [rest()],
      [B.bikeOpener(60, { raceWeek: false }), ST('A', 'taper')],
      [S.swimCSS(3, 500, 30, [3, 5]), R.runEasy(30)],
      [R.runCruise(4, 5, 90)],
      [S.swimOWSkills(1900)],
      sat(B.bikeLong(120, { blocks: [{ reps: 2, min: 20, recMin: 5, label: 'race power', target: Z.bikeRace }], brickAfter: true }), R.runBrick(20, { racePaceMin: 15 })),
      [R.runLong(60, { blocks: [{ reps: 3, min: 8, recMin: 2, label: 'at 70.3 race pace', target: Z.runHIM }] })],
    ],
  },
  {
    n: 22, phase: 'race', type: 'race', title: 'Race week',
    focus: 'Openers, logistics, sleep, carbohydrate loading (7–10 g/kg in the final 24–36 h is optional; practised foods only).',
    deload: {
      volume: '≈70% below Build 2 volume (≈3 h of training before the race).',
      keeps: 'Race-pace touches in every discipline.',
      removed: 'All long sessions and strength.',
      lifting: 'None — mobility and activation only.',
      structure: 'Tue bike + short brick, Wed swim, Thu run, Fri travel/practice swim, Sat check-in shake-out, Sun race.',
      markers: 'Sleep (bank extra this week — race morning loses an hour to daylight saving), calm mind, appetite normal.',
    },
    days: [
      [rest('Race week begins. Print or save the Race-Day screen.')],
      [B.bikeOpener(50), R.runShakeout(15, { ctx: 'Off the bike — a mini brick.' })],
      [S.swimRaceWeek()],
      [R.runRaceIntervals(4, 2, 90)],
      [S.swimEasy(1000, { ctx: 'Practice swim in Lewisville Lake if the official practice swim is offered; otherwise pool or rest. Travel/packet pickup.' })],
      [B.bikeRecoverySpin(20, 'Pre-race spin with 3 × 1 min at race power. Then bike check-in.'), R.runShakeout(10, { ctx: 'Pre-race shake-out.' })],
      [raceDay()],
    ],
  },
];
