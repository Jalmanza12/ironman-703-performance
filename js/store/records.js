// Record-level view of the saved state, used for change stamps and cross-device merging.
// Every piece of athlete data maps to one record key ("collection/id"); merge decisions are made
// per record, so edits to different workouts on two devices never overwrite each other.
// Pure functions only — no storage access.

export const SYNC_SCHEMA = 1;

const MAPS = ['logs', 'daily', 'reschedules', 'overrides']; // object keyed by session id or date
const LISTS = { // array of records: key field, sort field
  benchmarks: ['id', 'date'],
  strength: ['id', 'date'],
  changeHistory: ['id', 'at'],
  predictionHistory: ['date', 'date'],
};
const FIELDS = ['profile', 'settings']; // object merged field by field
const UNTRACKED = new Set(['version', 'createdAt', 'planVersion', 'sync']);

const listKey = (r, field) => (r && r[field] != null ? String(r[field]) : `h-${hash(JSON.stringify(r))}`);

/** FNV-1a 32-bit hex — stable short hash for fingerprints and keyless records. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Map of record key → value for every tracked piece of data in `state`. */
export function toRecords(state) {
  const out = new Map();
  for (const c of MAPS) for (const [id, v] of Object.entries(state[c] || {})) out.set(`${c}/${id}`, v);
  for (const [c, [field]] of Object.entries(LISTS)) for (const r of state[c] || []) out.set(`${c}/${listKey(r, field)}`, r);
  for (const c of FIELDS) for (const [k, v] of Object.entries(state[c] || {})) out.set(`${c}/${k}`, v);
  for (const [k, v] of Object.entries(state)) if (!UNTRACKED.has(k) && !MAPS.includes(k) && !LISTS[k] && !FIELDS.includes(k)) out.set(`root/${k}`, v);
  return out;
}

/** Rebuild the tracked collections of `base` from a record map (inverse of toRecords). */
export function fromRecords(base, records) {
  const out = {};
  for (const [k, v] of Object.entries(base)) if (UNTRACKED.has(k)) out[k] = v;
  for (const c of [...MAPS, ...FIELDS]) out[c] = {};
  for (const c of Object.keys(LISTS)) out[c] = [];
  for (const [key, v] of records) {
    const i = key.indexOf('/');
    const c = key.slice(0, i);
    const id = key.slice(i + 1);
    if (c === 'root') out[id] = v;
    else if (LISTS[c]) out[c].push(v);
    else out[c][id] = v;
  }
  for (const [c, [field, sortBy]] of Object.entries(LISTS)) {
    out[c].sort((a, b) => String(a?.[sortBy] ?? '').localeCompare(String(b?.[sortBy] ?? '')) || listKey(a, field).localeCompare(listKey(b, field)));
  }
  return out;
}

/** Serialized snapshot (key → JSON) used to detect which records a save changed. */
export function snapshotOf(state) {
  const snap = new Map();
  for (const [k, v] of toRecords(state)) snap.set(k, JSON.stringify(v));
  return snap;
}

export function ensureSync(state) {
  const s = state.sync;
  if (!s || typeof s !== 'object' || Array.isArray(s)) state.sync = { schema: SYNC_SCHEMA, stamps: {}, tombstones: {} };
  for (const k of ['stamps', 'tombstones']) if (!state.sync[k] || typeof state.sync[k] !== 'object' || Array.isArray(state.sync[k])) state.sync[k] = {};
  state.sync.schema ||= SYNC_SCHEMA;
  return state.sync;
}

/**
 * Stamp records that differ from `prev` (the snapshot at the last load/save) with `now`;
 * records that disappeared get a tombstone. Mutates state.sync; returns the new snapshot.
 */
export function stampChanges(state, prev, now = new Date().toISOString()) {
  const sync = ensureSync(state);
  const next = snapshotOf(state);
  for (const [k, json] of next) {
    if (prev.get(k) !== json) {
      sync.stamps[k] = now;
      delete sync.tombstones[k];
    }
  }
  for (const k of prev.keys()) {
    if (!next.has(k)) {
      sync.tombstones[k] = now;
      delete sync.stamps[k];
    }
  }
  return next;
}

/**
 * Merge two saved states record by record. Newest stamp wins; a deletion wins only if it is newer
 * than the other side's edit. Records without stamps (data saved before stamping existed) count as
 * oldest. Exact ties are broken deterministically (a present value beats a deletion; otherwise the
 * larger serialized value), so merge(a, b) and merge(b, a) agree and repeated merges are stable.
 * Nothing is dropped unless a newer deletion exists.
 */
export function mergeStates(local, remote, { schemaVersion = 1 } = {}) {
  for (const s of [local, remote]) if ((s?.version || 0) > schemaVersion) throw new Error('Saved data comes from a newer app version — update the app before syncing.');
  const L = toRecords(local);
  const R = toRecords(remote);
  const ls = local.sync || {};
  const rs = remote.sync || {};
  const side = (recs, sync, k) => {
    const stamp = sync.stamps?.[k] || '';
    const tomb = sync.tombstones?.[k] || '';
    const present = recs.has(k) && !(tomb && tomb > stamp);
    return { present, value: present ? recs.get(k) : undefined, json: present ? JSON.stringify(recs.get(k)) : '', at: present ? stamp : tomb };
  };
  const keys = new Set([...L.keys(), ...R.keys(), ...Object.keys(ls.tombstones || {}), ...Object.keys(rs.tombstones || {})]);
  const merged = new Map();
  const sync = { schema: SYNC_SCHEMA, stamps: {}, tombstones: {} };
  const report = { fromLocal: 0, fromRemote: 0, conflicts: [], deleted: [], planMismatch: !!(local.planVersion && remote.planVersion && local.planVersion !== remote.planVersion) };

  for (const k of [...keys].sort()) {
    const a = side(L, ls, k);
    const b = side(R, rs, k);
    let win;
    if (a.present && b.present && a.json === b.json) win = a.at >= b.at ? a : b;
    else if (a.at !== b.at) win = a.at > b.at ? a : b;
    else if (a.present !== b.present) win = a.present ? a : b;
    else win = a.json >= b.json ? a : b;
    if (a.present && b.present && a.json !== b.json) report.conflicts.push(k);
    if (win.present) {
      merged.set(k, structuredClone(win.value));
      if (win.at) sync.stamps[k] = win.at;
      if (a.json !== b.json) win === a ? report.fromLocal++ : report.fromRemote++;
    } else if (win.at) {
      sync.tombstones[k] = win.at;
      if (a.present || b.present) report.deleted.push(k);
    }
  }

  const state = fromRecords(local, merged);
  state.createdAt = [local.createdAt, remote.createdAt].filter(Boolean).sort()[0] || local.createdAt;
  state.version = Math.max(local.version || 0, remote.version || 0) || schemaVersion;
  state.sync = sync;
  return { state, report };
}
