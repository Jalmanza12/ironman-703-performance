import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, scenarioTotal, TARGET_SEC, predictRace, predictSwim, predictRun, openHalfMarathon, limiters } from '../js/lib/prediction.js';
import { speedForPower, simulateBike, courseGrades, COURSE } from '../js/lib/bikeModel.js';

test('scenario budgets sum correctly and target leaves margin under 5:15', () => {
  assert.equal(scenarioTotal(SCENARIOS.target), 5 * 3600 + 8 * 60 + 30);
  assert.equal(scenarioTotal(SCENARIOS.conservative), 5 * 3600 + 41 * 60);
  assert.equal(scenarioTotal(SCENARIOS.stretch), 4 * 3600 + 49 * 60);
  assert.ok(TARGET_SEC - scenarioTotal(SCENARIOS.target) >= 5 * 60);
});

test('no benchmarks → no prediction (nothing invented)', () => {
  const p = predictRace({}, {}, {});
  assert.equal(p.total, null);
  assert.equal(p.splits.swim.established, false);
  assert.equal(p.splits.bike.established, false);
  assert.equal(p.splits.run.established, false);
  assert.equal(p.missing.length, 3);
});

test('full prediction: ordered ranges and totals equal the sum of splits', () => {
  const bm = { css: 105, poolUnit: 'yd', ftp: 250, weightKg: 83, thresholdPace: 450 };
  const p = predictRace(bm, { bikeType: 'roadClipons' }, { longestSwimM: 2000, longestRunMin: 100 });
  for (const s of Object.values(p.splits)) assert.ok(s.lo <= s.mid && s.mid <= s.hi);
  const sum = Object.values(p.splits).reduce((a, s) => a + s.mid, 0);
  assert.ok(Math.abs(p.total.mid - sum) < 1e-6);
  assert.ok(p.total.mid > 4 * 3600 && p.total.mid < 6.5 * 3600);
  assert.ok(limiters(p).length === 3);
});

test('swim: unproven endurance widens only the slow bound', () => {
  const a = predictSwim({ css: 105, poolUnit: 'yd' }, { longestSwimM: 2000 });
  const b = predictSwim({ css: 105, poolUnit: 'yd' }, { longestSwimM: 600 });
  assert.equal(a.mid, b.mid);
  assert.ok(b.hi > a.hi);
});

test('run: Riegel and threshold sources', () => {
  const hm = openHalfMarathon({ race10k: 2700 });
  assert.ok(Math.abs(hm.sec - 2700 * (21097.5 / 10000) ** 1.06) < 1e-6);
  const r = predictRun({ thresholdPace: 450 }, { longestRunMin: 60 });
  assert.match(r.notes.join(' '), /widened/);
});

test('bike physics: faster with more power, slower with wind and climbing', () => {
  const base = { mass: 92, cda: 0.3, crr: 0.0045 };
  assert.ok(speedForPower(250, base) > speedForPower(200, base));
  assert.ok(speedForPower(200, { ...base, grade: 0.03 }) < speedForPower(200, base));
  const calm = simulateBike({ avgPower: 200, ...base, wind: 0 }).timeSec;
  const windy = simulateBike({ avgPower: 200, ...base, wind: 4 }).timeSec;
  assert.ok(windy > calm);
  const sim = simulateBike({ avgPower: 200, ...base });
  assert.ok(Math.abs(sim.avgPower - 200) < 1);
  // Course gain matches official ~1,400 ft
  const gain = courseGrades().reduce((a, g) => a + Math.max(0, g) * COURSE.segmentM, 0);
  assert.ok(Math.abs(gain - 427) < 15, `gain ${gain}`);
});
