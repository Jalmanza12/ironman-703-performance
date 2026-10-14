// Storage regression tests: legacy data must load without loss, and JSON backup must round-trip.
// Uses an in-memory localStorage stub and a fresh module instance per test (store.js caches state).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'im703:v1';

function stubStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const ls = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  return data;
}

let n = 0;
const freshStore = () => import(`../js/store/store.js?instance=${++n}`);

// Shape written by the first release (before plan adjustments): no overrides/changeHistory.
const LEGACY_V1 = {
  version: 1,
  createdAt: '2026-10-09T23:54:00.000Z',
  profile: { weightLb: 183, heightIn: 72, poolUnit: 'yd' },
  benchmarks: [{ id: 'b1', type: 'ftp', value: 250, date: '2026-10-27', method: '20min', notes: '' }],
  logs: { '2026-10-06#0': { status: 'completed', actual: { durationMin: 45, rpe: 4 }, updatedAt: '2026-10-06T20:00:00Z' } },
  daily: { '2026-10-06': { sleepH: 7.5, fatigue: 3 } },
  strength: [{ id: 's1', date: '2026-10-07', sessionId: '2026-10-07#1', exercise: 'Squat', load: 185, reps: 5, rir: 2 }],
  reschedules: { '2026-10-08#0': '2026-10-09' },
  predictionHistory: [{ date: '2026-10-09', lo: 300, mid: 320, hi: 340 }],
  settings: { poolUnit: 'yd' },
};

test('migrate: garbage input yields a valid empty state', async () => {
  const { migrate, emptyState, SCHEMA_VERSION } = await freshStore();
  const keys = Object.keys(emptyState()).filter((k) => k !== 'createdAt').sort();
  for (const bad of [null, undefined, 42, 'x']) {
    const s = migrate(bad);
    assert.equal(s.version, SCHEMA_VERSION);
    assert.deepEqual(Object.keys(s).filter((k) => k !== 'createdAt').sort(), keys);
  }
});

test('migrate: legacy v1 data keeps every record and gains new defaults', async () => {
  const { migrate } = await freshStore();
  const s = migrate(structuredClone(LEGACY_V1));
  for (const k of ['profile', 'benchmarks', 'logs', 'daily', 'strength', 'reschedules', 'predictionHistory', 'settings', 'createdAt']) {
    assert.deepEqual(s[k], LEGACY_V1[k], k);
  }
  assert.deepEqual(s.overrides, {});
  assert.deepEqual(s.changeHistory, []);
});

test('migrate: wrong-typed collections are reset, valid ones untouched', async () => {
  const { migrate } = await freshStore();
  const s = migrate({ ...structuredClone(LEGACY_V1), benchmarks: { not: 'an array' }, logs: ['not', 'an', 'object'], daily: null });
  assert.deepEqual(s.benchmarks, []);
  assert.deepEqual(s.logs, {});
  assert.deepEqual(s.daily, {});
  assert.deepEqual(s.strength, LEGACY_V1.strength);
});

test('migrate: removed-feature and unknown keys are preserved (no silent data loss)', async () => {
  const { migrate } = await freshStore();
  const coach = { version: 2, messages: [{ role: 'athlete', text: 'hi' }], apiMessages: [], events: [] };
  const s = migrate({ ...structuredClone(LEGACY_V1), coach, futureField: { a: 1 } });
  assert.deepEqual(s.coach, coach);
  assert.deepEqual(s.futureField, { a: 1 });
});

test('load: reads and migrates legacy localStorage data without rewriting it', async () => {
  const raw = JSON.stringify(LEGACY_V1);
  const data = stubStorage({ [KEY]: raw });
  const { load, isPersistent } = await freshStore();
  const s = load();
  assert.deepEqual(s.logs, LEGACY_V1.logs);
  assert.deepEqual(s.changeHistory, []);
  assert.equal(isPersistent(), true);
  assert.equal(data.get(KEY), raw, 'load must not write');
});

test('load: corrupt saved JSON falls back to empty state and leaves the raw value for recovery', async () => {
  const data = stubStorage({ [KEY]: '{not json' });
  const { load } = await freshStore();
  const origError = console.error;
  console.error = () => {};
  try {
    const s = load();
    assert.deepEqual(s.logs, {});
  } finally {
    console.error = origError;
  }
  assert.equal(data.get(KEY), '{not json');
});

