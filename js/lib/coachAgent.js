// AI Coach agent loop (browser side).
//  athlete message → (snapshot + message) appended to the API transcript → Worker → model
//  → model asks for tools → executed here against real data → results appended → model … → reply.
// The API transcript (state.coach.apiMessages) is APPEND-ONLY and replayed verbatim (thinking,
// tool calls and results included), which the model needs for multi-turn tool use. If it grows
// too large it is restarted with a plain-text summary ("simple compaction"). A failed turn is
// rolled back to the previous transcript so nothing half-finished is ever replayed.
// There is NO fallback that fabricates a reply: failures surface as errors.

import { executeTool, buildSnapshot, TOOL_LABELS } from './coachTools.js';
import { callCoachAPI, CoachError } from './coachCore.js';

export const MAX_TOOL_STEPS = 8;
export const MAX_TRANSCRIPT_CHARS = 220_000;
export const MAX_TRANSCRIPT_MESSAGES = 90;

export const COACH_STATE_VERSION = 2;

export function ensureCoachState(st) {
  st.coach ||= {};
  if (st.coach.version !== COACH_STATE_VERSION) {
    // Conversations from the previous (keyword-matching) version are not AI transcripts and may hold
    // stale pending proposals: start clean so nothing unrelated is inherited.
    st.coach = { version: COACH_STATE_VERSION, messages: [], apiMessages: [], events: [] };
  }
  if (!Array.isArray(st.coach.messages)) st.coach.messages = [];
  if (!Array.isArray(st.coach.apiMessages)) st.coach.apiMessages = [];
  if (!Array.isArray(st.coach.events)) st.coach.events = [];
  st.coach.conversationId ||= `c-${Date.now().toString(36)}`;
  return st.coach;
}

export function pendingProposalMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].proposal && messages[i].proposalStatus === 'pending') return messages[i];
  return null;
}

/** Plain-text recap used when the transcript is restarted (no old thinking blocks carried over). */
export function conversationRecap(messages, limit = 10) {
  const recent = messages.filter((m) => m.role === 'athlete' || m.role === 'coach').slice(-limit);
  if (!recent.length) return '';
  return `<conversation_recap>\nEarlier in this conversation (summary of the most recent exchanges):\n${recent.map((m) => `${m.role === 'athlete' ? 'Athlete' : 'Coach'}: ${String(m.text).slice(0, 600)}${m.proposal ? ` [proposal: ${m.proposal.summary} — ${m.proposalStatus}]` : ''}`).join('\n')}\n</conversation_recap>`;
}

function needsCompaction(apiMessages) {
  return apiMessages.length > MAX_TRANSCRIPT_MESSAGES || JSON.stringify(apiMessages).length > MAX_TRANSCRIPT_CHARS;
}

/**
 * Run one athlete turn. Dependencies are injected so the loop is unit-testable.
 * Returns { ok, message } or throws CoachError (state is left exactly as before the turn,
 * apart from the athlete's message being recorded with the error).
 */
