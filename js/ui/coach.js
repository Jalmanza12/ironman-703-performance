// AI Coach page: a real conversational agent (Claude via the athlete's own Worker backend) that
// reads the actual plan through tools and proposes changes. Nothing changes until the athlete
// presses "Accept Changes". There is no rules-based fallback: if the backend isn't configured or
// fails, the page says so and no reply is fabricated.

import { esc, toast } from './h.js';
import { load, save } from '../store/store.js';
import { context as appContext } from '../context.js';
import { formatShort, dayOfWeek, DOW, diffDays, mondayOf, isISODate as isISO } from '../lib/dates.js';
import { effectiveSessionsOn, applyProposal, fingerprint, affectedIds, undoChange, canUndo } from '../lib/adjustments.js';
import { detectRedFlags } from '../lib/coachSafety.js';
import { checkHealth } from '../lib/coachCore.js';
import { runTurn, ensureCoachState, recordEvent, newConversation } from '../lib/coachAgent.js';
import { RACE } from '../data/race.js';
import { PHASES } from '../plan/weeks.js';
import { DEFAULT_COACH_ENDPOINT } from '../data/coachConfig.js';

const CONN_KEY = 'im703:coach-conn'; // endpoint + access code: per-device, never exported in backups

export function getConn() {
  try {
    const c = JSON.parse(localStorage.getItem(CONN_KEY) || '{}');
    return { endpoint: c.endpoint || DEFAULT_COACH_ENDPOINT, accessCode: c.accessCode || '' };
  } catch {
    return { endpoint: DEFAULT_COACH_ENDPOINT, accessCode: '' };
  }
}
function setConn(c) {
  try { localStorage.setItem(CONN_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

const SUGGESTIONS = [
  ['What do I have tomorrow?', 'What session do I have tomorrow?', 'send'],
  ['Adjust my training week', 'Look at my training this week and tell me if anything should change.', 'send'],
  ['I need to skip a workout', 'I need to skip ', 'fill'],
  ['I am feeling unusually fatigued', "I'm feeling unusually fatigued today. What should I do with my training?", 'send'],
  ['Review my recent training', 'Review my recent training and tell me what to focus on next.', 'send'],
  ['Help me prepare for race day', 'How should I prepare for race day in Dallas?', 'send'],
];

const MODE_LABEL = { ai: 'AI · Claude', mock: 'Development mock — not AI' };

let busy = false;
let progress = '';
let health = { state: 'unknown', text: 'Checking…' };
let healthFor = '';

function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch { return 'local'; }
}

function statusPill(conn) {
  if (!conn.endpoint) return '<span class="chip bad">Not connected — setup required</span>';
  const cls = health.state === 'ok' ? 'good' : health.state === 'mock' ? 'warn' : health.state === 'unknown' ? '' : 'bad';
  return `<span class="chip ${cls}" id="coach-status"><span class="dot" style="background:currentColor"></span>${esc(health.text)}</span>`;
}

/** Escape, then allow **bold** and simple "- " bullet lines. */
function richText(t) {
  const lines = esc(t).split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const l = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^\s*[-•]\s+/.test(l)) {
      if (!inList) { html += '<ul class="clean">'; inList = true; }
      html += `<li>${l.replace(/^\s*[-•]\s+/, '')}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += l.trim() ? `<p>${l}</p>` : '';
    }
  }
  return html + (inList ? '</ul>' : '');
}

function proposalCard(m, ctx) {
  const p = m.proposal;
  const v = m.validation || { ok: true, errors: [], warnings: [], items: [] };
  const status = m.proposalStatus;
  const rows = p.changes.map((c, i) => {
    const item = v.items?.[i] || {};
    const orig = ctx.plan.sessions[c.workoutId];
    const before = item.before;
    const after = item.after;
    const proposed = (() => {
      if (!orig) return '<span class="err">Unknown workout</span>';
      if (c.action === 'skip') return '<b>Skip</b> — removed from the plan (not logged as completed)';
      if (c.action === 'move') return `<b>Move</b> to ${esc(isISO(c.newDate) ? formatShort(c.newDate) : String(c.newDate))}${c.newDurationMin ? `, shortened to ${c.newDurationMin} min` : ''}`;
      if (c.action === 'shorten') return `<b>Shorten</b> to ${c.newDurationMin} min`;
      if (c.action === 'replace') return `<b>Replace</b> with ${esc(c.replacement?.title)} · ${c.replacement?.durationMin} min · ${esc(c.replacement?.intensity)} (${esc(c.replacement?.sport)})${c.replacement?.description ? `<div class="small muted">${esc(c.replacement.description)}</div>` : ''}`;
      return esc(c.action);
    })();
    return `<tr><td>${orig ? `${esc(before?.title || orig.title)}<div class="small muted">${esc(formatShort(before?.date || orig.date))} · ${before?.durationMin ?? orig.durationMin} min · ${esc(orig.intensity)} · ${esc(orig.priority || '')}</div>` : `<span class="err">${esc(c.workoutId)}</span>`}</td>
      <td>${proposed}${after && c.action !== 'skip' ? `<div class="small muted">${esc(formatShort(after.date))} · ${after.durationMin} min</div>` : ''}</td>
      <td class="small">${esc(c.reason || '')}${(item.errors || []).map((e) => `<div class="err">✕ ${esc(e)}</div>`).join('')}${(item.warnings || []).map((w) => `<div class="muted">⚠ ${esc(w)}</div>`).join('')}</td></tr>`;
  }).join('');
  const av = p.availabilityUpdate ? `<div class="block-label">Availability update</div><p class="small">${p.availabilityUpdate.changes.map((d) => `${d.day.toUpperCase()}: ${d.available ? `available${d.maxMinutes ? ` (≤${d.maxMinutes} min)` : ''}` : 'unavailable'}`).join(' · ')}</p>` : '';
  const statusChip = { pending: '<span class="chip warn">Awaiting your approval</span>', accepted: '<span class="chip good">Accepted — applied to plan</span>', rejected: '<span class="chip">Rejected — plan unchanged</span>', superseded: '<span class="chip">Replaced by a newer proposal</span>', withdrawn: '<span class="chip">Withdrawn — plan unchanged</span>', invalid: '<span class="chip bad">Failed validation — cannot be applied</span>' }[status] || '';
  const globalErrors = (v.errors || []).filter((e) => !(v.items || []).some((it) => (it.errors || []).includes(e)));
  return `<div class="proposal ${esc(status)}" role="group" aria-label="Proposed training change">
    <div class="row between"><b>${esc(p.summary)}</b>${statusChip}</div>
    ${p.changes.length ? `<div class="table-wrap"><table class="ex"><thead><tr><th>Original</th><th>Proposed</th><th>Reason & checks</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${av}
    ${globalErrors.map((e) => `<p class="err">✕ ${esc(e)}</p>`).join('')}
    ${p.expectedImpact ? `<p class="small"><b>Expected impact:</b> ${esc(p.expectedImpact)}</p>` : ''}
    ${p.recoveryNotes ? `<p class="small"><b>Recovery:</b> ${esc(p.recoveryNotes)}</p>` : ''}
    ${m.staleNote ? `<p class="small warn-text">⚠ ${esc(m.staleNote)}</p>` : ''}
    ${status === 'pending' ? `<div class="row" style="margin-top:8px"><button class="btn primary" data-accept="${esc(m.id)}" ${v.ok ? '' : 'disabled'}>Accept Changes</button><button class="btn" data-reject="${esc(m.id)}">Reject Changes</button><button class="btn ghost sm" data-revise="${esc(m.id)}">Request changes</button></div>` : ''}
    ${status === 'accepted' && m.changeId ? `<p class="small muted">Change ${esc(m.changeId)} · <a href="#/calendar/week/${esc(mondayOf(p.changes[0]?.newDate || ctx.plan.sessions[p.changes[0]?.workoutId]?.date || ctx.today))}">view week</a></p>` : ''}
  </div>`;
}

function messageHTML(m, ctx) {
  const time = m.at ? new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  if (m.role === 'athlete') return `<div class="msg athlete"><div class="bubble">${esc(m.text)}</div><div class="meta">You · ${esc(time)}</div></div>`;
  if (m.role === 'notice') return `<div class="msg notice ${esc(m.level || '')}"><div class="bubble">${esc(m.text)}${m.retryText ? ` <button class="btn sm" data-retry="${esc(m.id)}">Try again</button>` : ''}</div><div class="meta">${esc(m.level === 'safety' ? 'Safety notice from the app' : 'App')} · ${esc(time)}</div></div>`;
  if (m.role !== 'coach') return '';
  const label = MODE_LABEL[m.mode] || 'Earlier version (not AI)';
  return `<div class="msg coach"><div class="bubble">${richText(m.text)}${m.proposal ? proposalCard(m, ctx) : ''}</div><div class="meta"><span class="chip ${m.mode === 'ai' ? 'good' : 'warn'}">${esc(label)}</span>${m.tools?.length ? `<span class="muted">· ${esc(m.tools.join(' · '))}</span>` : ''} · ${esc(time)}</div></div>`;
}

function setupCard(conn) {
  if (conn.endpoint) {
    return `<div class="alert warning" style="margin:14px 0"><div class="h">Enter your access code to connect</div>
      <div class="small">The AI backend is deployed. Paste your private access code under <b>Connection</b> (right) and press <b>Save</b>. It's stored only on this device.</div></div>`;
  }
  return `<div class="alert warning" style="margin:14px 0"><div class="h">The AI Coach is not connected</div>
    <div class="small">The coach needs its secure backend (a Cloudflare Worker that holds your Anthropic API key). Until it's connected, no AI replies are generated — nothing is simulated.</div>
    <ol class="small" style="margin:6px 0 0 18px"><li>Deploy the backend: <code>cd worker && npx wrangler login && npx wrangler secret put ANTHROPIC_API_KEY && npx wrangler secret put COACH_ACCESS_CODE && npx wrangler deploy</code></li><li>Open <b>Connection</b> (right), paste the Worker URL and your access code, press <b>Save</b>, then <b>Test connection</b>.</li></ol>
    <div class="small muted" style="margin-top:6px">Full guide: <a href="https://github.com/Jalmanza12/ironman-703-performance/blob/main/docs/ai-coach.md" target="_blank" rel="noopener">docs/ai-coach.md</a>${conn.endpoint ? '' : ''}</div></div>`;
}

export function coachView(ctx, _params, rerender) {
  const conn = getConn();
  const coach = ensureCoachState(ctx.state);
  const msgs = coach.messages;
  const day = ctx.plan.byDate[ctx.today] || (ctx.today < ctx.plan.days[0].date ? ctx.plan.days[0] : ctx.plan.days[ctx.plan.days.length - 1]);
  const week = ctx.plan.weeks[day.week];
  const history = [...(ctx.state.changeHistory || [])].reverse().slice(0, 8);
  const daysToRace = Math.max(0, diffDays(ctx.today, RACE.date));
  const connected = !!conn.endpoint && !!conn.accessCode;
  const unhealthy = connected && health.state === 'bad';

  const html = `
  <div class="page-head coach-head">
    <div><div class="eyebrow">AI Coach · ${esc(RACE.name)} in ${daysToRace} days</div><h1>AI Coach</h1>
      <div class="row">${statusPill(conn)}<span class="phase-pill ${PHASES[day.phase].color}">${esc(day.phaseName)} · Week ${day.week}</span></div></div>
  </div>
  <p class="disclaimer">Replies are generated by an AI model (Claude) using your actual plan, logs and check-ins. They are coaching suggestions, not medical advice. Nothing changes in your plan until you press <b>Accept Changes</b>, and every change is validated against your schedule first.</p>
  ${!connected ? setupCard(conn) : unhealthy ? `<div class="alert warning" style="margin:14px 0"><div class="h">AI Coach backend problem: ${esc(health.text)}</div><div class="small">Messages can't be answered until this is fixed. See Connection → Test connection, or <a href="https://github.com/Jalmanza12/ironman-703-performance/blob/main/docs/ai-coach.md" target="_blank" rel="noopener">the setup guide</a>.</div></div>` : ''}
  <div class="coach-grid">
    <section class="card coach-chat" aria-label="Conversation">
      <div class="chat-log" id="chatlog" aria-live="polite">
        ${msgs.length ? msgs.map((m) => messageHTML(m, ctx)).join('') : `<div class="chat-empty"><p class="serif" style="font-size:1.2rem">Talk to your coach</p><p class="muted small">Ask anything about your training — what's on tomorrow, a missed workout, a schedule conflict, how you feel, or race preparation. I'll check your actual plan and propose changes for you to approve.</p></div>`}
        ${busy ? `<div class="msg coach"><div class="bubble"><span class="typing" aria-hidden="true"><span></span><span></span><span></span></span> <span class="small muted" id="progress">${esc(progress || 'Thinking…')}</span></div></div>` : ''}
      </div>
      <div class="suggestions" role="group" aria-label="Suggested prompts">${SUGGESTIONS.map(([label], i) => `<button class="chip-btn" data-sugg="${i}" ${busy || !connected ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>
      <form id="chatform" class="chat-input" novalidate>
        <label class="sr-only" for="chatbox">Message your coach</label>
        <textarea id="chatbox" rows="2" maxlength="4000" placeholder="${connected ? 'e.g., I can\'t train tomorrow because of work' : 'Connect the AI backend to start (see setup above)'}" ${busy ? 'disabled' : ''}></textarea>
        <button class="btn primary" type="submit" ${busy ? 'disabled' : ''} aria-label="Send">Send</button>
      </form>
      <p class="small err" id="chaterr" role="alert" style="padding:0 14px"></p>
    </section>
    <aside class="stack">
      <div class="card flat"><h3>This week — ${esc(week.title)}</h3><ul class="clean small week-mini">${week.days.flatMap((d) => effectiveSessionsOn(ctx.plan, ctx.state, d.date).filter((s) => s.sport !== 'rest').map((s) => `<li class="${s.cancelled ? 'muted strike' : ''}">${esc(DOW[dayOfWeek(s.date)].slice(0, 3))} · <a href="#/session/${encodeURIComponent(s.id)}">${esc(s.title)}</a> <span class="muted">${s.durationMin || 0}′</span>${ctx.state.logs[s.id] ? ` <span class="muted">(${esc(ctx.state.logs[s.id].status)})</span>` : ''}${s.adjusted ? ' ✎' : ''}</li>`)).join('') || '<li>No sessions.</li>'}</ul></div>
      <div class="card flat"><h3>Change history</h3>${history.length ? `<ul class="clean small">${history.map((h) => { const u = canUndo(ctx.state, h, { today: ctx.today }); return `<li><b>${esc(h.summary || 'Change')}</b> <span class="muted">· ${esc(new Date(h.at).toLocaleDateString())} · ${esc(h.source)} · ${esc(h.status)}</span>${h.status === 'applied' ? (u.ok ? ` <button class="btn sm ghost" data-undo="${esc(h.id)}">Undo</button>` : ` <span class="muted" title="${esc(u.reason)}">(undo unavailable)</span>`) : ''}</li>`; }).join('')}</ul>` : '<p class="small muted">No plan changes yet.</p>'}</div>
      <details class="card flat" ${!connected || unhealthy ? 'open' : ''}><summary><b>Connection</b></summary>
        <form id="connform" class="stack" style="margin-top:8px" novalidate>
          <label class="f">Backend URL<input name="endpoint" type="url" placeholder="https://im703-coach.your-name.workers.dev" value="${esc(conn.endpoint)}"></label>
          <label class="f">Access code <span class="hint">your own passphrase for the backend (not an AI API key)</span><input name="accessCode" type="password" autocomplete="off" value="${esc(conn.accessCode)}"></label>
          <div class="row"><button class="btn sm primary">Save</button><button class="btn sm" type="button" id="testconn">Test connection</button></div>
          <p class="small muted">Stored only on this device and excluded from backups. Your Anthropic API key lives only on the server.</p>
        </form></details>
      ${msgs.length ? '<button class="btn sm ghost" id="newchat">New conversation</button>' : ''}
    </aside>
  </div>`;

  return {
    html,
    mount(root) {
      const log = root.querySelector('#chatlog');
      log.scrollTop = log.scrollHeight;
      const box = root.querySelector('#chatbox');
      const form = root.querySelector('#chatform');
      if (conn.endpoint && (health.state === 'unknown' || healthFor !== conn.endpoint)) {
        healthFor = conn.endpoint;
        checkHealth(conn.endpoint).then((h) => { health = h; rerender(); });
      }
      form.addEventListener('submit', (e) => { e.preventDefault(); send(box.value, rerender, root); });
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(box.value, rerender, root); } });
      if (!busy) box.focus({ preventScroll: true });
      root.querySelectorAll('[data-sugg]').forEach((b) => b.addEventListener('click', () => {
        const [, text, kind] = SUGGESTIONS[Number(b.dataset.sugg)];
        if (kind === 'send') send(text, rerender, root);
        else { box.value = text; box.focus(); box.setSelectionRange(text.length, text.length); }
      }));
      root.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => {
        const st = load();
        const m = st.coach.messages.find((x) => x.id === b.dataset.retry);
        if (!m) return;
        // Remove the failed attempt (athlete msg + error) from the display; it never reached the transcript.
        const i = st.coach.messages.indexOf(m);
        st.coach.messages.splice(Math.max(0, i - 1), 2);
        save(st);
        send(m.retryText, rerender, root);
      }));
      root.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => accept(b.dataset.accept, rerender)));
      root.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => reject(b.dataset.reject, rerender)));
      root.querySelectorAll('[data-revise]').forEach((b) => b.addEventListener('click', () => { box.value = ''; box.placeholder = 'What would you like changed? e.g., "Make it shorter" or "I meant Saturday"'; box.focus(); }));
      root.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => {
        const st = load();
        const entry = (st.changeHistory || []).find((h) => h.id === b.dataset.undo);
        const r = undoChange(st, b.dataset.undo, { today: appContext().today });
        if (!r.ok) return toast(`Can't undo: ${r.reason}`);
        ensureCoachState(r.state);
        r.state.coach.messages.push({ id: `n-${Date.now()}`, role: 'notice', at: new Date().toISOString(), text: 'Change undone — the previous schedule is restored.' });
        recordEvent(r.state, `The athlete UNDID the change "${entry?.summary || ''}"; the original schedule is restored.`);
        save(r.state);
        toast('Change undone.');
        rerender();
      }));
      root.querySelector('#connform').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const endpoint = String(fd.get('endpoint') || '').trim().replace(/\/$/, '');
        if (endpoint && !/^https:\/\/[^\s]+$|^http:\/\/localhost(:\d+)?$/.test(endpoint)) return toast('Backend URL must start with https://');
        setConn({ endpoint, accessCode: String(fd.get('accessCode') || '') });
        health = { state: 'unknown', text: 'Checking…' };
        healthFor = '';
        toast('Connection saved.');
        rerender();
      });
      root.querySelector('#testconn').addEventListener('click', async () => {
        const c = getConn();
        health = await checkHealth(c.endpoint);
        toast(health.text);
        rerender();
      });
      root.querySelector('#newchat')?.addEventListener('click', () => {
        if (!confirm('Start a new conversation? Any pending proposal is discarded; applied changes and history are kept.')) return;
        save(newConversation(load()));
        rerender();
      });
    },
  };
}

