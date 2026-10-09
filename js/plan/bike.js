// Cycling sessions. Power targets are % of validated FTP; HR (× bike LTHR) and RPE are
// secondary/alternative targets. Course context: ~1,400 ft gain over 56 mi, gently rolling,
// often windy (official course page; 2026 race report).

import { T, Z, PRIORITY, session, fueling, MOD_ILLNESS } from './common.js';

const BIKE_EQUIP = 'Smart trainer or quiet road loop; power meter if available, HR strap, two bottles, fan indoors.';
const WARMUP_STD = [
  { text: '10 min progressive spin', target: Z.bikeZ2, note: 'Start at RPE 2 and finish at the top of endurance.' },
  { text: '3 × 1 min high-cadence spin-ups (100–110 rpm) / 1 min easy', target: T.rpe(3, 4), note: 'Smooth pedal stroke; no bouncing in the saddle.' },
  { text: '3 min easy', target: Z.bikeRecovery },
];
const WARMUP_MIN = 19;

function cooldown(min = 10) {
  return [{ text: `${min} min easy spin, cadence 90+`, target: Z.bikeRecovery }];
}

export function bikeRecoverySpin(min = 30, ctx = '') {
  return session({
    sport: 'bike', intensity: 'easy', title: `Recovery spin — ${min} min`, type: 'Recovery ride',
    priority: PRIORITY.optional,
    objective: 'Promote blood flow and recovery without adding meaningful training stress.',
    purpose: `Light movement speeds the feeling of recovery and keeps the habit alive. ${ctx}`.trim(),
    durationMin: min,
    main: [{ text: `${min} min continuous, flat route or trainer`, target: Z.bikeRecovery, note: 'If HR drifts above the target or legs feel heavy, shorten it — this ride should leave you fresher.' }],
    zone: 'Z1 (active recovery)',
    terrain: 'Flat; trainer is ideal.', equipment: BIKE_EQUIP,
    fueling: fueling(min, 'easy'),
    cues: ['Light hands, relaxed shoulders', 'Cadence 90+ with almost no pressure on the pedals'],
    success: ['Finished feeling better than you started', 'Never exceeded RPE 3'],
    modifications: { fatigue: 'Replace with a 20-min walk or full rest.', weather: 'Trainer.', time: 'Any duration ≥15 min still helps; skipping is acceptable.', illness: MOD_ILLNESS },
  });
}

export function bikeEndurance(min, { drills = 'cadence', ctx = '', priority = PRIORITY.support } = {}) {
  const mainMin = min - 15;
  const main = [];
  if (drills === 'cadence') {
    main.push({ text: `${mainMin - 12} min steady endurance`, target: Z.bikeZ2 });
    main.push({ text: '6 × 1 min fast cadence (105–115 rpm) / 1 min normal cadence', target: T.rpe(3, 5), note: 'Builds neuromuscular smoothness — stay seated and quiet through the hips.' });
  } else if (drills === 'single-leg') {
    main.push({ text: `${mainMin - 12} min steady endurance`, target: Z.bikeZ2 });
    main.push({ text: '4 × (1 min right leg / 1 min left leg / 1 min both) — trainer only', target: T.rpe(3, 4), note: 'Eliminate the dead spot at the top of the stroke. Outdoors: replace with 4 × 3 min at 75 rpm in a big gear.' });
  } else {
    main.push({ text: `${mainMin} min steady endurance`, target: Z.bikeZ2 });
  }
  return session({
    sport: 'bike', intensity: 'easy', title: `Aerobic endurance ride — ${min} min`, type: 'Endurance + skills',
    priority,
    objective: 'Build aerobic capacity and pedaling efficiency at low physiological cost.',
    purpose: `Most of a 70.3 bike is ridden in the aerobic domain. Low-intensity volume builds the engine (mitochondrial and capillary adaptations) that lets you hold race power with less fatigue. ${ctx}`.trim(),
    durationMin: min,
    warmup: [{ text: '10 min progressive', target: Z.bikeZ2 }],
    main, cooldown: [{ text: '5 min easy', target: Z.bikeRecovery }],
    zone: 'Z2 (endurance)', terrain: 'Flat to gently rolling; trainer fine.', equipment: BIKE_EQUIP,
    fueling: fueling(min, 'easy'),
    cues: ['Conversational effort the whole time', 'Smooth circles; no mashing on small rises'],
    success: ['Power/HR stayed in Z2 for ≥90% of the main set', 'HR drift small on a steady effort'],
    modifications: { fatigue: 'Cut to 30–40 min all Z1–Z2, skip drills.', weather: 'Trainer.', time: 'Minimum 40 min; keep the drill block, trim steady riding.', illness: MOD_ILLNESS },
  });
}

