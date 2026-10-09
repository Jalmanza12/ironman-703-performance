// Running sessions. Pace targets are multiples of validated threshold pace (30-min TT),
// with run-LTHR heart-rate and RPE as alternatives. Run course: 3 loops, crushed gravel,
// officially "flat and fast".

import { T, Z, PRIORITY, session, fueling, MOD_ILLNESS } from './common.js';

const RUN_EQUIP = 'Daily trainers, GPS watch, HR strap (wrist HR is unreliable during intervals).';
const STRIDES = (n, sec = 20) => ({ text: `${n} × ${sec} s strides / 60–90 s walk-jog`, target: T.rpe(6, 7), note: 'Fast and relaxed — about 5K effort, not a sprint. Tall posture, quick light feet.' });
const RUN_WU = [
  { text: '10 min easy jog', target: Z.runEasy },
  { text: 'Drills: 2 × 20 m each — A-skips, high knees, butt kicks, carioca', target: T.rpe(3, 4) },
  STRIDES(4),
];
const RUN_WU_MIN = 17;

function mods(extra = {}) {
  return {
    fatigue: 'If fatigue ≥7/10, soreness ≥6/10 or sleep <6 h: run easy for 60–70% of the time, no intervals.',
    weather: 'Heat >85 °F: run early, slow pace targets by 10–20 s/mi and use HR/RPE. Ice or lightning: treadmill at 1% grade.',
    time: 'Keep the warm-up, cut the main set by one-third.',
    illness: MOD_ILLNESS,
    ...extra,
  };
}

export function runEasy(min, { strides = 0, ctx = '', priority = PRIORITY.support, title } = {}) {
  const main = [{ text: `${min - (strides ? 6 : 0)} min easy continuous`, target: Z.runEasy, note: 'Easy means you could hold a full conversation. Walk breaks on hills are fine if HR rises above target.' }];
  if (strides) main.push(STRIDES(strides));
  return session({
    sport: 'run', intensity: 'easy', title: title || `Easy aerobic run — ${min} min${strides ? ' + strides' : ''}`, type: 'Easy run', priority,
    objective: 'Build running durability and aerobic economy at low injury risk.',
    purpose: `Easy running volume strengthens tendons, bones, and aerobic economy — the foundation for running well off the bike. Keeping easy runs truly easy preserves energy for the sessions that matter (Seiler 2010). ${ctx}`.trim(),
    durationMin: min, plannedRPE: 3,
    main, zone: 'Z1–Z2', terrain: 'Soft or mixed surfaces; include crushed-gravel trail when possible (race surface).', equipment: RUN_EQUIP,
    fueling: fueling(min, 'easy'),
    cues: ['Cadence quick and light (no overstriding)', 'Relaxed hands and jaw', 'Nose-breathing test: if you cannot, slow down'],
    success: ['HR stayed under the Z2 ceiling (or RPE ≤3)', 'Finished feeling you could do more'],
    modifications: mods({ fatigue: 'Replace with 30 min walk or bike spin; easy runs are the first sessions to cut when tired.' }),
  });
}

function intervalRun({ title, type, objective, purpose, sets, cd = 10, rpe = 7, zone, terrain, cues, success, priority = PRIORITY.key, extraMain = [] }) {
  let m = 0;
  const main = [];
  for (const s of sets) {
    m += s.reps * s.min + (s.reps - 1) * (s.recMin ?? 0);
    main.push({ text: `${s.reps} × ${s.label}`, target: s.target, rest: s.rec, note: s.note });
  }
  for (const e of extraMain) {
    m += e.min;
    main.push(e);
  }
  const total = Math.round(RUN_WU_MIN + m + cd);
  return session({
    sport: 'run', intensity: 'hard', title: `${title} — ${total} min`, type, priority, objective, purpose,
    durationMin: total, plannedRPE: rpe, warmup: RUN_WU, main,
    cooldown: [{ text: `${cd} min easy jog + 5 min walk`, target: Z.runEasy }],
    zone, terrain: terrain || 'Flat loop, track, or crushed-gravel trail; treadmill at 1% acceptable.', equipment: RUN_EQUIP,
    fueling: fueling(total, 'hard'), cues, success, modifications: mods(),
  });
}

