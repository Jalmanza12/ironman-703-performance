// Swim sessions. Distances are in pool units (yards or meters — set on the Profile page);
// intervals are written identically for both. Pace targets are CSS ± seconds per 100.
// CSS sits close to (often slightly above) maximal lactate steady state (Dekerle 2005), so
// "CSS" sets are threshold work, not easy swimming.

import { T, Z, PRIORITY, session, MOD_ILLNESS } from './common.js';

const SWIM_EQUIP = 'Goggles (clear + tinted), cap, pull buoy, paddles (optional), fins (for drills), tempo trainer optional.';

const WU = (d = 400) => [
  { text: `${d} easy freestyle, breathing every 3 strokes`, dist: d, target: Z.swimEasy },
  { text: '4 × 50 drill/swim by 25 (catch-up → fingertip drag) — 15 s rest', dist: 200, target: Z.swimEasy, note: 'Long body line; exhale fully underwater.' },
];
const CD = (d = 200) => [{ text: `${d} easy choice, long and relaxed`, dist: d, target: Z.swimEasy }];

const sumDist = (arr) => arr.reduce((a, s) => a + (s.dist || 0), 0);
// Approximate session time for an intermediate age-group swimmer (~2:00/100 incl. rest).
const estMin = (d) => Math.round((d / 100) * 2.05);

function swimSession({ title, type, objective, purpose, main, wu = WU(), cd = CD(), intensity = 'moderate', priority = PRIORITY.support, rpe = 5, cues, success, zone, ow = false, extra = {} }) {
  const dist = sumDist(wu) + sumDist(main) + sumDist(cd);
  return session({
    sport: 'swim', intensity, title: `${title} — ${dist}`, type, priority, objective, purpose,
    distance: dist, distanceUnit: 'pool', durationMin: estMin(dist), plannedRPE: rpe,
    warmup: wu, main, cooldown: cd, zone,
    terrain: ow ? 'Pool (50 m/long-course if available) or supervised open water — see safety notes.' : 'Pool.',
    equipment: SWIM_EQUIP,
    fueling: ['Before: light carbohydrate snack if early (e.g., banana/toast). During: water bottle on deck.', 'After: protein + carbohydrate meal within ~2 h.'],
    cues, success,
    modifications: {
      fatigue: 'Swap the main set for 6–8 × 100 easy with drills; swimming is a good "active recovery" day.',
      weather: 'Pool closed: replace with 20 min band/dryland pull work (straight-arm pulldowns, Y-T-W raises) + 20 min easy spin.',
      time: 'Keep warm-up 200 + main set; cut drill volume.',
      illness: MOD_ILLNESS,
    },
    ...extra,
  });
}

export const swimTechnique = (dist = 1800, { ctx = '' } = {}) => swimSession({
  title: 'Technique & feel', type: 'Technique', rpe: 3, intensity: 'easy',
  objective: 'Improve body position, catch, and breathing rhythm — free speed through efficiency.',
  purpose: `Swim speed in age-groupers is limited more by technique (drag, catch) than by fitness. Efficient strokes save energy for the bike and run. ${ctx}`.trim(),
  main: [
    { text: '6 × 50 kick on side with fins (25 each side) — 15 s rest', dist: 300, target: T.rpe(3, 4), note: 'Head in line, bottom arm extended, hips at the surface.' },
    { text: '6 × 50 "6-kick switch" drill — 15 s rest', dist: 300, target: Z.swimEasy, note: 'Six kicks on side, one stroke, rotate — teaches rotation and balance.' },
    { text: `${Math.max(2, Math.round((dist - 1100) / 100))} × 100 swim, focusing on one cue per 100 (high elbow catch → push past hip → exhale) — 15 s rest`, dist: Math.max(200, Math.round((dist - 1100) / 100) * 100), target: Z.swimEnd },
    { text: '4 × 25 fast with perfect form — 30 s rest', dist: 100, target: Z.swimFast },
  ],
  zone: 'Easy / aerobic with technique focus',
  cues: ['Press the chest down, hips up', 'Reach long, then catch with the forearm vertical', 'Exhale steadily underwater; quick inhale'],
  success: ['Stroke count per length stayed the same or dropped across the 100s', 'Felt smoother by the end'],
});