/** Generic interval session. sets: [{reps, min, target, label, rec, recMin, note}] */
function intervalSession({ title, type, objective, purpose, sets, extraMain = [], cd = 10, priority = PRIORITY.key, cues, success, zone, terrain, mods, intensity = 'hard', rpe = 7 }) {
  let mainMin = 0;
  const main = [];
  for (const s of sets) {
    const work = s.reps * s.min;
    const rest = (s.reps - 1) * (s.recMin ?? 0);
    mainMin += work + rest + (s.after ?? 0);
    main.push({ text: `${s.reps} × ${s.min} min ${s.label}`, target: s.target, rest: s.rec, note: s.note });
    if (s.after) main.push({ text: `${s.after} min easy between sets`, target: Z.bikeRecovery });
  }
  for (const e of extraMain) {
    mainMin += e.min;
    main.push(e);
  }
  const total = Math.round(WARMUP_MIN + mainMin + cd);
  return session({
    sport: 'bike', intensity, title: `${title} — ${total} min`, type, priority, objective, purpose,
    durationMin: total, plannedRPE: rpe,
    warmup: WARMUP_STD, main, cooldown: cooldown(cd), zone,
    terrain: terrain || 'Trainer preferred for control; or a flat/steady road without stops.',
    equipment: BIKE_EQUIP, fueling: fueling(total, 'hard'),
    cues, success,
    modifications: {
      fatigue: 'If sleep <6 h, fatigue ≥7/10 or the first rep is a struggle at the low end of the target: drop one rep per set and cap effort at the bottom of the range. If two reps in a row miss by >5%, stop and ride Z2 — that is data, not failure.',
      weather: 'Do it indoors. Outdoor wind makes steady power hard; use a flat, safe loop if you must ride outside.',
      time: mods?.time || 'Keep warm-up to 12 min and complete two-thirds of the work; do not rush the recoveries.',
      illness: MOD_ILLNESS,
    },
  });
}

export function bikeFTPTest() {
  return session({
    sport: 'bike', intensity: 'test', title: '20-minute FTP test — 65 min', type: 'Benchmark test', priority: PRIORITY.key,
    objective: 'Establish a validated FTP so every power target in the plan becomes personal.',
    purpose: 'Without a measured FTP all bike targets are provisional. FTP anchors training zones, race power, and the bike-split prediction. Retesting every 4–8 weeks shows whether the bike plan is working.',
    durationMin: 65, plannedRPE: 9,
    warmup: [
      { text: '15 min progressive endurance', target: Z.bikeZ2 },
      { text: '3 × 1 min fast cadence / 1 min easy', target: T.rpe(4, 5) },
      { text: '5 min at threshold effort (RPE 7) to open up', target: T.rpe(7, 7) },
      { text: '10 min easy', target: Z.bikeRecovery },
    ],
    main: [
      { text: '20 min maximal sustainable effort — even pacing', target: T.rpe(9, 9), note: 'Start at what you believe is sustainable (RPE ~8) for 5 min, settle, and only push in the final 5 min. Record average power, average HR for the full 20 min, and cadence.' },
    ],
    cooldown: cooldown(12),
    zone: 'Test', terrain: 'Trainer (ERG off) or a safe, flat, uninterrupted road — use the same setup for every retest.',
    equipment: 'Power meter or smart trainer required for FTP. Without power: record average HR of the 20 min (approximates bike LTHR) and use HR + RPE targets.',
    fueling: fueling(65, 'test'),
    cues: ['Well rested: no hard training in the prior 48 h', 'Same time of day, bike, and trainer as future retests', 'Fan on high'],
    success: ['Even or slightly negative split (last 5 min ≥ first 5 min)', 'Data entered on the Benchmarks page — FTP ≈ 95% of 20-min average power'],
    modifications: {
      fatigue: 'If unusually tired, move the test 1–2 days later — a test on tired legs produces wrong zones for 4+ weeks.',
      weather: 'Indoors.', time: 'Do not shorten the warm-up; reschedule instead.', illness: MOD_ILLNESS,
    },
    test: 'ftp',
  });
}

export const bikeSweetSpot = (reps, min, recMin) => intervalSession({
  title: `Sweet-spot ${reps} × ${min} min`, type: 'Sweet-spot intervals', rpe: 6,
  objective: 'Raise sustainable power (muscular endurance) with manageable fatigue.',
  purpose: 'Sweet-spot work (88–93% FTP) builds the ability to hold steady power for long periods — the core of a 56-mile bike split — while costing less recovery than full threshold work in the base phase.',
  sets: [{ reps, min, label: 'sweet spot', target: Z.bikeSweetSpot, rec: `${recMin} min easy spin`, recMin, note: 'Seated, steady, aero position for the second half of each rep if your bike allows.' }],
  zone: 'Sweet spot (88–93% FTP)', cues: ['Steady, not surging: power line should be flat', 'Breathe low and controlled; you could speak short phrases'],
  success: ['All reps inside the target range', 'Last rep power within 3% of the first', 'RPE ≤7'],
});