export const runHills = (reps, sec, { ctx = '' } = {}) => intervalRun({
  title: `Hill repeats ${reps} × ${sec} s`, type: 'Hill strength', rpe: 7,
  objective: 'Build running-specific strength and economy with low impact.',
  purpose: `Uphill running loads the calves, glutes, and hips with less impact than flat speed work and improves economy and power. It also teaches effort-based pacing on rises. ${ctx}`.trim(),
  sets: [{ reps, min: sec / 60, recMin: (sec * 1.5) / 60, label: `${sec} s uphill (4–7% grade) at RPE 8`, target: T.rpe(7, 8), rec: 'Walk/jog back down (≈1.5× the rep time)', note: 'Drive the knee, push the ground back, stay tall. Same effort each rep, not the same speed.' }],
  zone: 'Effort-based (RPE 7–8)', terrain: 'Steady 4–7% hill (60–100 m). Treadmill at 5–6% works.',
  cues: ['Short, quick steps', 'Arms drive forward and back', 'Relaxed descent — practice light, quick steps downhill'],
  success: ['Consistent effort across reps', 'No calf or Achilles pain during or next morning'],
});

export const runCruise = (reps, min, recSec, { ctx = '' } = {}) => intervalRun({
  title: `Threshold cruise intervals ${reps} × ${min} min`, type: 'Threshold intervals', rpe: 7,
  objective: 'Raise lactate threshold / critical speed — the ceiling under your 70.3 run pace.',
  purpose: `Threshold work raises the speed you can sustain before fatigue accelerates (critical speed; Jones & Vanhatalo 2017). Your off-the-bike half-marathon pace is a fraction of it, so a higher ceiling makes race pace easier. ${ctx}`.trim(),
  sets: [{ reps, min, recMin: recSec / 60, label: `${min} min at threshold`, target: Z.runThreshold, rec: `${recSec} s easy jog`, note: '"Comfortably hard": controlled, rhythmic breathing; the last rep should be the best one.' }],
  zone: 'Z4 threshold',
  cues: ['Even splits — the first rep is where pacing discipline is built', 'Relax shoulders on every lap'],
  success: ['All reps within the pace/HR range', 'Last rep ≤3 s/mi slower than the first'],
});

export const runVO2 = (reps, min, recMin) => intervalRun({
  title: `VO₂ intervals ${reps} × ${min} min`, type: 'VO₂max intervals', rpe: 8,
  objective: 'Improve aerobic power and running economy at speed.',
  purpose: 'A small dose of hard running (≈3–5K race effort) improves economy and raises the ceiling over threshold — kept brief so it does not compromise long runs.',
  sets: [{ reps, min, recMin, label: `${min} min hard`, target: Z.runVO2, rec: `${recMin} min easy jog`, note: 'Strong and smooth, never strained.' }],
  zone: 'Z5 (VO₂)', cues: ['Fast cadence', 'Hips tall, light ground contact'],
  success: ['Consistent pace across reps', 'Form held to the final rep'],
});

export const runRaceIntervals = (reps, min, recSec) => intervalRun({
  title: `Race-pace intervals ${reps} × ${min} min`, type: 'Race-pace', rpe: 5,
  objective: 'Groove 70.3 run pace and rhythm.',
  purpose: 'Rehearses goal pace on fresh-ish legs so it becomes automatic. Off the bike you will need to recognise it by feel and HR, not by forcing the watch.',
  sets: [{ reps, min, recMin: recSec / 60, label: `${min} min at 70.3 race pace`, target: Z.runHIM, rec: `${recSec} s easy`, note: 'Lock in the feel: breathing, cadence, effort.' }],
  zone: '70.3 race pace', rpe: 5,
  cues: ['Practice taking a gel at race pace', 'Relaxed, efficient stride'],
  success: ['Pace within range at RPE ≤6'], priority: PRIORITY.key,
});

