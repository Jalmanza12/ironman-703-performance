// Verified event facts for IRONMAN 70.3 Dallas–Little Elm.
// Source: official IRONMAN race + course pages, retrieved 2026-10-09.
// Anything marked `verified: false` is NOT confirmed by an official source and must be
// re-checked against the Athlete Guide when it is published.

export const RACE = {
  name: 'IRONMAN 70.3 Dallas–Little Elm',
  date: '2027-03-14',
  dayOfWeek: 'Sunday',
  location: 'Little Elm, TX (Dallas–Fort Worth metro)',
  edition: 'Second edition (inaugural race held March 15, 2026)',
  status: 'Registration open (per official page, retrieved 2026-10-09)',
  // Start time is NOT published on the official page. 7:30 a.m. appears only on a third-party listing.
  provisionalStartLocal: '07:30',
  // March 14 2027 is the day US daylight-saving time begins (2:00 → 3:00 a.m.). 7:30 CDT = 12:30 UTC.
  provisionalStartUtcMs: Date.UTC(2027, 2, 14, 12, 30, 0),
  startTimeVerified: false,
  sources: {
    racePage: 'https://www.ironman.com/races/im703-dallas-little-elm',
    coursePage: 'https://www.ironman.com/races/im703-dallas-little-elm/course',
    courseRules: 'https://www.ironman.com/races/im703-dallas-little-elm/course-rules',
    inauguralRecap: 'https://www.ironman.com/stories/race-content/grit-wrote-first-chapter-inaugural-ironman-703-dallas-little-elm',
  },
  swim: {
    distance: '1.2 mi (1.9 km)',
    description: 'One-loop swim in Lewisville Lake; start and finish at Little Elm Beach.',
    waterTemp: 'Historical March water 54–60 °F per course page; official race page lists average 66 °F (19 °C). 2026 race-day water: 66 °F.',
    wetsuit: 'High probability wetsuit-legal. IRONMAN age-group rule: wetsuit legal ≤ 76.1 °F (24.5 °C); mandatory below 60.8 °F (16 °C) — confirm in the 2027 rules / Athlete Guide.',
    note2026: 'In 2026 the swim was shortened to 350 m because of strong wind and weather. Train for the full 1.9 km anyway — a shortened swim cannot be planned for.',
    verified: true,
  },
  bike: {
    distance: '56 mi (90.1 km)',
    description: 'Heads north of Little Elm on quiet two-lane roads; open farmland, long smooth stretches, urban concrete sections; no chip seal.',
    elevationGainFt: 1400,
    character: 'Gently rolling — "steady rhythm of gradual inclines and descents that reward smart pacing and steady power" (official course page).',
    note2026: 'Strong wind in 2026. Pro winners rode 1:58:35 (men) and 2:22:48 (women) — wind is a real variable on open North Texas roads.',
    verified: true,
  },
  run: {
    distance: '13.1 mi (21.1 km)',
    description: 'Three loops on the Little Elm nature trail system: hard-packed crushed gravel; spectator-friendly.',
    character: 'Official course page: "flat and fast". The race header labels the run "Rolling". You described it as rolling. Treat it as mostly flat with short undulations until the course map/elevation file is reviewed.',
    surface: 'Crushed gravel (shoe choice and footing practice matter).',
    verified: true,
  },
  transition: {
    description: 'Transition map published on the official course page; details (distance from beach to T1, single vs split transition) are not stated in text. Confirm in the Athlete Guide.',
    verified: false,
  },
  weather: {
    officialSummary: 'Official race page: high 83 °F / low 63 °F; average water 66 °F.',
    history: [
      { year: 2026, high: 81, low: 56, water: 66, note: 'Race day — strong wind; swim shortened to 350 m.' },
      { year: 2025, high: 87, low: 64, water: null, note: 'Historical date weather (no race held).' },
      { year: 2024, high: 80, low: 70, water: null, note: 'Historical date weather (no race held).' },
    ],
    planningAssumption: 'Plan for a cool start (mid-50s to 60s °F) and a warm finish (upper 70s–80s °F) with meaningful wind. Heat matters on the run; cold matters for the swim and early bike.',
  },
  dst: 'US daylight-saving time begins at 2:00 a.m. on race morning — clocks jump forward one hour. Set alarms on a device that updates automatically and plan sleep for the lost hour.',
};

export const WACO = {
  name: 'IRONMAN 70.3 Waco',
  date: '2026-10-04',
  finish: '5:20 (athlete-reported)',
  note: 'Swim canceled (athlete-reported; not independently verified). Bike + run + transitions ≈ 5:20. Not a full-triathlon benchmark.',
};
