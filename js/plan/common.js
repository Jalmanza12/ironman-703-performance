// Shared building blocks for workout definitions.

export const T = {
  bike: (lo, hi, extra = {}) => ({ kind: 'bike', pct: [lo, hi], ...extra }),
  run: (fast, slow, extra = {}) => ({ kind: 'run', mult: [fast, slow], ...extra }),
  swim: (plusLo, plusHi, extra = {}) => ({ kind: 'swim', plus: [plusLo, plusHi], ...extra }),
  rpe: (a, b, extra = {}) => ({ kind: 'rpe', rpe: [a, b], ...extra }),
};

// Canonical targets reused across the plan.
export const Z = {
  bikeRecovery: T.bike(0.45, 0.55, { hr: [0.68, 0.80], rpe: [1, 2], cad: '85–95 rpm' }),
  bikeZ2: T.bike(0.62, 0.72, { hr: [0.81, 0.89], rpe: [3, 4], cad: '85–95 rpm' }),
  bikeTempo: T.bike(0.76, 0.85, { hr: [0.88, 0.93], rpe: [5, 6], cad: '85–92 rpm' }),
  bikeRace: T.bike(0.75, 0.80, { hr: [0.86, 0.92], rpe: [5, 6], cad: '82–92 rpm' }),
  bikeSweetSpot: T.bike(0.88, 0.93, { hr: [0.91, 0.96], rpe: [6, 7], cad: '85–95 rpm' }),
  bikeThreshold: T.bike(0.95, 1.0, { hr: [0.95, 1.0], rpe: [7, 8], cad: '85–95 rpm' }),
  bikeVO2: T.bike(1.06, 1.15, { rpe: [8, 9], cad: '90–100 rpm' }),
  runEasy: T.run(1.20, 1.32, { hr: [0.75, 0.86], rpe: [2, 3] }),
  runZ2: T.run(1.13, 1.22, { hr: [0.85, 0.89], rpe: [3, 4] }),
  runHIM: T.run(1.06, 1.11, { hr: [0.89, 0.93], rpe: [5, 6] }),
  runThreshold: T.run(0.99, 1.03, { hr: [0.95, 0.99], rpe: [7, 8] }),
  runVO2: T.run(0.93, 0.97, { rpe: [8, 9] }),
  swimEasy: T.swim(10, 18, { rpe: [2, 3] }),
  swimEnd: T.swim(5, 9, { rpe: [4, 5] }),
  swimRace: T.swim(3, 6, { rpe: [5, 6] }),
  swimCSS: T.swim(-1, 2, { rpe: [7, 8] }),
  swimFast: T.swim(-6, -2, { rpe: [8, 9] }),
};

export const PRIORITY = {
  key: 'Key — mandatory',
  support: 'Supporting — mandatory',
  optional: 'Optional',
  replaceable: 'Replaceable',
};

let seq = 0;
export function resetIds() {
  seq = 0;
}

/** Normalizes a session definition. */
export function session(def) {
  seq += 1;
  return {
    sport: 'other',
    intensity: 'easy', // rest | easy | moderate | hard | long | test | race
    priority: PRIORITY.support,
    warmup: [],
    main: [],
    cooldown: [],
    cues: [],
    success: [],
    modifications: {},
    ...def,
    seq,
  };
}

/** Evidence-based fueling guidance scaled to duration & intensity (Thomas 2016; Burke 2011; Jeukendrup 2014). */
export function fueling(min, intensity = 'easy', { brickAfter = false } = {}) {
  const lines = [];
  if (min < 60) {
    lines.push('Before: normal meal 2–3 h prior, or a 20–40 g carbohydrate snack 30–60 min prior if training early.');
    lines.push('During: water to thirst. No carbohydrate required.');
    if (intensity === 'hard' || intensity === 'test') lines.push('Optional: carbohydrate drink or mouth-rinse if training fasted.');
  } else if (min < 100) {
    lines.push('Before: 1 g/kg carbohydrate (~80 g) 1–3 h prior, e.g., oatmeal + banana + honey.');
    lines.push(intensity === 'easy'
      ? 'During: water to thirst; 0–30 g/h carbohydrate is fine for easy aerobic work.'
      : 'During: 30–60 g/h carbohydrate (one 500–750 mL bottle with ~40 g drink mix) — quality intervals deserve carbohydrate.');
  } else if (min < 150) {
    lines.push('Before: 1–2 g/kg carbohydrate (80–160 g) 2–3 h prior; familiar, low-fiber foods.');
    lines.push('During: 45–60 g/h carbohydrate starting at 20 min; 500–750 mL/h fluid adjusted to sweat rate and weather; ~300–600 mg sodium per liter.');
  } else {
    lines.push('Before: 1–2 g/kg carbohydrate (80–160 g) 2–4 h prior — rehearse your race breakfast.');
    lines.push('During: 60–90 g/h carbohydrate from glucose + fructose sources (build toward 80–90 g/h by the race-specific phase); 500–800 mL/h fluid adjusted to sweat rate; ~300–600 mg sodium per liter (more if you are a heavy/salty sweater).');
    lines.push('Log grams per hour and any GI symptoms — this is gut training.');
  }
  if (brickAfter) lines.push('Keep eating in the final 20 min of the ride — fuel for the run starts on the bike.');
  if (min >= 60 || intensity !== 'easy') lines.push('After: ~25–35 g protein + carbohydrate within ~1–2 h; if another key session is <24 h away, ~1–1.2 g/kg/h carbohydrate for the first few hours.');
  return lines;
}

export const MOD_ILLNESS = 'Pain that changes your gait or stroke, chest pain, unusual breathlessness, dizziness, fainting, fever, or illness below the neck: stop, do not train through it, and seek medical evaluation.';
