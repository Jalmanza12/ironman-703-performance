// Record-level change stamps and cross-device merge (pure functions, no storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRecords, fromRecords, snapshotOf, stampChanges, mergeStates } from '../js/store/records.js';
import { emptyState, migrate } from '../js/store/store.js';

const T1 = '2026-10-10T10:00:00.000Z';
const T2 = '2026-10-11T10:00:00.000Z';
const T3 = '2026-10-12T10:00:00.000Z';

function sample() {
  const s = emptyState();
  s.createdAt = '2026-10-09T00:00:00.000Z';
  s.logs['2026-10-06#0'] = { status: 'completed', actual: { durationMin: 45 } };
  s.daily['2026-10-06'] = { sleepH: 7 };
  s.benchmarks.push({ id: 'b1', type: 'ftp', value: 250, date: '2026-10-27' });
  s.changeHistory.push({ id: 'c1', at: T1, source: 'manual', summary: 'm', changes: [], status: 'applied' });
  s.predictionHistory.push({ date: '2026-10-09', lo: 300, mid: 320, hi: 340 });
  s.settings.raceChecklist = { wetsuit: true };
  return s;
}

/** Simulate an edit on one device: mutate, then stamp what changed at `at`. */
function edit(state, at, fn) {
  const prev = snapshotOf(state);
  fn(state);
  stampChanges(state, prev, at);
  return state;
}

const data = (s) => { const { sync, ...rest } = s; return rest; };

test('records: toRecords/fromRecords round-trips every collection', () => {
  const s = sample();
  s.coach = { messages: [1] }; // legacy/unknown keys survive too
  assert.deepEqual(fromRecords(s, toRecords(s)), s);
});

test('stamps: only changed records are stamped; removals become tombstones', () => {
  const s = sample();
  const prev = snapshotOf(s);
  s.logs['2026-10-06#0'].status = 'modified';
  s.daily['2026-10-07'] = { sleepH: 6 };
  s.benchmarks = [];
  s.profile.weightLb = 181;
  stampChanges(s, prev, T2);
  assert.deepEqual(s.sync.stamps, { 'logs/2026-10-06#0': T2, 'daily/2026-10-07': T2, 'profile/weightLb': T2 });
  assert.deepEqual(s.sync.tombstones, { 'benchmarks/b1': T2 });
  // re-adding clears the tombstone
  const p2 = snapshotOf(s);
  s.benchmarks.push({ id: 'b1', type: 'ftp', value: 255, date: '2026-10-27' });
  stampChanges(s, p2, T3);
  assert.equal(s.sync.stamps['benchmarks/b1'], T3);
  assert.equal(s.sync.tombstones['benchmarks/b1'], undefined);
});

test('merge: edits to different records on two devices are both kept', () => {
  const a = edit(sample(), T2, (s) => { s.logs['2026-10-07#0'] = { status: 'completed' }; });
  const b = edit(sample(), T2, (s) => { s.daily['2026-10-07'] = { sleepH: 8 }; s.strength.push({ id: 'st1', date: '2026-10-07', exercise: 'Squat', load: 185, reps: 5 }); });
  const { state, report } = mergeStates(a, b);
  assert.ok(state.logs['2026-10-07#0']);
  assert.equal(state.daily['2026-10-07'].sleepH, 8);
  assert.equal(state.strength.length, 1);
  assert.deepEqual(report.conflicts, []);
});

test('merge: the newer edit of the same record wins', () => {
  const a = edit(sample(), T2, (s) => { s.logs['2026-10-06#0'].actual.durationMin = 50; });
  const b = edit(sample(), T3, (s) => { s.logs['2026-10-06#0'].actual.durationMin = 55; });
  for (const [x, y] of [[a, b], [b, a]]) {
    const { state, report } = mergeStates(x, y);
    assert.equal(state.logs['2026-10-06#0'].actual.durationMin, 55);
    assert.deepEqual(report.conflicts, ['logs/2026-10-06#0']);
    assert.equal(state.sync.stamps['logs/2026-10-06#0'], T3);
  }
});

test('merge: deletions win only when newer than the other side\'s edit', () => {
  const del = edit(sample(), T2, (s) => { delete s.logs['2026-10-06#0']; });
  const untouched = sample(); // legacy, unstamped
  let r = mergeStates(untouched, del);
  assert.equal(r.state.logs['2026-10-06#0'], undefined);
  assert.equal(r.state.sync.tombstones['logs/2026-10-06#0'], T2);
  assert.deepEqual(r.report.deleted, ['logs/2026-10-06#0']);

  const newer = edit(sample(), T3, (s) => { s.logs['2026-10-06#0'].status = 'modified'; });
  r = mergeStates(del, newer);
  assert.equal(r.state.logs['2026-10-06#0'].status, 'modified');
  assert.equal(r.state.sync.tombstones['logs/2026-10-06#0'], undefined);
});

test('merge: legacy (unstamped) data from both devices is unioned, never dropped', () => {
  const a = sample();
  const b = sample();
  delete b.logs['2026-10-06#0'];
  b.logs['2026-10-08#0'] = { status: 'skipped' };
  const { state } = mergeStates(a, b);
  assert.ok(state.logs['2026-10-06#0'] && state.logs['2026-10-08#0']);
});

test('merge: commutative, idempotent, and stable on re-merge', () => {
  const a = edit(sample(), T2, (s) => { s.logs['2026-10-06#0'].actual.durationMin = 50; s.profile.weightLb = 182; });
  const b = sample();
  b.logs['2026-10-06#0'].actual.durationMin = 60; // unstamped conflicting legacy value
  b.daily['2026-10-08'] = { sleepH: 9 };
  const ab = mergeStates(a, b).state;
  const ba = mergeStates(b, a).state;
  assert.deepEqual(data(ab), data(ba));
  assert.deepEqual(ab.sync, ba.sync);
  assert.deepEqual(mergeStates(ab, ab).state, ab);
  assert.deepEqual(mergeStates(ab, b).state, ab, 're-merging an input changes nothing');
  // unstamped tie is resolved the same way on every device
  const u1 = sample(); u1.daily['2026-10-06'].sleepH = 6;
  const u2 = sample(); u2.daily['2026-10-06'].sleepH = 8;
  assert.deepEqual(mergeStates(u1, u2).state.daily, mergeStates(u2, u1).state.daily);
});

test('merge: keeps unknown keys, sorts lists, earliest createdAt, flags plan mismatch', () => {
  const a = sample();
  a.planVersion = 'aaaa1111';
  a.coach = { messages: ['old'] };
  const b = sample();
  b.planVersion = 'bbbb2222';
  b.createdAt = '2026-10-01T00:00:00.000Z';
  b.changeHistory.unshift({ id: 'c0', at: '2026-10-05T00:00:00.000Z', source: 'manual', summary: 'earlier', changes: [], status: 'undone' });
  const { state, report } = mergeStates(a, b);
  assert.deepEqual(state.coach, { messages: ['old'] });
  assert.deepEqual(state.changeHistory.map((h) => h.id), ['c0', 'c1']);
  assert.equal(state.createdAt, '2026-10-01T00:00:00.000Z');
  assert.equal(report.planMismatch, true);
  assert.equal(state.planVersion, 'aaaa1111');
});

test('merge: refuses data from a newer schema; result passes migrate unchanged', () => {
  assert.throws(() => mergeStates(sample(), { ...sample(), version: 2 }), /newer app version/);
  const { state } = mergeStates(sample(), sample());
  assert.deepEqual(migrate(structuredClone(state)), state);
});
