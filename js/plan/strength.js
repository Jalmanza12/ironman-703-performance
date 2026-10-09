// Strength, mobility, rest and race-day sessions.
// Evidence: heavy strength training improves cycling & running economy/performance without
// compromising endurance when programmed sensibly (Rønnestad & Mujika 2014; Beattie 2014;
// Balsalobre-Fernández 2016). Strength can be maintained with ~1 session/week if intensity
// (load) is preserved while volume falls (Rønnestad 2010; Spiering 2021).

import { T, PRIORITY, session, MOD_ILLNESS } from './common.js';

// Phase prescriptions. `main` applies to primary lifts; `acc` to accessories.
export const STRENGTH_PHASES = {
  intro: { label: 'Re-introduction', main: { sets: 2, reps: '8–10', rir: '4', rest: '90 s' }, acc: { sets: 2, reps: '10–12', rir: '3–4', rest: '60 s' }, load: 'Light: ~60–65% of your usual working weight. Re-groove patterns after the race; zero soreness is the goal.' },
  baseline: { label: 'Baseline benchmarks', main: { sets: 3, reps: '5', rir: '2', rest: '2–3 min' }, acc: { sets: 2, reps: '8–10', rir: '3', rest: '60–90 s' }, load: 'Work up over 3–4 sets to a load you can lift for 5 reps with 2 in reserve. Log load × reps — this estimates 1RM (e1RM) for tracking.' },
  base: { label: 'Strength development', main: { sets: 4, reps: '5–6', rir: '2–3', rest: '2–3 min' }, acc: { sets: 3, reps: '6–10', rir: '2–3', rest: '90 s' }, load: 'Heavy but crisp: increase load 2–5% when all sets reach the top of the rep range at RIR ≥2.' },
  deload: { label: 'Deload', main: { sets: 2, reps: '5', rir: '4', rest: '2 min' }, acc: { sets: 1, reps: '8', rir: '4', rest: '60 s' }, load: 'Keep load at ~90% of last week; halve the sets. Leave feeling fresh.' },
  build: { label: 'Strength maintenance (heavy, lower volume)', main: { sets: 3, reps: '4–5', rir: '2–3', rest: '2–3 min' }, acc: { sets: 2, reps: '6–8', rir: '3', rest: '90 s' }, load: 'Hold last block\'s loads — maintaining intensity preserves strength while volume falls.' },
  race: { label: 'Race-specific maintenance', main: { sets: 2, reps: '3–5', rir: '3', rest: '2–3 min' }, acc: { sets: 2, reps: '6–8', rir: '3', rest: '90 s' }, load: 'Same heavy loads, fewer sets. Never to failure.' },
  peak: { label: 'Peak maintenance', main: { sets: 2, reps: '3', rir: '3–4', rest: '2–3 min' }, acc: { sets: 1, reps: '6–8', rir: '4', rest: '60 s' }, load: '~85–90% of block loads. Crisp, fast reps.' },
  taper: { label: 'Final strength touch', main: { sets: 2, reps: '3', rir: '4', rest: '2 min' }, acc: { sets: 1, reps: '8', rir: '4', rest: '60 s' }, load: '~80% of block loads; last lifting session ≥10 days before race day.' },
};