test('JSON backup: export → import round-trips all data and persists it', async () => {
  stubStorage();
  const { exportJSON, migrate } = await freshStore();
  const original = migrate(structuredClone(LEGACY_V1));
  original.changeHistory.push({ id: 'chg-1', at: '2026-10-10T00:00:00Z', source: 'manual', summary: 'm', changes: [], status: 'applied' });
  const text = exportJSON(original);
  assert.equal(JSON.parse(text).app, 'ironman-703-performance');

  const data = stubStorage();
  const other = await freshStore();
  const imported = other.importJSON(text);
  assert.deepEqual(imported, original);
  assert.deepEqual(JSON.parse(data.get(KEY)), original);
  assert.equal('app' in imported || 'exportedAt' in imported, false);
});

test('JSON import: legacy backups are migrated on import', async () => {
  stubStorage();
  const { importJSON } = await freshStore();
  const s = importJSON(JSON.stringify({ app: 'ironman-703-performance', exportedAt: '2026-10-09T00:00:00Z', ...LEGACY_V1 }));
  assert.deepEqual(s.benchmarks, LEGACY_V1.benchmarks);
  assert.deepEqual(s.overrides, {});
});

test('JSON import: invalid or foreign files are rejected and saved data is untouched', async () => {
  const saved = JSON.stringify(LEGACY_V1);
  const data = stubStorage({ [KEY]: saved });
  const { importJSON } = await freshStore();
  assert.throws(() => importJSON('{oops'), /not valid JSON/);
  assert.throws(() => importJSON(JSON.stringify({ logs: {} })), /not a backup from this app/);
  assert.throws(() => importJSON('null'), /not a backup from this app/);
  assert.equal(data.get(KEY), saved);
});

test('save: stamps only records changed since load; load itself never stamps', async () => {
  const data = stubStorage({ [KEY]: JSON.stringify(LEGACY_V1) });
  const { load, update } = await freshStore();
  assert.deepEqual(load().sync.stamps, {});
  update((s) => { s.logs['2026-10-06#0'].actual.rpe = 5; s.daily['2026-10-07'] = { sleepH: 6 }; delete s.reschedules['2026-10-08#0']; });
  const saved = JSON.parse(data.get(KEY));
  assert.deepEqual(Object.keys(saved.sync.stamps).sort(), ['daily/2026-10-07', 'logs/2026-10-06#0']);
  assert.deepEqual(Object.keys(saved.sync.tombstones), ['reschedules/2026-10-08#0']);
  update(() => {}); // no-op save stamps nothing new
  assert.deepEqual(JSON.parse(data.get(KEY)).sync, saved.sync);
});

test('import and reset replace data without stamping (restores never look like new edits)', async () => {
  stubStorage();
  const { importJSON, resetAll, load } = await freshStore();
  const s = importJSON(JSON.stringify({ app: 'ironman-703-performance', ...LEGACY_V1 }));
  assert.deepEqual(s.sync.stamps, {});
  resetAll();
  assert.deepEqual(load().sync, { schema: 1, stamps: {}, tombstones: {} });
});

test('reloadFromStorage: picks up another tab\'s save so this tab does not overwrite it', async () => {
  const data = stubStorage({ [KEY]: JSON.stringify(LEGACY_V1) });
  const { load, update, reloadFromStorage } = await freshStore();
  load();
  const other = JSON.parse(data.get(KEY));
  other.daily['2026-10-09'] = { sleepH: 9 }; // written by another tab
  data.set(KEY, JSON.stringify(other));
  reloadFromStorage();
  update((s) => { s.logs['2026-10-09#0'] = { status: 'completed', actual: {} }; });
  const saved = JSON.parse(data.get(KEY));
  assert.ok(saved.daily['2026-10-09'] && saved.logs['2026-10-09#0']);
  assert.deepEqual(Object.keys(saved.sync.stamps), ['logs/2026-10-09#0']);
});

test('migrate: repairs a malformed sync block without touching data', async () => {
  const { migrate } = await freshStore();
  for (const sync of [null, [], 'x', { stamps: [], tombstones: 'y' }]) {
    const s = migrate({ ...structuredClone(LEGACY_V1), sync });
    assert.deepEqual(s.sync, { schema: 1, stamps: {}, tombstones: {} });
    assert.deepEqual(s.logs, LEGACY_V1.logs);
  }
});