export function runTest() {
  return session({
    sport: 'run', intensity: 'test', title: '30-minute run threshold test — 60 min', type: 'Benchmark test', priority: PRIORITY.key,
    objective: 'Establish threshold pace and run LTHR to personalise every run target.',
    purpose: 'Friel\'s 30-minute solo time trial estimates threshold pace (average pace) and LTHR (average HR of the final 20 min). These anchor run zones and the run-split prediction.',
    durationMin: 60, plannedRPE: 9,
    warmup: [{ text: '15 min easy', target: Z.runEasy }, STRIDES(4), { text: '3 min easy', target: Z.runEasy }],
    main: [{ text: '30 min solo time trial — as fast as you can evenly sustain', target: T.rpe(9, 9), note: 'Press LAP at 10 min. Record total distance, average pace, and average HR for the final 20 min. Most athletes start too fast — the first 5 min should feel controlled.' }],
    cooldown: [{ text: '10 min easy jog', target: Z.runEasy }],
    zone: 'Test', terrain: 'Flat, uninterrupted route or 400 m track. Same route each retest. No treadmill (pace calibration varies).',
    equipment: 'GPS watch + chest HR strap.', fueling: fueling(60, 'test'),
    cues: ['Rested: no hard session in the prior 48 h', 'Even pacing — think "negative split"'],
    success: ['Last 10 min ≥ first 10 min pace', 'Entered on the Benchmarks page'],
    modifications: mods({ fatigue: 'Reschedule 1–3 days — a tired test produces zones that are too slow for weeks.', weather: 'Heat >80 °F or strong wind distorts pace — move to early morning or a track; record conditions.' }),
    test: 'run',
  });
}

export function runLong(min, { blocks = [], ctx = '', priority = PRIORITY.key } = {}) {
  const blockMin = blocks.reduce((a, b) => a + b.reps * b.min + (b.reps - 1) * (b.recMin ?? 0), 0);
  const easy = min - blockMin - 5;
  const main = [{ text: `${blocks.length ? Math.round(easy * 0.65) : easy} min easy aerobic`, target: Z.runZ2, note: 'First 10 min easier than you think — practice the patience you need on race day.' }];
  for (const b of blocks) main.push({ text: `${b.reps} × ${b.min} min ${b.label}`, target: b.target, rest: b.recMin ? `${b.recMin} min easy jog` : undefined, note: b.note });
  if (blocks.length) main.push({ text: `${easy - Math.round(easy * 0.65)} min easy`, target: Z.runZ2 });
  return session({
    sport: 'run', intensity: 'long', title: `Long run — ${min} min${blocks.length ? ' with race-pace work' : ''}`, type: 'Long run', priority,
    objective: 'Extend running durability so pace holds in the final 5K of the race.',
    purpose: `The 70.3 run is decided by durability: holding form and pace after 3+ hours of racing. Long runs build musculoskeletal resilience and fat oxidation; race-pace segments late in the run rehearse running well while fatigued. ${ctx}`.trim(),
    durationMin: min, plannedRPE: blocks.length ? 5 : 4,
    warmup: [{ text: '5 min walk → easy jog', target: Z.runEasy }],
    main, zone: blocks.length ? 'Z2 + 70.3 race pace' : 'Z2 aerobic',
    terrain: 'Flat-to-gently-rolling, ideally crushed gravel/trail (race surface). Loop past your car or a water fountain for fluids.',
    equipment: `${RUN_EQUIP} Handheld/belt with fluids and gels for runs >75 min.`,
    fueling: fueling(min, 'long'),
    cues: ['Run the hills by effort, not pace', 'Gel practice at the times you will take them in the race', 'Check form every 10 min: tall, relaxed, quick'],
    success: ['Pace in the final 20 min ≥ the first 20 min at similar effort', 'HR drift <5% in the easy portion (where pace is steady)', 'No pain that alters gait'],
    modifications: mods({ fatigue: 'Run 60–70% of the duration, all easy, no race-pace blocks.', time: 'Keep at least 75% of the duration; race-pace blocks stay.' }),
  });
}

