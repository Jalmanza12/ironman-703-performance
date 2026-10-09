import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/lib/dates.js';

test('addDays / diffDays across DST and month boundaries', () => {
  assert.equal(D.addDays('2027-03-13', 1), '2027-03-14'); // DST starts Mar 14 2027
  assert.equal(D.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(D.addDays('2026-11-01', 1), '2026-11-02'); // DST ends Nov 1 2026
  assert.equal(D.diffDays('2026-10-05', '2027-03-14'), 160);
  assert.equal(D.diffDays('2026-10-09', '2027-03-14'), 156);
});

test('day of week and Monday anchor', () => {
  assert.equal(D.DOW[D.dayOfWeek('2027-03-14')], 'Sunday');
  assert.equal(D.DOW[D.dayOfWeek('2026-10-04')], 'Sunday'); // Waco
  assert.equal(D.mondayOf('2027-03-14'), '2027-03-08');
  assert.equal(D.mondayOf('2026-10-05'), '2026-10-05');
});

test('isISODate rejects impossible dates', () => {
  assert.ok(D.isISODate('2027-02-28'));
  assert.ok(!D.isISODate('2027-02-29'));
  assert.ok(!D.isISODate('2027-3-1'));
});

test('countdown to race start', () => {
  const start = Date.UTC(2027, 2, 14, 12, 30); // 7:30 CDT
  const c = D.countdown(new Date(Date.UTC(2027, 2, 13, 12, 30)), start);
  assert.deepEqual([c.days, c.hours, c.minutes, c.past], [1, 0, 0, false]);
  const p = D.countdown(new Date(start + 1000), start);
  assert.equal(p.past, true);
  assert.equal(p.totalMs, 0);
  assert.equal(D.daysUntil('2026-10-09', '2027-03-14'), 156);
});