const A_MAIN = [
  { name: 'Trap-bar deadlift (or barbell RDL if no trap bar)', why: 'Posterior-chain force for climbing and run propulsion', cue: 'Brace, push the floor away, neutral spine' },
  { name: 'Rear-foot-elevated split squat (per leg)', why: 'Single-leg strength and hip stability for running', cue: 'Front shin near vertical, control the descent 2–3 s' },
];
const A_ACC = [
  { name: 'Pull-up / chin-up (assisted if needed)', why: 'Upper-back strength for swim catch and aero posture', cue: 'Full hang to chin over bar; ribs down' },
  { name: 'Standing calf raise — slow (3 s down)', why: 'Gastrocnemius strength/Achilles resilience', cue: 'Full range; pause at the top' },
  { name: 'Bent-knee (seated) soleus raise', why: 'Soleus takes the highest loads in running', cue: 'Knee bent ~90°, heavy load, slow' },
  { name: 'Pallof press (per side)', why: 'Anti-rotation trunk control for run stability and aero bars', cue: 'Press out, hold 2 s, resist rotation' },
];
const B_MAIN = [
  { name: 'Back squat or goblet/safety-bar squat', why: 'Quad & glute strength for bike force and descents', cue: 'Controlled depth you own, brace' },
  { name: 'Dumbbell bench press or push-up variation', why: 'Upper-body maintenance; shoulder balance for swimming', cue: 'Shoulder blades set, 2 s lower' },
];
const B_ACC = [
  { name: 'Single-leg RDL (per leg)', why: 'Hamstring/glute strength & balance for gait', cue: 'Hips square; reach long' },
  { name: 'One-arm dumbbell row (per side)', why: 'Pulling strength & posture', cue: 'Pull to the hip; no torso twist' },
  { name: 'Step-up to knee drive (per leg)', why: 'Running-specific single-leg power', cue: 'Drive through the whole foot' },
  { name: 'Copenhagen side plank (per side, seconds)', why: 'Adductor strength — groin resilience (soccer history)', cue: 'Start short-lever (knee) and progress' },
  { name: 'Dead bug', why: 'Deep trunk control', cue: 'Low back stays down' },
];

function rx(list, p) {
  return list.map((e) => ({ ...e, sets: p.sets, reps: e.name.includes('seconds') ? '20–30 s' : p.reps, rir: p.rir, rest: p.rest }));
}

export function strengthSession(variant, phaseKey, { ctx = '', after = '' } = {}) {
  const p = STRENGTH_PHASES[phaseKey];
  let main = variant === 'A' ? A_MAIN : B_MAIN;
  let acc = variant === 'A' ? A_ACC : B_ACC;
  if (phaseKey === 'race' && variant === 'B') {
    main = [B_MAIN[1]];
    acc = [B_ACC[2], B_ACC[3], A_ACC[2]];
  }
  if (phaseKey === 'peak' || phaseKey === 'taper') {
    main = [A_MAIN[0], B_MAIN[0]];
    acc = [A_ACC[2], B_ACC[3]];
  }
  const exercises = [...rx(main, p.main), ...rx(acc, p.acc)];
  const setsTotal = exercises.reduce((a, e) => a + e.sets, 0);
  const min = Math.round(10 + setsTotal * 2.4);
  const label = phaseKey === 'peak' || phaseKey === 'taper' ? 'Full body' : variant === 'A' ? 'A — lower-body pull + upper pull' : 'B — squat + upper push + single-leg';
  return session({
    sport: 'strength', intensity: phaseKey === 'deload' || phaseKey === 'intro' || phaseKey === 'taper' ? 'easy' : 'moderate',
    title: `Strength ${label} — ${p.label}`, type: 'Strength', durationMin: min, plannedRPE: phaseKey === 'base' || phaseKey === 'baseline' ? 7 : 5,
    priority: phaseKey === 'taper' ? PRIORITY.optional : PRIORITY.support,
    objective: 'Preserve (and initially build) strength, power, and tissue resilience alongside endurance training.',
    purpose: `Heavy, low-rep strength work improves cycling and running economy and late-race power without the bulk endurance athletes fear (Rønnestad & Mujika 2014; Beattie 2014). It also protects the strength you value. Volume falls as the race approaches but load is kept, because intensity — not volume — preserves strength (Spiering 2021). ${ctx}`.trim(),
    warmup: [
      { text: '5 min easy bike/row + 5 min dynamic mobility: leg swings, world\'s greatest stretch, glute bridges, band pull-aparts', target: T.rpe(2, 3) },
      { text: 'Ramp-up sets on the first lift: 2–3 progressively heavier sets of 3–5', target: T.rpe(3, 5) },
    ],
    main: exercises.map((e) => ({ text: `${e.name}: ${e.sets} × ${e.reps} @ RIR ${e.rir}, rest ${e.rest}`, note: `${e.why}. Cue: ${e.cue}.` })),
    cooldown: [{ text: '5 min: hip-flexor stretch, calf stretch, thoracic rotations', target: T.rpe(1, 2) }],
    exercises, loadGuidance: p.load, phase: phaseKey,
    zone: `RIR ${p.main.rir} on main lifts`, terrain: 'Gym.', equipment: 'Trap bar/barbell, dumbbells, bench, pull-up bar, cable or band.',
    fueling: ['Have 25–35 g protein within ~2 h after lifting (spread protein across 4–5 meals daily).'],
    cues: ['Quality over grinding: never to failure', 'Move the weight with intent on the way up; control down', after || 'Lift after the endurance session (≥3–6 h later if possible) to protect key endurance quality'],
    success: ['All sets at the prescribed RIR', 'Log load × reps for the main lifts (strength tracking)', 'No soreness that affects the next day\'s run'],
    modifications: {
      fatigue: 'Do main lifts only (2 sets) at the same load; skip accessories. Do not drop the load first — drop sets.',
      weather: '—', time: 'Main lifts + calf/soleus only (≈25 min).',
      illness: MOD_ILLNESS,
    },
  });
}

