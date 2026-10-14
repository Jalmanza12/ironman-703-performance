// Profile → "Cloud backup (optional)". Sign in with an emailed link, then back up / restore by hand.
// The Supabase client (js/store/cloud.js) is only loaded once the athlete uses this card.

import { esc, toast } from './h.js';

const loadCloud = () => import('../store/cloud.js');

export const cloudCardHTML = `<div class="card span-all" id="cloud"><h2>Cloud backup <span class="chip">optional</span></h2><div id="cloudbody"><p class="small muted">Loading…</p></div></div>`;

/** True if this browser has signed in before (avoids loading the client for athletes who never use it). */
function hasCloudTrace() {
  try {
    if (localStorage.getItem('im703:cloud')) return true;
    for (let i = 0; i < localStorage.length; i++) if (/^sb-.*-auth-token$/.test(localStorage.key(i))) return true;
  } catch { /* storage unavailable */ }
  return false;
}

export function mountCloudCard(root, rerender) {
  const body = root.querySelector('#cloudbody');
  if (!body) return;
  const show = (html, bind) => { body.innerHTML = html; bind?.(body); };
  const fail = (e) => { toast(e.message || String(e)); refresh(); };

  async function refresh() {
    if (!hasCloudTrace()) return showSignedOut();
    try {
      const cloud = await loadCloud();
      const user = await cloud.currentUser();
      if (!user) return showSignedOut();
      showSignedIn(cloud, user);
    } catch (e) {
      show(`<p class="small">Cloud backup is unavailable right now (${esc(e.message)}). Your data is safe in this browser.</p>`);
    }
  }

  function showSignedOut() {
    show(`<p class="small text-2">Back up this browser's training data to your own private cloud account, and restore it on another device. Your data stays in this browser too; nothing syncs automatically, and only you can read your backup.</p>
      <form id="cloudsignin" class="row" novalidate><label class="f" style="flex:1;min-width:220px">Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><button class="btn primary">Email me a sign-in link</button></form>
      <p class="small muted">Open the link on this device, in this browser.</p>`, (el) => {
      el.querySelector('#cloudsignin').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = new FormData(e.target).get('email')?.toString().trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return toast('Enter a valid email address.');
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        try {
          const cloud = await loadCloud();
          await cloud.sendSignInLink(email);
          show(`<p>Check <b>${esc(email)}</b> for a sign-in link and open it <b>in this browser</b>. It brings you back here signed in.</p><p class="small muted">No email after a few minutes? Check spam, then try again.</p><button class="btn sm" id="cloudback">Use a different email</button>`, (b) => b.querySelector('#cloudback').addEventListener('click', showSignedOut));
        } catch (er) { btn.disabled = false; toast(er.message); }
      });
    });
  }

  function showSignedIn(cloud, user) {
    const meta = cloud.readMeta();
    const pre = cloud.preSyncCopy();
    const last = meta && meta.userId === user.id ? `Last synced ${esc(new Date(meta.syncedAt).toLocaleString())} (cloud version ${meta.rev}).` : 'This browser has not synced with your cloud backup yet.';
    show(`<p class="small">Signed in as <b>${esc(user.email || 'athlete')}</b>. ${last}</p>
      <div class="row"><button class="btn primary" id="cloudbackup">Back up now</button><button class="btn" id="cloudrestore">Restore from cloud…</button><button class="btn" id="cloudout">Sign out</button></div>
      ${pre ? `<p class="small muted" style="margin-top:10px">A copy of this browser's data was kept ${esc(pre.reason || 'before the last sync')} (${esc(new Date(pre.savedAt).toLocaleString())}). <button class="btn sm" id="cloudundo">Undo last sync</button></p>` : ''}
      <div id="cloudchoice"></div>`, (el) => {
      el.querySelector('#cloudbackup').addEventListener('click', () => runBackup(cloud));
      el.querySelector('#cloudrestore').addEventListener('click', () => askRestore(cloud, el));
      el.querySelector('#cloudout').addEventListener('click', async () => { await cloud.signOut(); toast('Signed out. Your data is still in this browser.'); refresh(); });
      el.querySelector('#cloudundo')?.addEventListener('click', () => {
        if (!confirm('Put this browser back exactly as it was before the last sync? (Your cloud backup is not changed.)')) return;
        try { cloud.undoLastSync(); toast('Restored the copy from before the last sync.'); rerender(); } catch (e) { fail(e); }
      });
    });
  }

  async function runBackup(cloud, choice) {
    setBusy(true);
    try {
      const { describeReport } = await import('../store/sync.js');
      const r = await cloud.backupNow({ choice });
      if (r.status === 'needs-choice') return askFirstSync(cloud, r.remote);
      toast(r.status === 'up-to-date' ? 'Already backed up — nothing changed.' : r.usedCloud ? 'This browser now has the cloud copy.' : `Backed up${r.report ? ` (${describeReport(r.report)})` : ''}.`);
      rerender();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  function askFirstSync(cloud, remote) {
    const box = body.querySelector('#cloudchoice');
    box.innerHTML = `<div class="alert warning" style="margin-top:12px"><div class="h">Your cloud account already has a backup</div>
      <p class="small">Saved ${esc(new Date(remote.updatedAt).toLocaleString())}${remote.device ? ` from ${esc(remote.device)}` : ''} · ${remote.logs} logged workout${remote.logs === 1 ? '' : 's'}. This browser has its own data too. A copy of this browser's data is kept either way.</p>
      <div class="row"><button class="btn primary" data-c="merge">Merge both (recommended)</button><button class="btn" data-c="cloud">Use the cloud copy here</button><button class="btn danger" data-c="local">Replace the cloud with this browser</button></div></div>`;
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.c === 'local' && !confirm('Replace your cloud backup with this browser\'s data? (Earlier cloud versions are kept for recovery.)')) return;
      runBackup(cloud, b.dataset.c);
    }));
  }

  function askRestore(cloud, el) {
    const box = el.querySelector('#cloudchoice');
    box.innerHTML = `<div class="alert" style="margin-top:12px"><div class="h">Restore from your cloud backup</div>
      <p class="small">A copy of this browser's current data is kept first, so you can undo.</p>
      <div class="row"><button class="btn primary" data-r="merge">Merge into this browser (recommended)</button><button class="btn danger" data-r="cloud">Replace this browser's data</button></div></div>`;
    box.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.r === 'cloud' && !confirm('Replace everything in this browser with the cloud copy?')) return;
      setBusy(true);
      try {
        const { describeReport } = await import('../store/sync.js');
        const r = await cloud.restoreFromCloud(b.dataset.r);
        toast(`Restored from the cloud${r.report ? ` (${describeReport(r.report)})` : ''}.`);
        rerender();
      } catch (e) { fail(e); } finally { setBusy(false); }
    }));
  }

  function setBusy(on) {
    body.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  }

  refresh();
}
