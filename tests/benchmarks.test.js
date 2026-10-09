import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentBenchmarks, benchmarkTrend, e1rm, strengthTrend } from '../js/lib/benchmarks.js';
import { emptyState, migrate, toCSV } from '../js/store/store.js';
import { sweatRate, dailyTargets, dayCarbClass } from '../js/lib/nutrition.js';

test('current benchmarks use latest valid entry only', () => {
  const s = emptyState();
  s.benchmarks.push({ type: 'ftp', value: 240, date: '2026-10-27' }, { type: 'ftp', value: 9999, date: '2026-11-28' }, { type: 'ftp', value: 252, date: '2026-11-28' });
  s.profile.weightLb = 183;
  const { values } = currentBenchmarks(s);
  assert.equal(values.ftp, 252);
  assert.ok(Math.abs(values.weightKg - 83.0) < 0.1);
  assert.equal(values.css, undefined);
});

test('trend requires change beyond noise; single test is unconfirmed', () => {
  const h = { ftp: [{ value: 240 }, { value: 244 }] };
  assert.equal(benchmarkTrend(h, 'ftp').meaningful, false);
  const h2 = { ftp: [{ value: 240 }, { value: 252 }] };
  const t = benchmarkTrend(h2, 'ftp');
  assert.equal(t.direction, 'improved');
  assert.equal(t.confirmed, false);
  const h3 = { css: [{ value: 110 }, { value: 106 }, { value: 102 }] };
  assert.equal(benchmarkTrend(h3, 'css').direction, 'improved');
  assert.equal(benchmarkTrend(h3, 'css').confirmed, true);
});

test('e1RM and strength trend distinguish dips from declines', () => {
  assert.ok(Math.abs(e1rm(100, 5, 2) - 123.33) < 0.01);
  assert.equal(e1rm(100, 20, 0), null);
  const ex = 'DL';
  const mk = (date, load) => ({ date, exercise: ex, load, reps: 5, rir: 2 });
  assert.match(strengthTrend([mk('a1', 140), mk('a2', 140), mk('a3', 138), mk('a4', 139)], ex).status, /maintained/);
  assert.match(strengthTrend([mk('a1', 140), mk('a2', 140), mk('a3', 120), mk('a4', 118)], ex).status, /meaningful decline/);
});

test('store migration and CSV escaping', () => {
  const m = migrate({ logs: [], benchmarks: 'bad' });
  assert.deepEqual(m.logs, {});
  assert.deepEqual(m.benchmarks, []);
  assert.equal(toCSV([{ a: 'x,"y"' }], [{ label: 'a', key: 'a' }]), 'a\n"x,""y"""');
});

test('nutrition calculations', () => {
  const sr = sweatRate({ preKg: 83, postKg: 82, fluidL: 0.5, urineL: 0, hours: 1 });
  assert.ok(Math.abs(sr.rateLph - 1.5) < 1e-9);
  assert.equal(sweatRate({ preKg: 0, postKg: 1, hours: 1 }), null);
  const t = dailyTargets(83, 'high');
  assert.deepEqual(t.carbs, [498, 830]);
  assert.deepEqual(t.protein, [133, 183]);
  assert.equal(dayCarbClass({ sessions: [] }), 'rest');
});
