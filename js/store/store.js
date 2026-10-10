// Persistence. Single-device storage in the browser (localStorage), with JSON backup/restore
// and CSV export. No data ever leaves the device unless you export it yourself.
// Limitations (documented in README): data is per-browser/per-device, can be cleared by the
// browser or private mode, and is not synced. Export a JSON backup weekly.

const KEY = 'im703:v1';
export const SCHEMA_VERSION = 1;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    profile: { weightLb: 183, heightIn: 72 }, // athlete-provided; editable on Profile
    benchmarks: [], // {id, type, value, date, method, notes, raw}
    logs: {}, // sessionId -> {status, actual, feedback, updatedAt}
    daily: {}, // date -> {sleepH, sleepQ, fatigue, soreness, motivation, pain, painLocation, symptoms, weightLb, hunger, notes}
    strength: [], // {id, date, sessionId, exercise, load, reps, rir}
    reschedules: {}, // sessionId -> newDate
    overrides: {}, // sessionId -> { cancelled, durationMin, replacement, changeId } (approved plan changes)
    changeHistory: [], // approved adjustments with before/after values (undo + audit)
    coach: { messages: [] }, // AI Coach conversation (never the source of truth for the plan)
    predictionHistory: [], // {date, lo, mid, hi}
    settings: { poolUnit: 'yd' },
  };
}

let memory = null;
let storageOK = true;

function backend() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const k = '__im703_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

export function load() {
  if (memory) return memory;
  const ls = backend();
  storageOK = !!ls;
  let state = emptyState();
  if (ls) {
    try {
      const raw = ls.getItem(KEY);
      if (raw) state = migrate(JSON.parse(raw));
    } catch (e) {
      console.error('Could not read saved data', e);
    }
  }
  memory = state;
  return memory;
}

export function save(state = memory) {
  memory = state;
  const ls = backend();
  if (!ls) {
    storageOK = false;
    return false;
  }
  try {
    ls.setItem(KEY, JSON.stringify(state));
    storageOK = true;
    return true;
  } catch (e) {
    console.error('Save failed', e);
    storageOK = false;
    return false;
  }
}

export function isPersistent() {
  return storageOK;
}

export function update(fn) {
  const s = load();
  fn(s);
  save(s);
  return s;
}

export function migrate(obj) {
  const base = emptyState();
  if (!obj || typeof obj !== 'object') return base;
  const out = { ...base, ...obj };
  for (const k of ['benchmarks', 'strength', 'predictionHistory', 'changeHistory']) if (!Array.isArray(out[k])) out[k] = [];
  for (const k of ['profile', 'logs', 'daily', 'reschedules', 'overrides', 'settings', 'coach']) if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = base[k];
  if (!Array.isArray(out.coach.messages)) out.coach = { messages: [] };
  out.version = SCHEMA_VERSION;
  return out;
}

export function resetAll() {
  memory = emptyState();
  save(memory);
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ---------- Import / export ----------
export function exportJSON(state = load()) {
  return JSON.stringify({ app: 'ironman-703-performance', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export function importJSON(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!obj || obj.app !== 'ironman-703-performance') throw new Error('That file is not a backup from this app.');
  delete obj.app;
  delete obj.exportedAt;
  const s = migrate(obj);
  memory = s;
  save(s);
  return s;
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return [head, ...body].join('\n');
}

export function logsCSV(state, plan) {
  const rows = Object.entries(state.logs).map(([id, l]) => ({ id, ...l, s: plan.sessions[id] }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return toCSV(rows, [
    { label: 'date', get: (r) => r.id.split('#')[0] },
    { label: 'session', get: (r) => r.s?.title },
    { label: 'sport', get: (r) => r.s?.sport },
    { label: 'planned_min', get: (r) => r.s?.durationMin },
    { label: 'status', key: 'status' },
    { label: 'actual_min', get: (r) => r.actual?.durationMin },
    { label: 'distance', get: (r) => r.actual?.distance },
    { label: 'distance_unit', get: (r) => r.actual?.distanceUnit },
    { label: 'avg_pace', get: (r) => r.actual?.avgPace },
    { label: 'avg_hr', get: (r) => r.actual?.avgHr },
    { label: 'avg_power', get: (r) => r.actual?.avgPower },
    { label: 'np', get: (r) => r.actual?.np },
    { label: 'cadence', get: (r) => r.actual?.cadence },
    { label: 'intervals_completed', get: (r) => r.actual?.intervalsCompleted },
    { label: 'rpe', get: (r) => r.actual?.rpe },
    { label: 'carbs_g', get: (r) => r.actual?.carbsG },
    { label: 'fluid_ml', get: (r) => r.actual?.fluidMl },
    { label: 'sodium_mg', get: (r) => r.actual?.sodiumMg },
    { label: 'notes', get: (r) => r.actual?.notes },
  ]);
}

export function dailyCSV(state) {
  const rows = Object.entries(state.daily).map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date));
  return toCSV(rows, ['date', 'sleepH', 'sleepQ', 'fatigue', 'soreness', 'motivation', 'hunger', 'pain', 'painLocation', 'weightLb', 'notes'].map((k) => ({ label: k, key: k })).concat([{ label: 'symptoms', get: (r) => (r.symptoms || []).join('; ') }]));
}

export function benchmarksCSV(state) {
  return toCSV([...state.benchmarks].sort((a, b) => a.date.localeCompare(b.date)), ['date', 'type', 'value', 'method', 'notes'].map((k) => ({ label: k, key: k })));
}

export function strengthCSV(state) {
  return toCSV([...state.strength].sort((a, b) => a.date.localeCompare(b.date)), ['date', 'exercise', 'load', 'reps', 'rir'].map((k) => ({ label: k, key: k })));
}
