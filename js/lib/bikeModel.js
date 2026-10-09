// Physics-based bike-split model (standard cycling power equation, as used by
// Martin et al.-style models): P·η = v·(m·g·(Crr·cosθ + sinθ)) + ½·ρ·CdA·(v + v_wind)²·v
// The course is approximated as a gently rolling sinusoidal profile totalling the official
// ~1,400 ft (427 m) of gain over 56 mi. This is a MODEL with stated assumptions, not a measurement.

const G = 9.80665;

export const COURSE = {
  distanceM: 90123,
  gainM: 427, // ≈1,400 ft per official course page
  wavelengthM: 6000, // assumed spacing of rollers
  segmentM: 250,
};

export const CDA_PRESETS = {
  tri: { label: 'Tri/TT bike, aero position', range: [0.26, 0.29, 0.33] },
  roadClipons: { label: 'Road bike + clip-on aero bars', range: [0.29, 0.32, 0.36] },
  road: { label: 'Road bike, hoods/drops', range: [0.34, 0.38, 0.43] },
};

/** Speed (m/s) for power P on grade, solved by bisection. Headwind positive. */
export function speedForPower(P, { mass, cda, crr = 0.0045, rho = 1.18, grade = 0, wind = 0, eta = 0.975, vmax = 20 }) {
  const theta = Math.atan(grade);
  const resist = (v) => v * mass * G * (crr * Math.cos(theta) + Math.sin(theta)) + 0.5 * rho * cda * (v + wind) * Math.abs(v + wind) * v;
  const target = P * eta;
  let lo = 0.5;
  let hi = vmax;
  if (resist(hi) < target) return vmax; // descents: capped by safety / braking
  if (resist(lo) > target) return lo; // very steep: walking-pace floor (not expected on this course)
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (resist(mid) > target) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Generates the synthetic rolling profile as an array of grades. */
export function courseGrades(course = COURSE) {
  const n = Math.round(course.distanceM / course.segmentM);
  const cycles = course.distanceM / course.wavelengthM;
  const amp = course.gainM / (2 * cycles); // total ascent = 2·A per cycle
  const grades = [];
  let prevH = 0;
  for (let i = 1; i <= n; i += 1) {
    const x = i * course.segmentM;
    const h = amp * Math.sin((2 * Math.PI * x) / course.wavelengthM);
    grades.push((h - prevH) / course.segmentM);
    prevH = h;
  }
  return grades;
}

/**
 * Simulate the course at a target average power. Power varies modestly with grade
 * (+/- up to ~8%), reflecting good rolling-terrain pacing (Swain 1997), then is rescaled so the
 * time-weighted average matches the target. Wind: half the course into a headwind, half tail.
 */
export function simulateBike({ avgPower, mass, cda, crr = 0.0045, rho = 1.18, wind = 0, vmaxDescent = 15.5, course = COURSE }) {
  const grades = courseGrades(course);
  const seg = course.segmentM;
  const run = (scale) => {
    let t = 0;
    let work = 0;
    grades.forEach((g, i) => {
      const w = i < grades.length / 2 ? wind : -wind;
      const p = Math.max(0, avgPower * scale * (1 + Math.max(-0.5, Math.min(0.08, g * 4))));
      const v = speedForPower(p, { mass, cda, crr, rho, grade: g, wind: w, vmax: vmaxDescent });
      const dt = seg / v;
      t += dt;
      work += p * dt;
    });
    return { t, avg: work / t };
  };
  // Rescale so time-weighted average power equals avgPower.
  let scale = 1;
  for (let k = 0; k < 4; k += 1) {
    const r = run(scale);
    scale *= avgPower / r.avg;
  }
  const r = run(scale);
  return { timeSec: r.t, avgPower: r.avg, avgSpeedMps: course.distanceM / r.t };
}
