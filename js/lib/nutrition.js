// Nutrition calculations (evidence-based ranges; see docs §Nutrition).
// Thomas/Erdman/Burke 2016; Burke 2011; Jäger 2017; Jeukendrup 2014; Sawka 2007; McCubbin 2020; Mountjoy 2023.

export const CARB_G_PER_KG = {
  rest: [3, 5],
  light: [4, 5], // <1 h easy
  moderate: [5, 7], // ~1 h/day moderate–high intensity
  high: [6, 10], // 1–3 h/day
  veryHigh: [8, 12], // >4 h/day (race-sim days, carb loading)
};
export const PROTEIN_G_PER_KG = [1.6, 2.2];

/** Classify a plan day's carbohydrate need from planned minutes and intensity. */
export function dayCarbClass(day) {
  const min = day.sessions.reduce((a, s) => a + (s.sport === 'strength' || s.sport === 'mobility' ? 0 : s.durationMin || 0), 0);
  const hard = day.sessions.some((s) => s.intensity === 'hard' || s.intensity === 'test');
  if (day.sessions.some((s) => s.sport === 'race')) return 'veryHigh';
  if (min === 0) return 'rest';
  if (min >= 180) return 'veryHigh';
  if (min >= 90) return 'high';
  if (min >= 60 || hard) return 'moderate';
  return 'light';
}

export function dailyTargets(weightKg, carbClass) {
  if (!(weightKg > 0)) return null;
  const c = CARB_G_PER_KG[carbClass];
  return {
    carbs: [Math.round(c[0] * weightKg), Math.round(c[1] * weightKg)],
    protein: [Math.round(PROTEIN_G_PER_KG[0] * weightKg), Math.round(PROTEIN_G_PER_KG[1] * weightKg)],
    proteinPerMeal: [Math.round(0.3 * weightKg), Math.round(0.4 * weightKg)],
    carbClass,
  };
}

/** Sweat rate (L/h) from pre/post nude body mass (kg), fluid in (L), urine out (L), duration (h). */
export function sweatRate({ preKg, postKg, fluidL = 0, urineL = 0, hours }) {
  if (!(preKg > 0 && postKg > 0 && hours > 0)) return null;
  const lossL = preKg - postKg + fluidL - urineL;
  return { rateLph: lossL / hours, pctLoss: ((preKg - postKg) / preKg) * 100, lossL };
}

/** Race fueling plan from target g/h and expected bike/run durations. */
export function raceFuelingPlan({ bikeSec, runSec, bikeGph = 75, runGph = 50, sweatLph = null }) {
  const bikeH = bikeSec / 3600;
  const runH = runSec / 3600;
  return {
    bikeCarbs: Math.round(bikeGph * bikeH),
    runCarbs: Math.round(runGph * runH),
    bikeFluidL: sweatLph ? +(Math.min(1.0, sweatLph * 0.7) * bikeH).toFixed(1) : null,
    note: 'Drink to thirst within your practised range; avoid gaining weight during the race (hyponatremia risk) and avoid losing >2–3% body mass.',
  };
}