export const swimCSSTest = () => swimSession({
  title: 'CSS test (400 + 200 time trials)', type: 'Benchmark test', rpe: 9, intensity: 'test', priority: PRIORITY.key,
  objective: 'Measure Critical Swim Speed to personalise every swim pace.',
  purpose: 'CSS = 200 / (T400 − T200) per unit of distance. It anchors swim zones and the swim-split prediction. Retesting shows whether technique and fitness are translating into speed.',
  wu: [
    { text: '400 easy', dist: 400, target: Z.swimEasy },
    { text: '4 × 50 drill/swim — 15 s rest', dist: 200, target: Z.swimEasy },
    { text: '4 × 50 build to fast — 20 s rest', dist: 200, target: T.rpe(5, 8) },
    { text: '100 easy', dist: 100, target: Z.swimEasy },
  ],
  main: [
    { text: '400 time trial — push start, maximal even effort', dist: 400, target: T.rpe(9, 9), note: 'Record time. Pace evenly: second 200 within ~3 s of the first.' },
    { text: '200 very easy + 5–8 min rest (full recovery)', dist: 200, target: Z.swimEasy },
    { text: '200 time trial — maximal effort', dist: 200, target: T.rpe(9, 10), note: 'Record time. Enter both times on the Benchmarks page (pool unit matters).' },
  ],
  cd: CD(300), zone: 'Test',
  cues: ['Same pool & unit every retest', 'Push starts, no dives'],
  success: ['Both times recorded', 'T400 > 2 × T200 is normal; if not, the 200 was under-paced'],
  extra: { test: 'css' },
});

/** CSS-based threshold set. reps × dist at CSS+plusLo..plusHi with rest seconds. */
export const swimCSS = (reps, dist, restSec, plus = [0, 2], { extra, ctx = '' } = {}) => {
  const main = [
    { text: `${reps} × ${dist} @ CSS ${fmtPlus(plus)} — ${restSec} s rest`, dist: reps * dist, target: T.swim(plus[0], plus[1], { rpe: [6, 8] }), note: 'Even pace. Use the pace clock; stroke count steady.' },
    { text: '200 pull with buoy, easy-moderate', dist: 200, target: Z.swimEnd },
  ];
  if (extra) main.push(extra);
  return swimSession({
    title: `CSS set ${reps} × ${dist}`, type: 'Threshold (CSS)', rpe: 7, intensity: 'hard', priority: PRIORITY.key,
    objective: 'Raise sustainable swim speed (threshold).',
    purpose: `CSS work is the most time-efficient way for age-group triathletes to raise sustainable swim pace. A faster CSS means 70.3 race effort (CSS +3–6 s/100) costs less, so you exit the water fresher. ${ctx}`.trim(),
    main, zone: 'CSS / threshold',
    cues: ['Hold the same pace on every rep — the last one should not be the slowest', 'Rotate to breathe, do not lift the head'],
    success: ['≥80% of reps within target', 'Stroke count rose ≤2 per length late in the set'],
  });
};

/** Aerobic endurance with sighting; continuous / broken long swims. */
export const swimEndurance = (pieces, dist, restSec, { sight = true, plus = [5, 9], ctx = '' } = {}) => swimSession({
  title: `Endurance ${pieces} × ${dist}`, type: 'Aerobic endurance', rpe: 5, intensity: 'moderate', priority: PRIORITY.key,
  objective: 'Build the ability to swim the full 1.9 km continuously at controlled effort.',
  purpose: `You cannot predict a swim split until you can swim the distance comfortably. Longer repeats at aerobic pace build specific endurance and confidence. ${ctx}`.trim(),
  main: [
    { text: `${pieces} × ${dist} @ CSS ${fmtPlus(plus)} — ${restSec} s rest${sight ? '; sight every 6–8 strokes on the final 100 of each' : ''}`, dist: pieces * dist, target: T.swim(plus[0], plus[1], { rpe: [4, 6] }), note: 'Bilateral breathing; sight with "crocodile eyes" then rotate to breathe.' },
    { text: '4 × 50 descend 1→4 — 15 s rest', dist: 200, target: T.rpe(4, 8) },
  ],
  zone: 'Aerobic endurance', ow: sight,
  cues: ['Settle into rhythm within 100', 'Long exhale; relaxed kick (2-beat is fine in a wetsuit)'],
  success: ['Pace stable across repeats', 'Comfortable enough to continue'],
});

