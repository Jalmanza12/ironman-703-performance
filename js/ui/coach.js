// AI Coach page: conversation, suggested prompts, proposal cards with Accept / Reject,
// change history with undo, and backend connection settings.

import { esc, toast } from './h.js';
import { load, save } from '../store/store.js';
import { context as appContext } from '../context.js';
import { formatShort, dayOfWeek, DOW, diffDays, mondayOf, isISODate as isISO } from '../lib/dates.js';
import { effectiveSessionsOn, applyProposal, fingerprint, affectedIds, undoChange, canUndo } from '../lib/adjustments.js';
import { planOffline, detectRedFlags, classifyIntent } from '../lib/coachRules.js';
import { buildCoachContext, callCoachAPI, toCoachMessage, supersedePending, activeProposal, lastPending, transcript, CoachError } from '../lib/coachCore.js';
import { RACE } from '../data/race.js';
import { PHASES } from '../plan/weeks.js';

const CONN_KEY = 'im703:coach-conn'; // endpoint + access code: per-device, never exported in backups
const MAX_MESSAGES = 200;

export function getConn() {
  try {
    return { endpoint: '', accessCode: '', useAI: true, ...(JSON.parse(localStorage.getItem(CONN_KEY) || '{}')) };
  } catch {
    return { endpoint: '', accessCode: '', useAI: true };
  }
}
function setConn(c) {
  try { localStorage.setItem(CONN_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

const SUGGESTIONS = [
  ['Adjust my training week', 'Look at my training this week and suggest adjustments if anything should change.', 'send'],
  ['I need to skip a workout', 'I need to skip ', 'fill'],
  ['I am feeling unusually fatigued', "I'm feeling unusually fatigued today. Should I change my training?", 'send'],
  ['Help me prepare for race day', 'Help me prepare for race day — what should I focus on from now until the race?', 'send'],
  ['Review my recent training', 'Review my recent training and tell me what to focus on next.', 'send'],
  ['Change my availability', 'I can no longer train on ', 'fill'],
];

const MODE_LABEL = { ai: 'AI · Claude', rules: 'Rules-based planner — not AI', mock: 'Mock response — not AI', system: 'App' };

let busy = false;
let health = { state: 'unknown', text: 'Checking…' };

function statusPill(conn) {
  if (!conn.useAI) return '<span class="chip">Rules-based planner only (AI off)</span>';
  if (!conn.endpoint) return '<span class="chip warn" title="Add the backend URL under Connection">AI backend not configured</span>';
  const cls = health.state === 'ok' ? 'good' : health.state === 'mock' ? 'warn' : health.state === 'unknown' ? '' : 'bad';
  return `<span class="chip ${cls}" id="coach-status"><span class="dot" style="background:currentColor"></span>${esc(health.text)}</span>`;
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
      if (c.action === 'replace') return `<b>Replace</b> with ${esc(c.replacement?.title)} · ${c.replacement?.durationMin} min · ${esc(c.replacement?.intensity)} (${esc(c.replacement?.sport)})`;
      return esc(c.action);
    })();
    return `<tr><td>${orig ? `${esc(before?.title || orig.title)}<div class="small muted">${esc(formatShort(before?.date || orig.date))} · ${before?.durationMin ?? orig.durationMin} min · ${esc(orig.intensity)} · ${esc(orig.priority || '')}</div>` : `<span class="err">${esc(c.workoutId)}</span>`}</td>
      <td>${proposed}${after && c.action !== 'skip' ? `<div class="small muted">${esc(formatShort(after.date))} · ${after.durationMin} min</div>` : ''}</td>
      <td class="small">${esc(c.reason || '')}${(item.errors || []).map((e) => `<div class="err">✕ ${esc(e)}</div>`).join('')}${(item.warnings || []).map((w) => `<div class="muted">⚠ ${esc(w)}</div>`).join('')}</td></tr>`;
  }).join('');
  const av = p.availabilityUpdate ? `<div class="block-label">Availability update</div><p class="small">${p.availabilityUpdate.changes.map((d) => `${d.day.toUpperCase()}: ${d.available ? `available${d.maxMinutes ? ` (≤${d.maxMinutes} min)` : ''}` : 'unavailable'}`).join(' · ')}</p>` : '';
  const statusChip = { pending: '<span class="chip warn">Awaiting your approval</span>', accepted: '<span class="chip good">Accepted — applied to plan</span>', rejected: '<span class="chip">Rejected — plan unchanged</span>', superseded: '<span class="chip">Superseded by a newer proposal</span>', invalid: '<span class="chip bad">Failed validation — cannot be applied</span>' }[status] || '';
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
  if (m.role === 'notice') return `<div class="msg notice ${esc(m.level || '')}"><div class="bubble">${esc(m.text)}</div><div class="meta">${esc(time)}</div></div>`;
  return `<div class="msg coach ${m.safetyLevel === 'urgent' ? 'urgent' : ''}"><div class="bubble">${esc(m.text).replace(/\n/g, '<br>')}${m.proposal ? proposalCard(m, ctx) : ''}</div><div class="meta"><span class="chip ${m.mode === 'ai' ? 'good' : ''}">${esc(MODE_LABEL[m.mode] || m.mode)}</span> · ${esc(time)}</div></div>`;
}

