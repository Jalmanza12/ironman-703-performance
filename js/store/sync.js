// Cloud backup decisions (pure, no network or storage). The cloud copy is one document per athlete
// with an optimistic-concurrency `rev`; `meta` is what this device remembers about its last sync.

import { mergeStates } from './records.js';
import { migrate, SCHEMA_VERSION } from './store.js';

/**
 * Decide what a "Back up now" should do.
 *   upload  — cloud is empty, or unchanged since this device last synced: send local as-is.
 *   merge   — another device saved since our last sync: merge record-by-record, then send.
 *   choose  — first sync on this device (or a different account) and the cloud already has data:
 *             the athlete picks merge / use cloud / keep this device.
 *   none    — local and cloud are already identical.
 */
export function planBackup({ local, remote, meta, userId }) {
  if (!remote) return { action: 'upload', base: 0 };
  if (sameData(local, remote.state)) return { action: 'none', base: remote.rev };
  const known = meta && meta.userId === userId;
  if (!known) return { action: 'choose', base: remote.rev };
  if (meta.rev === remote.rev) return { action: 'upload', base: remote.rev };
  return { action: 'merge', base: remote.rev };
}

/** Result of applying a choice to local + cloud data. Throws if the cloud copy is from a newer app. */
export function resolve(choice, local, remoteState) {
  assertReadable(remoteState);
  if (choice === 'local') return { state: local, report: null };
  if (choice === 'cloud') return { state: migrate(structuredClone(remoteState)), report: null };
  if (choice === 'merge') {
    const { state, report } = mergeStates(local, remoteState, { schemaVersion: SCHEMA_VERSION });
    return { state: migrate(state), report };
  }
  throw new Error(`Unknown sync choice: ${choice}`);
}

export function assertReadable(remoteState) {
  if (!remoteState || typeof remoteState !== 'object' || Array.isArray(remoteState)) throw new Error('The cloud copy is not valid backup data.');
  if ((remoteState.version || 0) > SCHEMA_VERSION) throw new Error('The cloud copy was saved by a newer version of the app — reload this page to update first.');
}

/** Compare athlete data, ignoring bookkeeping that differs between devices. */
export function sameData(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

/** Short human summary of a merge report for the UI. */
export function describeReport(report) {
  if (!report) return '';
  const parts = [];
  if (report.fromRemote) parts.push(`${report.fromRemote} change${report.fromRemote === 1 ? '' : 's'} from the cloud`);
  if (report.fromLocal) parts.push(`${report.fromLocal} from this device`);
  if (report.conflicts.length) parts.push(`${report.conflicts.length} edited on both (newest kept)`);
  if (report.deleted.length) parts.push(`${report.deleted.length} deletion${report.deleted.length === 1 ? '' : 's'}`);
  return parts.join(', ') || 'no differences';
}