export async function send(textRaw, rerender, root) {
  const text = String(textRaw || '').trim();
  const errEl = root?.querySelector('#chaterr');
  if (errEl) errEl.textContent = '';
  if (!text) { if (errEl) errEl.textContent = 'Type a message first.'; return; }
  if (busy) return;
  const conn = getConn();
  if (!conn.endpoint) { if (errEl) errEl.textContent = 'The AI Coach is not connected yet — see the setup steps above. No reply can be generated until the backend is connected.'; return; }
  if (!conn.accessCode) { if (errEl) errEl.textContent = 'Enter your access code under Connection (right) and press Save first.'; return; }

  // Safety: serious symptoms get an immediate app notice; the AI is still asked (it is instructed to prioritize safety).
  const flags = detectRedFlags(text);
  if (flags.length) {
    const st = load();
    ensureCoachState(st);
    st.coach.messages.push({ id: `s-${Date.now()}`, role: 'notice', level: 'safety', at: new Date().toISOString(), text: `You mentioned ${flags.join(' and ')}. Stop exercising. If symptoms are severe or ongoing, call emergency services (911 in the US) or seek urgent medical care now.` });
    save(st);
  }

  busy = true;
  progress = 'Thinking…';
  if (root?.querySelector('#chatbox')) root.querySelector('#chatbox').value = '';
  rerender();
  try {
    await runTurn(text, {
      conn, timeZone: timeZone(), getCtx: appContext, loadState: load, saveState: save,
      onProgress: (p) => { progress = p; const el = document.getElementById('progress'); if (el) el.textContent = p; },
    });
    health = health.state === 'ok' ? health : { state: 'ok', text: 'AI connected' };
  } catch (e) {
    if (e.kind === 'not_configured') health = { state: 'bad', text: e.message };
    else if (e.kind === 'unauthorized') health = { state: 'bad', text: 'Access code rejected' };
    else if (e.kind === 'network') health = { state: 'bad', text: 'Backend unreachable' };
    console.warn('AI Coach turn failed:', e.kind, e.message);
  } finally {
    busy = false;
    progress = '';
    rerender();
  }
}