/** Run off the bike. */
export function runBrick(min, { racePaceMin = 0, ctx = '' } = {}) {
  const easy = min - racePaceMin;
  const main = [];
  if (racePaceMin) {
    main.push({ text: `First ${racePaceMin} min at 70.3 race pace`, target: Z.runHIM, note: 'First 3–5 min: quick, short steps; let the legs come around. Do not chase pace in mile 1 — that is the Waco lesson.' });
    if (easy > 0) main.push({ text: `${easy} min easy`, target: Z.runZ2 });
  } else {
    main.push({ text: `${min} min steady aerobic off the bike`, target: Z.runZ2, note: 'Focus on cadence (≈170–180 spm) in the first 5 min.' });
  }
  return session({
    sport: 'run', brick: true, intensity: racePaceMin ? 'hard' : 'moderate', title: `Brick run — ${min} min${racePaceMin ? ` (${racePaceMin} min race pace)` : ''}`, type: 'Brick run',
    priority: racePaceMin ? PRIORITY.key : PRIORITY.support,
    objective: 'Adapt to running on pre-fatigued legs and practise T2.',
    purpose: `Running economy is impaired immediately after cycling (Millet & Vleck 2000). Regular brick runs train the cycle-to-run transition and teach you to judge race pace when your legs lie to you. ${ctx}`.trim(),
    durationMin: min, plannedRPE: racePaceMin ? 6 : 4,
    warmup: [{ text: 'T2 practice: rack bike, helmet off, shoes on, go — target <2 min', target: T.rpe(3, 3) }],
    main, cooldown: [{ text: '5 min walk', target: T.rpe(1, 1) }],
    zone: racePaceMin ? '70.3 race pace' : 'Z2',
    terrain: 'Flat loop starting where you finish the ride.', equipment: 'Race shoes with elastic laces, race belt, visor, gel.',
    fueling: ['Take a gel or 20–25 g carbohydrate in the first 10 min if the run is ≥30 min (practice race-day timing).', 'Drink at a "simulated aid station" every ~1 mile/10 min.'],
    cues: ['Short quick steps for the first 5 min', 'Pace by HR/RPE first, then the watch', 'Note how race pace feels — this calibrates race day'],
    success: ['Hit pace without exceeding the HR ceiling', 'Transition <2 min', 'Log RPE and how legs felt at 5 min vs. 15 min'],
    modifications: mods({ fatigue: 'Run 10 min easy only, or walk 10 min.', time: '10 min minimum — the transition itself is the stimulus.' }),
  });
}

export function runShakeout(min, { ctx = '' } = {}) {
  return session({
    sport: 'run', intensity: 'easy', title: `Shake-out run — ${min} min`, type: 'Shake-out', priority: PRIORITY.optional,
    objective: 'Loosen up and stay sharp without fatigue.', purpose: `Keeps rhythm during the taper. ${ctx}`.trim(),
    durationMin: min, plannedRPE: 2,
    main: [{ text: `${min - 3} min very easy`, target: Z.runEasy }, STRIDES(3, 15)],
    zone: 'Z1', terrain: 'Flat', equipment: 'Race shoes (confirm they feel right).', fueling: fueling(min, 'easy'),
    cues: ['Feel light and quick'], success: ['Felt better at the end than at the start'],
    modifications: mods({ fatigue: 'Walk 15 min instead.' }),
  });
}