export function coachView(ctx, _params, rerender) {
  const conn = getConn();
  const msgs = ctx.state.coach?.messages || [];
  const day = ctx.plan.byDate[ctx.today] || (ctx.today < ctx.plan.days[0].date ? ctx.plan.days[0] : ctx.plan.days[ctx.plan.days.length - 1]);
  const week = ctx.plan.weeks[day.week];
  const history = [...(ctx.state.changeHistory || [])].reverse().slice(0, 8);
  const daysToRace = Math.max(0, diffDays(ctx.today, RACE.date));

  const html = `
  <div class="page-head coach-head">
    <div><div class="eyebrow">AI Coach · ${esc(RACE.name)} in ${daysToRace} days</div><h1>AI Coach</h1>
      <div class="row">${statusPill(conn)}<span class="phase-pill ${PHASES[day.phase].color}">${esc(day.phaseName)} · Week ${day.week}</span></div></div>
  </div>
  <p class="disclaimer">Recommendations are AI-generated (or rules-based when labeled) and are not medical advice. Nothing changes in your plan until you press <b>Accept Changes</b>, and every change is validated against your actual schedule first.</p>
  <div class="coach-grid">
    <section class="card coach-chat" aria-label="Conversation">
      <div class="chat-log" id="chatlog" aria-live="polite">
        ${msgs.length ? msgs.map((m) => messageHTML(m, ctx)).join('') : `<div class="chat-empty"><p class="serif" style="font-size:1.2rem">How can I help with your training?</p><p class="muted small">Tell me about a missed workout, a schedule conflict, how you feel, or ask about race preparation. I'll read your actual plan and propose changes for you to approve.</p></div>`}
        ${busy ? '<div class="msg coach"><div class="bubble typing" aria-label="Coach is thinking"><span></span><span></span><span></span></div></div>' : ''}
      </div>
      <div class="suggestions" role="group" aria-label="Suggested prompts">${SUGGESTIONS.map(([label, text, kind], i) => `<button class="chip-btn" data-sugg="${i}" ${busy ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>
      <form id="chatform" class="chat-input" novalidate>
        <label class="sr-only" for="chatbox">Message your coach</label>
        <textarea id="chatbox" rows="2" maxlength="2000" placeholder="e.g., I can't train tomorrow because of work" ${busy ? 'disabled' : ''}></textarea>
        <button class="btn primary" type="submit" ${busy ? 'disabled' : ''} aria-label="Send">Send</button>
      </form>
      <p class="small muted" id="chaterr" role="alert"></p>
    </section>
    <aside class="stack">
      <div class="card flat"><h3>This week — ${esc(week.title)}</h3><ul class="clean small week-mini">${week.days.flatMap((d) => effectiveSessionsOn(ctx.plan, ctx.state, d.date).filter((s) => s.sport !== 'rest').map((s) => `<li class="${s.cancelled ? 'muted strike' : ''}">${esc(DOW[dayOfWeek(s.date)].slice(0, 3))} · <a href="#/session/${encodeURIComponent(s.id)}">${esc(s.title)}</a> <span class="muted">${s.durationMin || 0}′</span>${ctx.state.logs[s.id] ? ` <span class="muted">(${esc(ctx.state.logs[s.id].status)})</span>` : ''}${s.adjusted ? ' ✎' : ''}</li>`)).join('') || '<li>No sessions.</li>'}</ul></div>
      <div class="card flat"><h3>Change history</h3>${history.length ? `<ul class="clean small">${history.map((h) => { const u = canUndo(ctx.state, h, { today: ctx.today }); return `<li><b>${esc(h.summary || 'Change')}</b> <span class="muted">· ${esc(new Date(h.at).toLocaleDateString())} · ${esc(h.source)} · ${esc(h.status)}</span>${h.status === 'applied' ? (u.ok ? ` <button class="btn sm ghost" data-undo="${esc(h.id)}">Undo</button>` : ` <span class="muted" title="${esc(u.reason)}">(undo unavailable)</span>`) : ''}</li>`; }).join('')}</ul>` : '<p class="small muted">No plan changes yet.</p>'}</div>
      <details class="card flat" ${!conn.endpoint && conn.useAI ? 'open' : ''}><summary><b>Connection</b></summary>
        <form id="connform" class="stack" style="margin-top:8px" novalidate>
          <label class="f">Backend URL<input name="endpoint" type="url" placeholder="https://im703-coach.your-name.workers.dev" value="${esc(conn.endpoint)}"></label>
          <label class="f">Access code <span class="hint">your own passphrase for the backend (not an AI API key)</span><input name="accessCode" type="password" autocomplete="off" value="${esc(conn.accessCode)}"></label>
          <label class="checks"><input type="checkbox" name="useAI" ${conn.useAI ? 'checked' : ''}> Use AI when available (otherwise rules-based planner)</label>
          <div class="row"><button class="btn sm primary">Save</button><button class="btn sm" type="button" id="testconn">Test connection</button></div>
          <p class="small muted">Stored only on this device and excluded from backups. Your Anthropic API key lives only on the server.</p>
        </form></details>
      ${msgs.length ? '<button class="btn sm ghost" id="clearchat">Clear conversation</button>' : ''}
    </aside>
  </div>`;

  return {
    html,
    mount(root) {
      const log = root.querySelector('#chatlog');
      log.scrollTop = log.scrollHeight;
      const box = root.querySelector('#chatbox');
      const form = root.querySelector('#chatform');
      if (conn.useAI && conn.endpoint && health.state === 'unknown') checkHealth(conn).then(() => rerender());
      form.addEventListener('submit', (e) => { e.preventDefault(); send(box.value, rerender, root); });
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(box.value, rerender, root); } });
      if (!busy) box.focus({ preventScroll: true });
      root.querySelectorAll('[data-sugg]').forEach((b) => b.addEventListener('click', () => {
        const [, text, kind] = SUGGESTIONS[Number(b.dataset.sugg)];
        if (kind === 'send') send(text, rerender, root);
        else { box.value = text; box.focus(); box.setSelectionRange(text.length, text.length); }
      }));
      root.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => accept(b.dataset.accept, rerender)));
      root.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => reject(b.dataset.reject, rerender)));
      root.querySelectorAll('[data-revise]').forEach((b) => b.addEventListener('click', () => { box.value = 'Change the proposal: '; box.focus(); }));
      root.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => {
        const st = load();
        const r = undoChange(st, b.dataset.undo, { today: appContext().today });
        if (!r.ok) return toast(`Can't undo: ${r.reason}`);
        r.state.coach.messages.push({ id: `n-${Date.now()}`, role: 'notice', at: new Date().toISOString(), text: 'Change undone — the previous schedule is restored.' });
        save(r.state);
        toast('Change undone.');
        rerender();
      }));
      root.querySelector('#connform').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const endpoint = String(fd.get('endpoint') || '').trim();
        if (endpoint && !/^https:\/\/[^\s]+$|^http:\/\/localhost(:\d+)?/.test(endpoint)) return toast('Backend URL must start with https://');
        setConn({ endpoint, accessCode: String(fd.get('accessCode') || ''), useAI: fd.get('useAI') === 'on' });
        health = { state: 'unknown', text: 'Checking…' };
        toast('Connection saved.');
        rerender();
      });
      root.querySelector('#testconn').addEventListener('click', async () => { await checkHealth(getConn()); toast(health.text); rerender(); });
      root.querySelector('#clearchat')?.addEventListener('click', () => {
        if (!confirm('Clear the conversation? Applied plan changes and change history are kept.')) return;
        const st = load();
        st.coach.messages = [];
        save(st);
        rerender();
      });
    },
  };
}