export function mobility(min = 20, { ctx = '' } = {}) {
  return session({
    sport: 'mobility', intensity: 'easy', title: `Mobility & tissue care — ${min} min`, type: 'Mobility', priority: PRIORITY.optional,
    objective: 'Maintain range of motion for aero position, swim stroke, and stride.',
    purpose: `Hip-flexor, thoracic, and ankle mobility support an aero position you can hold and a relaxed stride. Low cost, high return on a rest day. ${ctx}`.trim(),
    durationMin: min, plannedRPE: 1,
    main: [
      { text: '90/90 hip switches — 2 × 8 per side', target: T.rpe(1, 2) },
      { text: 'Half-kneeling hip-flexor stretch with reach — 2 × 45 s per side', target: T.rpe(1, 2) },
      { text: 'Thoracic open-books — 2 × 8 per side', target: T.rpe(1, 2) },
      { text: 'Knee-to-wall ankle mobilisation — 2 × 10 per side', target: T.rpe(1, 2) },
      { text: 'Band shoulder dislocates + wall slides — 2 × 10', target: T.rpe(1, 2) },
      { text: 'Calf/soleus stretch (straight and bent knee) — 2 × 45 s per side', target: T.rpe(1, 2) },
    ],
    zone: 'Recovery', terrain: 'Home', equipment: 'Mat, band, optional foam roller.',
    fueling: ['Rest days still need carbohydrate (≈3–5 g/kg) and protein (≈1.6–2.0 g/kg) — recovery happens today.'],
    cues: ['Slow breathing; no pain'], success: ['Done, and you feel looser'],
    modifications: { fatigue: 'Optional — skip if you need sleep more.', weather: '—', time: '10 min version: first three exercises.', illness: MOD_ILLNESS },
  });
}

export function rest(ctx = '') {
  return session({
    sport: 'rest', intensity: 'rest', title: 'Rest day', type: 'Rest', priority: PRIORITY.key, durationMin: 0,
    objective: 'Absorb training. Adaptation happens during recovery, not during the workout.',
    purpose: `Planned rest prevents the slow slide into fatigue that ruins key sessions. Sleep 7–9 h, eat normally (do not "save calories" on rest days), walk if you like. ${ctx}`.trim(),
    main: [{ text: 'No structured training. Optional: 20–30 min easy walk outdoors.', target: T.rpe(1, 1) }],
    zone: 'Rest', terrain: '—', equipment: '—',
    fueling: ['Carbohydrate ≈3–5 g/kg (250–415 g at 83 kg); protein ≈1.6–2.0 g/kg (135–165 g) spread over 4–5 meals.', 'Hydrate normally; pale-yellow urine is a reasonable everyday check.'],
    cues: ['Bedtime 30 min earlier than usual', 'Fill in the daily check-in (sleep, fatigue, soreness)'],
    success: ['You actually rested'],
    modifications: { fatigue: '—', weather: '—', time: '—', illness: MOD_ILLNESS },
  });
}

