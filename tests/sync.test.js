// Cloud backup decisions (pure): what "Back up now" does in each situation, and how choices resolve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBackup, resolve, sameData, describeReport } from '../js/store/sync.js';
import { emptyState } from '../js/store/store.js';
import { snapshotOf, stampChanges } from '../js/store/records.js';

const U = 'user-a';
const base = () => { const s = emptyState(); s.createdAt = '2026-10-01T00:00:00.000Z'; return s; };
const edit = (s, at, fn) => { const p = snapshotOf(s); fn(s); stampChanges(s, p, at); return s; };
const remoteOf = (state, rev) => ({ state: structuredClone(state), rev, updated_at: '2026-10-14T00:00:00Z' });

test('planBackup: empty cloud → upload from rev 0', () => {
  assert.deepEqual(planBackup({ local: base(), remote: null, meta: null, userId: U }), { action: 'upload', base: 0 });
});

test('planBackup: identical data → nothing to do', () => {
  const s = base();
  assert.equal(planBackup({ local: s, remote: remoteOf(s, 3), meta: null, userId: U }).action, 'none');
});

test('planBackup: first sync on this device with existing cloud data → ask', () => {
  const local = edit(base(), '2026-10-14T01:00:00Z', (s) => { s.daily['2026-10-13'] = { sleepH: 7 }; });
  const remote = remoteOf(edit(base(), '2026-10-14T02:00:00Z', (s) => { s.daily['2026-10-12'] = { sleepH: 8 }; }), 4);
  assert.deepEqual(planBackup({ local, remote, meta: null, userId: U }), { action: 'choose', base: 4 });
  assert.equal(planBackup({ local, remote, meta: { userId: 'someone-else', rev: 4 }, userId: U }).action, 'choose', 'different account asks too');
});

test('planBackup: cloud unchanged since last sync → upload; changed elsewhere → merge', () => {
  const local = edit(base(), '2026-10-14T01:00:00Z', (s) => { s.daily['2026-10-13'] = { sleepH: 7 }; });
  const remote = remoteOf(base(), 5);
  assert.deepEqual(planBackup({ local, remote, meta: { userId: U, rev: 5 }, userId: U }), { action: 'upload', base: 5 });
  assert.deepEqual(planBackup({ local, remote, meta: { userId: U, rev: 4 }, userId: U }), { action: 'merge', base: 5 });
});

test('resolve: merge keeps both devices\' records; cloud/local choices pick one side', () => {
  const local = edit(base(), '2026-10-14T01:00:00Z', (s) => { s.logs['2026-10-13#0'] = { status: 'completed', actual: {} }; });
  const cloud = edit(base(), '2026-10-14T02:00:00Z', (s) => { s.daily['2026-10-12'] = { sleepH: 8 }; });
  const m = resolve('merge', local, cloud);
  assert.ok(m.state.logs['2026-10-13#0'] && m.state.daily['2026-10-12']);
  assert.equal(m.report.fromLocal + m.report.fromRemote, 2);
  assert.match(describeReport(m.report), /1 change from the cloud, 1 from this device/);
  assert.equal(resolve('cloud', local, cloud).state.logs['2026-10-13#0'], undefined);
  assert.equal(resolve('local', local, cloud).state, local);
});

test('resolve: refuses cloud data from a newer app version or malformed data', () => {
  assert.throws(() => resolve('merge', base(), { ...base(), version: 99 }), /newer version/);
  assert.throws(() => resolve('cloud', base(), []), /not valid backup/);
  assert.throws(() => resolve('cloud', base(), null), /not valid backup/);
});

test('sameData ignores key order', () => {
  assert.equal(sameData({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.equal(sameData({ a: 1 }, { a: 2 }), false);
});