export const swimOWSkills = (dist = 2200, { ctx = '' } = {}) => swimSession({
  title: 'Open-water skills (pool)', type: 'Open-water skills', rpe: 5, intensity: 'moderate', priority: PRIORITY.support, ow: true,
  objective: 'Make open-water navigation, starts, drafting, and turns automatic.',
  purpose: `Poor sighting adds distance; a panicked start wrecks the first 300. These skills are rehearsable in a pool and directly reduce your swim time and stress. ${ctx}`.trim(),
  main: [
    { text: '4 × 100 sighting: lift eyes forward every 6 strokes, then every 4 — 15 s rest', dist: 400, target: Z.swimEnd, note: 'Pick a target on the far wall; eyes only just above water, then roll to breathe.' },
    { text: '6 × 50 "race start": first 15 strokes fast, then settle to race effort — 20 s rest', dist: 300, target: T.rpe(5, 8), note: 'Rehearse settling breathing after the surge — the critical skill for a calm start.' },
    { text: '4 × 100 drafting: swim on a partner\'s feet or hip (or sight on the lane line) — 15 s rest', dist: 400, target: Z.swimRace, note: 'Legal in age-group swim. Without a partner: practise swimming straight with eyes closed for 6 strokes, then sight.' },
    { text: `${Math.max(1, Math.round((dist - 1900) / 300))} × 300 continuous at race effort with mid-pool "buoy turn" (no wall push) each 100 — 30 s rest`, dist: Math.max(1, Math.round((dist - 1900) / 300)) * 300, target: Z.swimRace },
  ],
  zone: 'Race effort + skills',
  cues: ['Sight → breathe in one fluid motion', 'Turn at "buoys" by rolling onto your back briefly or a tight corkscrew'],
  success: ['Sighting without stopping the stroke', 'Calm breathing within 30 s of each start surge'],
});

export const swimRaceRehearsal = (dist = 1900, { ctx = '' } = {}) => swimSession({
  title: `Race rehearsal ${dist} continuous`, type: 'Race rehearsal', rpe: 6, intensity: 'hard', priority: PRIORITY.key, ow: true,
  objective: 'Prove you can swim the full race distance continuously at race effort.',
  purpose: `This is the single most important data point for the swim prediction: a continuous race-distance swim at controlled effort. Wetsuit allowed if your pool permits (practice in it at least once before race day). ${ctx}`.trim(),
  wu: [{ text: '300 easy + 4 × 25 build', dist: 400, target: Z.swimEasy }],
  main: [{ text: `${dist} continuous: first 200 settle, middle at race effort, sight every 8 strokes; final 200 slightly stronger`, dist, target: Z.swimRace, note: 'Record total time and 500-split times. This is the most reliable swim benchmark you will have.' }],
  cd: CD(200), zone: '70.3 race effort',
  cues: ['Patient first 200', 'Count strokes between sights'], success: ['Even 500 splits', 'Finished feeling ready to ride'],
});

export const swimEasy = (dist = 1200, { ctx = '' } = {}) => swimSession({
  title: 'Easy recovery swim', type: 'Recovery swim', rpe: 2, intensity: 'easy', priority: PRIORITY.optional,
  objective: 'Active recovery and feel for the water.', purpose: `Low-stress swimming aids recovery and keeps the stroke fresh. ${ctx}`.trim(),
  wu: [{ text: '300 easy', dist: 300, target: Z.swimEasy }],
  main: [{ text: `${Math.max(1, Math.round((dist - 500) / 100))} × 100 easy, alternating free / choice / pull — 15 s rest`, dist: Math.max(1, Math.round((dist - 500) / 100)) * 100, target: Z.swimEasy }],
  cd: CD(200), zone: 'Easy', cues: ['Long, relaxed strokes'], success: ['Felt better leaving than arriving'],
});

export const swimRaceWeek = () => swimSession({
  title: 'Race-week sharpener', type: 'Taper swim', rpe: 4, intensity: 'moderate', priority: PRIORITY.key,
  objective: 'Stay sharp and confident; rehearse starts and sighting.', purpose: 'Short race-pace work keeps the feel for the water while fatigue falls.',
  wu: [{ text: '300 easy + 4 × 50 drill', dist: 500, target: Z.swimEasy }],
  main: [
    { text: '4 × 200 @ race effort, sight every 8 strokes — 20 s rest', dist: 800, target: Z.swimRace },
    { text: '4 × 50: 15 strokes fast then settle — 30 s rest', dist: 200, target: T.rpe(5, 8) },
  ],
  cd: CD(200), zone: 'Race effort', cues: ['Calm, confident, smooth'], success: ['Felt fast and relaxed'],
});

function fmtPlus([a, b]) {
  const s = (n) => (n >= 0 ? `+${n}` : `${n}`);
  return `${s(a)} to ${s(b)} s/100`;
}