export const bikeThreshold = (reps, min, recMin) => intervalSession({
  title: `Threshold ${reps} × ${min} min`, type: 'Threshold intervals', rpe: 8,
  objective: 'Lift FTP so race power (75–80% FTP) becomes a smaller fraction of your ceiling.',
  purpose: 'Raising FTP is the most direct way to ride faster at the same relative effort. If FTP rises 5%, the same 77% race intensity is ~5% more watts — roughly 3–5 minutes over 56 miles — without costing your run.',
  sets: [{ reps, min, label: 'at threshold', target: Z.bikeThreshold, rec: `${recMin} min easy spin`, recMin, note: 'Settle into the range within 60 s; do not start above it.' }],
  zone: 'Z4 threshold (95–100% FTP)', cues: ['Even pacing across reps', 'Relax the upper body; tension wastes energy'],
  success: ['≥90% of interval time within range', 'Final rep completed without dropping >5%'],
});

export const bikeVO2 = (reps, min, recMin, extraTempoMin = 0) => intervalSession({
  title: `VO₂max ${reps} × ${min} min`, type: 'VO₂max intervals', rpe: 9,
  objective: 'Raise the aerobic ceiling (VO₂max) that supports future FTP gains.',
  purpose: 'A small dose of high-intensity work alongside mostly easy riding is a hallmark of successful endurance training (Seiler 2010). It raises the ceiling under threshold and race power.',
  sets: [{ reps, min, label: 'hard', target: Z.bikeVO2, rec: `${recMin} min very easy`, recMin, note: 'Hard but repeatable — the last rep should match the first.' }],
  extraMain: extraTempoMin ? [{ min: 5, text: '5 min easy', target: Z.bikeRecovery }, { min: extraTempoMin, text: `${extraTempoMin} min steady at race power`, target: Z.bikeRace, note: 'Practice settling into race power while fatigued.' }] : [],
  zone: 'Z5 VO₂max (106–115% FTP)', cues: ['Cadence 90–100', 'Full recoveries — quality over grit'],
  success: ['All reps ≥106% FTP (or RPE 8–9)', 'Power fade across reps ≤5%'],
});

export const bikeOverUnder = (reps, blockMin, recMin) => intervalSession({
  title: `Rolling-terrain over-unders ${reps} × ${blockMin} min`, type: 'Race-specific over-unders', rpe: 7,
  objective: 'Teach controlled power on rolling terrain: brief rises above race power without blowing up.',
  purpose: 'The Little Elm course rewards steady power on gradual inclines and descents. Over-unders rehearse the exact skill you missed at Waco: going slightly harder on rises (≤100% FTP, briefly), then recovering at race power rather than coasting or surging.',
  sets: [{ reps, min: blockMin, label: `continuous: alternate 2 min @ 95–100% FTP ("rise") / 2 min @ 78–82% FTP ("roll")`, target: T.bike(0.78, 1.0, { rpe: [6, 8], cad: 'Rises 75–85 rpm, rolls 85–95 rpm' }), rec: `${recMin} min easy`, recMin, note: 'Never above 100% FTP. Shift early before each rise.' }],
  zone: 'Race power ↔ threshold', terrain: 'Trainer, or a road with 1–3 min rises.',
  cues: ['Shift before the rise, not halfway up', 'Over the top: keep pedaling into the descent'],
  success: ['No spikes above 105% FTP', '"Roll" segments stayed at race power, not below 70%'],
});