/** Accept: re-validate against the current plan, apply atomically, record history. */
export function acceptProposal(messageId, { today, plan } = {}) {
  const st = load();
  ensureCoachState(st);
  const m = st.coach.messages.find((x) => x.id === messageId);
  if (!m?.proposal || m.proposalStatus !== 'pending') return { ok: false, reason: 'This proposal is no longer pending.' };
  const res = applyProposal(plan, st, m.proposal, { today, source: m.mode === 'ai' ? 'ai' : m.mode || 'ai' });
  if (!res.ok) {
    m.validation = res.validation;
    if (res.stale && res.validation.ok) {
      m.proposal.fingerprint = fingerprint(st, affectedIds(m.proposal));
      m.proposal.today = today;
      m.staleNote = 'Your plan changed since this was proposed. It was re-checked against the current schedule — review and accept again.';
    } else {
      m.proposalStatus = 'invalid';
      m.staleNote = res.stale ? 'Your plan changed since this was proposed and the change no longer fits. Nothing was applied.' : '';
      recordEvent(st, `The athlete tried to accept "${m.proposal.summary}" but it failed validation (${res.validation.errors[0] || 'plan changed'}); nothing was applied.`);
    }
    save(st);
    return { ok: false, reason: res.validation.errors[0] || m.staleNote };
  }
  const next = res.state;
  ensureCoachState(next);
  const nm = next.coach.messages.find((x) => x.id === messageId);
  nm.proposalStatus = 'accepted';
  nm.changeId = res.entry.id;
  nm.staleNote = '';
  next.coach.messages.push({ id: `n-${Date.now()}`, role: 'notice', at: new Date().toISOString(), text: `Applied: ${m.proposal.summary}. Your calendar, dashboard and Today view are updated. You can undo it from Change history.` });
  recordEvent(next, `The athlete ACCEPTED the proposal "${m.proposal.summary}"; it is now applied to the plan.`);
  save(next);
  return { ok: true, entry: res.entry };
}

function accept(id, rerender) {
  const ctx = appContext();
  const r = acceptProposal(id, { today: ctx.today, plan: ctx.plan });
  toast(r.ok ? 'Changes applied to your plan.' : `Not applied: ${r.reason}`);
  rerender();
}

export function rejectProposal(messageId) {
  const st = load();
  ensureCoachState(st);
  const m = st.coach.messages.find((x) => x.id === messageId);
  if (!m?.proposal || m.proposalStatus !== 'pending') return false;
  m.proposalStatus = 'rejected';
  st.coach.messages.push({ id: `n-${Date.now()}`, role: 'notice', at: new Date().toISOString(), text: 'Proposal rejected — your plan is unchanged.' });
  recordEvent(st, `The athlete REJECTED the proposal "${m.proposal.summary}"; the plan is unchanged.`);
  save(st);
  return true;
}

function reject(id, rerender) {
  rejectProposal(id);
  rerender();
}
