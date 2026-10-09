import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Z from '../js/lib/zones.js';
import { describeTarget } from '../js/lib/targets.js';
import { T } from '../js/plan/common.js';

test('power zones and ranges from FTP', () => {
  assert.deepEqual(Z.powerRange(250, 0.88, 0.93), [220, 233]);
  const z = Z.powerZones(250);
  assert.deepEqual(z.find((x) => x.id === 'Z2').watts, [140, 188]);
  assert.equal(Z.powerZones(null), null);
  assert.equal(Z.powerRange(20, 0.5, 0.6), null); // invalid FTP
});

test('FTP estimates from tests', () => {
  assert.equal(Z.ftpFrom20Min(260), 247);
  assert.equal(Z.ftpFromRamp(320), 240);
  assert.equal(Z.ftpFrom20Min(5), null);
});

test('HR zones (Friel %LTHR)', () => {
  const run = Z.hrZones(170, 'run');
  assert.deepEqual(run.find((x) => x.id === 'Z2').bpm, [145, 151]);
  const bike = Z.hrZones(165, 'bike');
  assert.deepEqual(bike.find((x) => x.id === 'Z2').bpm, [134, 147]);
  assert.equal(Z.hrZones(50), null);
});

test('run pace & swim zones', () => {
  assert.deepEqual(Z.paceRange(420, 0.99, 1.03), [416, 433]);
  assert.deepEqual(Z.swimRange(100, 3, 6), [103, 106]);
  assert.equal(Z.swimZones(10), null);
});

test('target resolver never invents numbers without benchmarks', () => {
  const t = T.bike(0.95, 1.0, { hr: [0.95, 1.0], rpe: [7, 8] });
  const none = describeTarget(t, {});
  assert.equal(none.provisional, true);
  assert.match(none.lines[0], /not yet established/);
  assert.doesNotMatch(none.lines.join(' '), /\d+ W/);
  const withFtp = describeTarget(t, { ftp: 240 });
  assert.equal(withFtp.provisional, false);
  assert.match(withFtp.lines[0], /^228–240 W/);
  const run = describeTarget(T.run(0.99, 1.03), { thresholdPace: 420 });
  assert.match(run.lines[0], /^6:56–7:13 \/mi/);
  const swim = describeTarget(T.swim(3, 6), { css: 100, poolUnit: 'yd' });
  assert.match(swim.lines[0], /^1:43–1:46 \/100yd/);
});