/** Long ride. blocks: [{reps, min, target, label, recMin}] embedded in Z2 riding. */
export function bikeLong(min, { blocks = [], ctx = '', brickAfter = false, raceSim = false, climbing = false, priority = PRIORITY.key } = {}) {
  const blockMin = blocks.reduce((a, b) => a + b.reps * b.min + (b.reps - 1) * (b.recMin ?? 0), 0);
  const steady = min - 20 - 10 - blockMin;
  const main = [];
  const firstZ2 = Math.max(15, Math.round(steady * 0.4));
  main.push({ text: `${firstZ2} min endurance`, target: Z.bikeZ2, note: 'First fuel at 20 min. Settle in; this is where Waco-style over-pacing starts if you let it.' });
  for (const b of blocks) {
    main.push({ text: `${b.reps} × ${b.min} min ${b.label}`, target: b.target, rest: b.recMin ? `${b.recMin} min endurance between` : undefined, note: b.note });
  }
  main.push({ text: `${Math.max(10, steady - firstZ2)} min endurance`, target: Z.bikeZ2, note: brickAfter ? 'Final 10 min: shift to an easier gear, spin 90+ rpm, finish the bottle — prepare legs for the brick.' : 'Hold form as fatigue builds.' });
  const kind = raceSim ? 'Race simulation' : blocks.length ? 'Long ride + race-specific blocks' : 'Long aerobic ride';
  return session({
    sport: 'bike', intensity: 'long', title: `${kind} — ${fmtH(min)}`, type: kind, priority,
    objective: raceSim ? 'Rehearse race pacing, position, fueling, and the transition to running.' : 'Extend aerobic durability and practice race nutrition.',
    purpose: `${climbing ? 'Climbing-specific blocks build force on gradual rises without surging. ' : ''}Long rides develop the fatigue resistance that decides the second half of the bike and the whole run. ${blocks.length ? 'Race-power blocks late in the ride teach you what 75–80% FTP feels like when you are already tired. ' : ''}${ctx}`.trim(),
    durationMin: min, plannedRPE: blocks.length ? 5 : 4,
    warmup: [{ text: '20 min progressive from easy to endurance', target: Z.bikeZ2 }],
    main, cooldown: [{ text: '10 min easy', target: Z.bikeRecovery }],
    zone: blocks.length ? 'Z2 with race-power / tempo blocks' : 'Z2 endurance',
    terrain: climbing ? 'Rolling route with 1–4 min rises (north of Little Elm toward Denton County is ideal), or trainer with grade simulation.' : 'Rolling route similar to the race (gradual rises, long open roads); stay in aero on safe straights. Trainer if weather or safety requires.',
    equipment: 'Race bike in race position, power meter/HR, race nutrition, saddle bag with tube/CO₂/levers, phone, ID.',
    fueling: fueling(min, 'long', { brickAfter }),
    cues: ['Eat every 20 min, drink every 10–15 min', 'In aero: chin down, shoulders relaxed, elbows narrow', 'On rises: shift early, hold power, do not chase speed', 'On descents: keep light pressure, do not coast if speed is low'],
    success: ['Normalized power ≤ 1.05 × average power (Variability Index ≤1.05) on steady segments', 'Hit fueling target (log grams/hour)', 'Blocks within target; final hour not slower than the first'],
    modifications: {
      fatigue: 'Remove the blocks and ride 70–80% of the duration in Z2. If fatigue is high for 2+ days, ride 60–75 min easy instead.',
      weather: 'Rain, ice, lightning, or wind gusts >25 mph: ride indoors at 80–90% duration (indoor riding is harder per minute — continuous pedaling, more heat).',
      time: 'Minimum 75% of duration with all blocks intact; trim endurance riding first.',
      illness: MOD_ILLNESS,
    },
  });
}

export function bikeOpener(min, { raceWeek = true } = {}) {
  return session({
    sport: 'bike', intensity: 'moderate', title: `Race-week opener — ${min} min`, type: 'Opener', priority: PRIORITY.key,
    objective: 'Maintain sharpness and confirm race power feels controlled while fatigue falls.',
    purpose: 'Tapering research supports cutting volume while keeping some intensity (Bosquet 2007; Mujika & Padilla 2003). Short race-pace efforts keep the engine tuned without adding fatigue.',
    durationMin: min, plannedRPE: 4,
    warmup: [{ text: '15 min progressive', target: Z.bikeZ2 }],
    main: [
      { text: '3 × 5 min at race power', target: Z.bikeRace, rest: '3 min easy', note: 'Note HR and RPE at race power; it should feel controlled.' },
      { text: '3 × 30 s at 110% FTP', target: T.bike(1.08, 1.12, { rpe: [7, 8], cad: '95–105 rpm' }), rest: '90 s easy' },
    ],
    cooldown: cooldown(raceWeek ? 8 : 10),
    zone: 'Race power + short openers', terrain: 'Race bike on the road if safe (check shifting, brakes, tire pressure).',
    equipment: 'Race bike exactly as it will be raced.', fueling: fueling(min, 'moderate'),
    cues: ['Do not test fitness — fitness is banked', 'Check every piece of equipment'],
    success: ['Race power felt like RPE 5', 'Bike mechanically perfect'],
    modifications: { fatigue: 'Ride 30 min easy with 2 × 3 min race power only.', weather: 'Trainer.', time: 'Minimum 30 min with the race-power reps.', illness: MOD_ILLNESS },
  });
}

export function fmtH(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, '0')} h` : `${h} h`;
}