async function checkHealth(conn) {
  if (!conn.endpoint) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${conn.endpoint.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    const b = await r.json();
    health = b.configured ? { state: 'ok', text: 'AI connected' } : b.mock ? { state: 'mock', text: 'Backend in mock mode (not AI)' } : { state: 'bad', text: 'Backend missing API key' };
  } catch {
    health = { state: 'bad', text: 'AI unavailable — rules-based fallback' };
  }
}

function pushMessages(st, ...ms) {
  st.coach ||= { messages: [] };
  st.coach.messages.push(...ms);
  if (st.coach.messages.length > MAX_MESSAGES) st.coach.messages = st.coach.messages.slice(-MAX_MESSAGES);
}

export async function send(textRaw, rerender, root) {
  const text = String(textRaw || '').trim();
  const err = root?.querySelector('#chaterr');
  if (!text) { if (err) err.textContent = 'Type a message first.'; return; }
  if (busy) return;
  if (text.length > 2000) { if (err) err.textContent = 'Please keep messages under 2,000 characters.'; return; }
  const conn = getConn();
  let ctx = appContext();
  let st = load();
  pushMessages(st, { id: `a-${Date.now().toString(36)}`, role: 'athlete', at: new Date().toISOString(), text, intents: classifyIntent(text) });
  save(st);

  // Safety first: serious symptoms short-circuit any schedule change (handled locally, instantly).
  if (detectRedFlags(text).length) {
    const reply = planOffline(text, { plan: ctx.plan, state: st, today: ctx.today });
    st = load();
    pushMessages(st, toCoachMessage(reply, ctx, { mode: 'rules' }));
    save(st);
    return rerender();
  }

  busy = true;
  rerender();
  let reply = null;
  let mode = 'rules';
  let notice = null;
  try {
    if (conn.useAI && conn.endpoint) {
      try {
        ctx = appContext();
        const body = await callCoachAPI({ endpoint: conn.endpoint, accessCode: conn.accessCode, messages: transcript(load().coach.messages), context: buildCoachContext(ctx, { activeProposal: activeProposal(load().coach.messages) }) });
        reply = body;
        mode = body.mode === 'mock' ? 'mock' : 'ai';
        health = { state: 'ok', text: 'AI connected' };
      } catch (e) {
        const kind = e instanceof CoachError ? e.kind : 'network';
        notice = `AI coach unavailable (${e.message}) — answered by the rules-based planner instead (not AI).`;
        if (kind !== 'unauthorized') health = { state: 'bad', text: 'AI unavailable — rules-based fallback' };
        else health = { state: 'bad', text: 'Access code rejected' };
      }
    }
    ctx = appContext();
    st = load();
    if (!reply) {
      reply = planOffline(text, { plan: ctx.plan, state: st, today: ctx.today }, { pending: lastPending(st.coach.messages), activeProposal: activeProposal(st.coach.messages) });
      mode = 'rules';
    }
    const msg = toCoachMessage(reply, ctx, { mode });
    if (msg.proposal) supersedePending(st.coach.messages);
    if (notice) pushMessages(st, { id: `n-${Date.now()}`, role: 'notice', level: 'warn', at: new Date().toISOString(), text: notice });
    pushMessages(st, msg);
    save(st);
  } catch (e) {
    console.error(e);
    st = load();
    pushMessages(st, { id: `n-${Date.now()}`, role: 'notice', level: 'warn', at: new Date().toISOString(), text: `Something went wrong: ${e.message}. Your plan was not changed.` });
    save(st);
  } finally {
    busy = false;
    rerender();
  }
}