export async function runTurn(text, { conn, timeZone, getCtx, loadState, saveState, fetchImpl, onProgress = () => {}, now = () => new Date() }) {
  const clean = String(text || '').trim();
  if (!clean) throw new CoachError('empty', 'Type a message first.');
  if (clean.length > 4000) throw new CoachError('too_long', 'Please keep messages under 4,000 characters.');
  if (!conn?.endpoint) throw new CoachError('not_configured', 'The AI Coach is not connected yet. Add the backend URL and access code under Connection (see setup steps).');

  let st = loadState();
  const coach = ensureCoachState(st);
  let ctx = getCtx();
  const pendingMsg = pendingProposalMessage(coach.messages);
  const athleteMsg = { id: `a-${now().getTime().toString(36)}`, role: 'athlete', at: now().toISOString(), text: clean };

  // Build the new user turn (appended once; never edited afterwards).
  let base = coach.apiMessages;
  let recap = '';
  if (needsCompaction(base)) {
    recap = conversationRecap(coach.messages);
    base = [];
  }
  const snapshot = buildSnapshot(ctx, { timeZone, pending: pendingMsg?.proposal || null, events: coach.events });
  const userTurn = { role: 'user', content: [{ type: 'text', text: [recap, snapshot].filter(Boolean).join('\n\n') }, { type: 'text', text: clean }] };
  const transcript = [...base, userTurn];

  const turn = { proposal: undefined, withdraw: false, tools: [] };
  let mode = 'ai';
  let model = '';
  let replyText = '';
  let steps = 0;
  try {
    for (;;) {
      steps += 1;
      onProgress(steps === 1 ? 'Thinking…' : `${turn.tools[turn.tools.length - 1] || 'Working'}…`);
      const res = await callCoachAPI({ endpoint: conn.endpoint, accessCode: conn.accessCode, messages: transcript, timeZone, localDate: ctx.today }, { fetchImpl });
      mode = res.mode === 'mock' ? 'mock' : 'ai';
      model = res.model || model;
      transcript.push({ role: 'assistant', content: res.content });
      const toolUses = res.content.filter((b) => b.type === 'tool_use');
      if (res.stopReason === 'tool_use' && toolUses.length) {
        if (steps >= MAX_TOOL_STEPS) {
          // Close the round so the transcript stays valid, then stop.
          transcript.push({ role: 'user', content: toolUses.map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ error: 'Step limit reached; answer the athlete with what you have.' }), is_error: true })) });
          replyText = 'I looked at a lot of your schedule but couldn\'t finish that in one go. Could you narrow the question down a bit?';
          break;
        }
        ctx = getCtx(); // always read current data
        const results = toolUses.map((b) => {
          turn.tools.push(TOOL_LABELS[b.name] || b.name);
          const out = executeTool(b.name, b.input || {}, ctx, turn);
          return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out), ...(out?.error ? { is_error: true } : {}) };
        });
        transcript.push({ role: 'user', content: results });
        continue;
      }
      replyText = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (res.stopReason === 'max_tokens') replyText += '\n\n(My reply was cut off — ask me to continue.)';
      if (!replyText) replyText = turn.proposal ? 'I\'ve prepared a proposal for you to review below.' : 'I don\'t have anything to add — could you tell me a bit more?';
      break;
    }
  } catch (e) {
    // Roll back: the transcript is not saved; record the athlete message + error for the UI.
    st = loadState();
    ensureCoachState(st);
    st.coach.messages.push(athleteMsg, { id: `n-${now().getTime().toString(36)}`, role: 'notice', level: 'error', at: now().toISOString(), text: `No reply — ${e.message} Your plan was not changed.`, retryText: clean });
    saveState(st);
    throw e;
  }

  // Commit: transcript, display messages, proposals.
  st = loadState();
  ensureCoachState(st);
  st.coach.apiMessages = transcript;
  st.coach.events = [];
  const coachMsg = { id: `m-${now().getTime().toString(36)}`, role: 'coach', mode, model, at: now().toISOString(), text: replyText, tools: [...new Set(turn.tools)] };
  if (turn.withdraw || turn.proposal) {
    for (const m of st.coach.messages) if (m.proposal && m.proposalStatus === 'pending') m.proposalStatus = turn.withdraw && !turn.proposal ? 'withdrawn' : 'superseded';
  }
  if (turn.proposal) {
    coachMsg.proposal = turn.proposal.proposal;
    coachMsg.validation = turn.proposal.validation;
    coachMsg.proposalStatus = 'pending';
  }
  st.coach.messages.push(athleteMsg, coachMsg);
  if (st.coach.messages.length > 300) st.coach.messages = st.coach.messages.slice(-300);
  saveState(st);
  return { ok: true, message: coachMsg, steps };
}

/** Record an app event (accept/reject/undo) so the model learns about it with the next message. */
export function recordEvent(st, text) {
  ensureCoachState(st);
  st.coach.events.push(text);
  if (st.coach.events.length > 10) st.coach.events = st.coach.events.slice(-10);
}

/** Start a fresh conversation: no transcript, no pending proposal inherited. */
export function newConversation(st) {
  ensureCoachState(st);
  for (const m of st.coach.messages) if (m.proposal && m.proposalStatus === 'pending') m.proposalStatus = 'superseded';
  st.coach.messages = [];
  st.coach.apiMessages = [];
  st.coach.events = [];
  st.coach.conversationId = `c-${Date.now().toString(36)}`;
  return st;
}
