import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/lib/units.js';

test('parseDuration handles h:mm:ss, mm:ss, seconds and rejects junk', () => {
  assert.equal(U.parseDuration('1:02:03'), 3723);
  assert.equal(U.parseDuration('8:15'), 495);
  assert.equal(U.parseDuration('90'), 90);
  assert.ok(Number.isNaN(U.parseDuration('8:75')));
  assert.ok(Number.isNaN(U.parseDuration('abc')));
  assert.ok(Number.isNaN(U.parseDuration('')));
});

test('formatDuration round-trips and pads', () => {
  assert.equal(U.formatDuration(3723), '1:02:03');
  assert.equal(U.formatDuration(495), '8:15');
  assert.equal(U.formatDuration(59.6), '1:00');
  assert.equal(U.formatDuration(18900), '5:15:00');
});

test('pace and speed conversions', () => {
  assert.ok(Math.abs(U.paceSecPerMileToKm(480) - 298.26) < 0.01); // 8:00/mi ≈ 4:58/km
  assert.ok(Math.abs(U.paceSecPerKmToMile(300) - 482.80) < 0.01);
  assert.ok(Math.abs(U.mphFromMps(U.mpsFromMph(21.3)) - 21.3) < 1e-9);
  assert.ok(Math.abs(U.pacePerMileFromSpeedMps(U.speedMpsFromPacePerMile(450)) - 450) < 1e-9);
  // 13.1 mi at 8:10/mi = 1:47:00 (approx; 13.1094 mi in 21.0975 km)
  const t = U.timeForDistanceAtPace(U.RACE_DISTANCES.runM, 490);
  assert.ok(Math.abs(t - 6423.6) < 1);
});

test('swim CSS and yard/meter conversion', () => {
  assert.equal(U.cssPacePer100(400, 190), 105); // (400-190)/2
  assert.ok(Number.isNaN(U.cssPacePer100(190, 400)));
  assert.ok(Math.abs(U.per100ydToPer100m(100) - 109.36) < 0.01);
  assert.ok(Math.abs(U.per100mToPer100yd(U.per100ydToPer100m(97)) - 97) < 1e-9);
});

test('weight conversions', () => {
  assert.ok(Math.abs(U.kgFromLb(183) - 83.0) < 0.05);
});