export function raceDay() {
  return session({
    sport: 'race', intensity: 'race', title: 'RACE DAY — IRONMAN 70.3 Dallas–Little Elm', type: 'Race', priority: PRIORITY.key,
    durationMin: 305, plannedRPE: 7,
    objective: 'Execute the plan: controlled swim, disciplined bike, strong final 5K.',
    purpose: 'Everything since October 5 was built for today. Your fitness is set — execution decides the result. Open the Race-Day screen for splits, power/pace bands, fueling, and checklists.',
    warmup: [
      { text: 'Wake 3–3.5 h before start (remember: clocks spring forward tonight). Breakfast 1–2 g/kg carbohydrate (~80–160 g), familiar foods.', target: T.rpe(1, 1) },
      { text: '10 min easy jog + arm swings, or 5–10 min easy swim if a warm-up area is available', target: T.rpe(2, 3) },
    ],
    main: [
      { text: 'Swim 1.2 mi: seed yourself honestly in the rolling start; first 200 controlled; sight every 6–8 strokes; draft where legal and safe', target: T.swim(3, 6, { rpe: [5, 6] }) },
      { text: 'Bike 56 mi: first 15 min below race power; then race power; climbs ≤ ~95% FTP briefly; eat & drink on schedule', target: T.bike(0.75, 0.80, { hr: [0.86, 0.92], rpe: [5, 6] }) },
      { text: 'Run 13.1 mi: mile 1–2 at 10–15 s/mi slower than goal; settle at goal pace/HR; decide at mile 10 whether to accelerate', target: T.run(1.06, 1.11, { hr: [0.89, 0.94], rpe: [5, 8] }) },
    ],
    cooldown: [{ text: 'Walk, eat, rehydrate. Thank God and the volunteers.', target: T.rpe(1, 1) }],
    zone: 'Race', terrain: 'Lewisville Lake / North Texas rolling roads / Little Elm trail (crushed gravel)', equipment: 'See Race-Day checklist.',
    fueling: ['Bike: 60–90 g/h carbohydrate (what you practised), fluid to thirst/sweat rate, sodium per your sweat test.', 'Run: 40–60 g/h (gels + course drinks), water at every aid station, cola/caffeine late if practised.'],
    cues: ['Race your plan, not other athletes', 'Patience is a weapon'],
    success: ['Executed the pacing plan', 'Fueled on schedule', 'Ran the final 5K as strong or stronger than the first'],
    modifications: { fatigue: '—', weather: 'Strong wind: pace by power/HR, not speed. Heat: slow run pace by HR, more cooling. Cold water: warm up on land, start calmly.', time: '—', illness: MOD_ILLNESS },
  });
}

export function recoveryWalk(min = 30, ctx = '') {
  return session({
    sport: 'other', intensity: 'easy', title: `Recovery walk — ${min} min`, type: 'Recovery', priority: PRIORITY.optional, durationMin: min, plannedRPE: 1,
    objective: 'Gentle movement after the race.', purpose: `Post-race recovery: muscle damage from a 70.3 run takes days to resolve. Walking helps without delaying repair. ${ctx}`.trim(),
    main: [{ text: `${min} min easy walk outdoors`, target: T.rpe(1, 2) }],
    zone: 'Recovery', terrain: 'Flat', equipment: '—',
    fueling: ['Prioritise carbohydrate and protein at each meal (≈1.6–2.0 g/kg protein/day) and sleep.'],
    cues: ['Notice any pain that is not normal post-race soreness'], success: ['Done'],
    modifications: { fatigue: 'Rest instead.', weather: 'Indoors/mall walk.', time: 'Any amount.', illness: MOD_ILLNESS },
  });
}
