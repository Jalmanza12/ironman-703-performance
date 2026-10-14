// Optional cloud backup (Supabase). Loaded lazily — only when the athlete uses cloud backup or
// returns from a sign-in link — so the app itself stays dependency-free and fully offline-capable.
// Browser data remains the primary copy; nothing here runs automatically.

import { createClient } from '../vendor/supabase.js';
import { cloudProject } from '../data/cloudConfig.js';
import { load, replaceState, SCHEMA_VERSION } from './store.js';
import { planBackup, resolve, assertReadable } from './sync.js';

const META_KEY = 'im703:cloud'; // { userId, rev, syncedAt } — what this device last synced
const PRESYNC_KEY = 'im703:v1:pre-sync'; // { savedAt, reason, state } — copy taken before every sync

let client = null;

export function getClient() {
  if (!client) {
    const { url, key } = cloudProject();
    client = createClient(url, key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  return client;
}

// ---------- auth ----------
export async function currentUser() {
  const { data } = await getClient().auth.getSession();
  return data.session?.user || null;
}

/** Email a one-time sign-in link back to this page (PKCE: open it in this same browser). */
export async function sendSignInLink(email) {
  const redirect = `${location.origin}${location.pathname}`;
  const { error } = await getClient().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  if (error) throw new Error(friendly(error));
}

/** Finish a sign-in link (?code=… in the URL). Returns the user, or null if there was nothing to finish. */
export async function completeSignInFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const err = params.get('error_description');
  if (!code && !err) return null;
  history.replaceState(null, '', `${location.pathname}#/profile`);
  if (err) throw new Error(err);
  const { data, error } = await getClient().auth.exchangeCodeForSession(code);
  if (error) throw new Error(friendly(error));
  return data.user;
}

export async function signOut() {
  await getClient().auth.signOut();
  try { localStorage.removeItem(META_KEY); } catch { /* storage unavailable */ }
}

// ---------- cloud copy ----------
export async function fetchRemote() {
  const { data, error } = await getClient().from('athlete_state').select('state, rev, updated_at, device_id').maybeSingle();
  if (error) throw new Error(friendly(error));
  return data; // null when this athlete has never backed up
}

async function pushState(base, state) {
  const { data, error } = await getClient().rpc('save_state', { p_expected_rev: base, p_state: state, p_schema_version: SCHEMA_VERSION, p_device_id: deviceLabel() });
  if (error) {
    if (error.code === 'PT409' || /rev conflict/i.test(error.message)) throw Object.assign(new Error('The cloud copy changed on another device.'), { conflict: true });
    throw new Error(friendly(error));
  }
  return Array.isArray(data) ? data[0] : data;
}

/**
 * "Back up now". Returns { status: 'saved' | 'up-to-date' | 'needs-choice', rev, report }.
 * Pass `choice` ('merge' | 'cloud' | 'local') to answer a needs-choice result.
 */
export async function backupNow({ choice } = {}) {
  const user = await currentUser();
  if (!user) throw new Error('Sign in first.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const local = load();
    const remote = await fetchRemote();
    if (remote) assertReadable(remote.state);
    const plan = planBackup({ local, remote, meta: readMeta(), userId: user.id });
    if (plan.action === 'none') { writeMeta(user.id, remote.rev); return { status: 'up-to-date', rev: remote.rev }; }
    if (plan.action === 'choose' && !choice) return { status: 'needs-choice', remote: summary(remote) };

    const how = plan.action === 'choose' ? choice : plan.action === 'merge' ? 'merge' : 'local';
    keepPreSyncCopy(local, `before ${how === 'cloud' ? 'using the cloud copy' : how === 'merge' ? 'merging with the cloud' : 'backing up'}`);
    const { state, report } = remote ? resolve(how, local, remote.state) : { state: local, report: null };
    if (state !== local) replaceState(state);
    if (how === 'cloud') { writeMeta(user.id, remote.rev); return { status: 'saved', rev: remote.rev, report, usedCloud: true }; }
    try {
      const saved = await pushState(plan.base, state);
      writeMeta(user.id, saved.rev);
      return { status: 'saved', rev: saved.rev, report };
    } catch (e) {
      if (!e.conflict || attempt === 1) throw e;
      choice = 'merge'; // someone saved in between: pull again and merge on the retry
    }
  }
  throw new Error('Backup did not complete.');
}

/** "Restore from cloud": bring the cloud copy into this browser (merge, or replace local). */
export async function restoreFromCloud(choice) {
  const user = await currentUser();
  if (!user) throw new Error('Sign in first.');
  const remote = await fetchRemote();
  if (!remote) throw new Error('There is no cloud backup for this account yet.');
  const local = load();
  keepPreSyncCopy(local, choice === 'cloud' ? 'before replacing with the cloud copy' : 'before restoring from the cloud');
  const { state, report } = resolve(choice, local, remote.state);
  replaceState(state);
  writeMeta(user.id, remote.rev);
  return { rev: remote.rev, report };
}

// ---------- local safety copy & metadata ----------
export function keepPreSyncCopy(state, reason) {
  try { localStorage.setItem(PRESYNC_KEY, JSON.stringify({ savedAt: new Date().toISOString(), reason, state })); } catch { /* storage full/unavailable */ }
}

export function preSyncCopy() {
  try { return JSON.parse(localStorage.getItem(PRESYNC_KEY) || 'null'); } catch { return null; }
}

/** Put this browser back exactly as it was before the last sync (cloud copy is not touched). */
export function undoLastSync() {
  const copy = preSyncCopy();
  if (!copy?.state) throw new Error('There is no saved copy to go back to.');
  replaceState(copy.state);
  try { localStorage.removeItem(META_KEY); } catch { /* ignore */ }
  return copy;
}

export function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch { return null; }
}

function writeMeta(userId, rev) {
  try { localStorage.setItem(META_KEY, JSON.stringify({ userId, rev, syncedAt: new Date().toISOString() })); } catch { /* ignore */ }
}

function summary(remote) {
  return { rev: remote.rev, updatedAt: remote.updated_at, device: remote.device_id, logs: Object.keys(remote.state?.logs || {}).length };
}

function deviceLabel() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const kind = /iPhone|Android.+Mobile/.test(ua) ? 'phone' : /iPad|Tablet|Android/.test(ua) ? 'tablet' : 'computer';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${browser} on ${kind}`;
}

function friendly(error) {
  const m = error?.message || String(error);
  if (/rate limit|too many/i.test(m)) return 'Too many emails requested — wait a few minutes and try again.';
  if (/fetch|network|Failed to fetch/i.test(m)) return 'Could not reach the cloud — check your connection.';
  if (/expired|invalid.*(code|grant)|code verifier/i.test(m)) return 'That sign-in link expired or was opened in a different browser. Request a new link and open it in this browser.';
  return m;
}