/** Accept: re-validate against the current plan, apply atomically, record history. */
export function acceptProposal(messageId, { today, plan } = {}) {
  const st = load();
  const m = st.coach.messages.find((x) => x.id === messageId);
  if (!m?.proposal || m.proposalStatus !== 'pending') return { ok: false, reason: 'This proposal is no longer pending.' };
  const res = applyProposal(plan, st, m.proposal, { today, source: m.mode === 'ai' ? 'ai' : m.mode });
  if (!res.ok) {
    m.validation = res.validation;
    if (res.stale && res.validation.ok) {
      m.proposal.fingerprint = fingerprint(st, affectedIds(m.proposal));
      m.proposal.today = today;
      m.staleNote = 'Your plan changed since this was proposed. I re-checked it against the current schedule — review and accept again.';
    } else {
      m.proposalStatus = 'invalid';
      m.staleNote = res.stale ? 'Your plan changed since this was proposed and the change no longer fits. Nothing was applied.' : '';
    }
    save(st);
    return { ok: false, reason: res.validation.errors[0] || m.staleNote };
  }
  const next = res.state;
  const nm = next.coach.messages.find((x) => x.id === messageId);
  nm.proposalStatus = 'accepted';
  nm.changeId = res.entry.id;
  nm.staleNote = '';
  pushMessages(next, { id: `n-${Date.now()}`, role: 'notice', at: new Date().toISOString(), text: `Applied: ${m.proposal.summary}. Your calendar, dashboard and Today view are updated. You can undo it from Change history.` });
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
  const m = st.coach.messages.find((x) => x.id === messageId);
  if (!m?.proposal || m.proposalStatus !== 'pending') return false;
  m.proposalStatus = 'rejected';
  pushMessages(st, { id: `n-${Date.now()}`, role: 'notice', at: new Date().toISOString(), text: 'Proposal rejected — your plan is unchanged.' });
  save(st);
  return true;
}

function reject(id, rerender) {
  rejectProposal(id);
  rerender();
}

