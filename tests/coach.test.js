// AI Coach tests. The model is replaced by a SCRIPTED fake (tests only) so we can verify the
// plumbing deterministically: what the model receives, that tools return real plan data,
// transcript continuity across turns, proposal handling, approval, and error behavior.
// These do not prove the live model's quality — see docs/ai-coach.md for live verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../js/plan/generator.js';
import { emptyState } from '../js/store/store.js';
import { currentBenchmarks } from '../js/lib/benchmarks.js';
import { effectiveSession, validateProposal, applyProposal, fingerprint, affectedIds, undoChange, canUndo } from '../js/lib/adjustments.js';
import { executeTool, buildSnapshot } from '../js/lib/coachTools.js';
import { runTurn, ensureCoachState, newConversation, pendingProposalMessage, MAX_TRANSCRIPT_CHARS } from '../js/lib/coachAgent.js';
import { callCoachAPI, CoachError } from '../js/lib/coachCore.js';
import { detectRedFlags } from '../js/lib/coachSafety.js';
import { aggregate } from '../js/lib/load.js';

const plan = buildPlan();
const TODAY = '2026-10-09'; // Friday — matches the athlete's live test
const conn = { endpoint: 'https://coach.test', accessCode: 'code' };

function harness(today = TODAY) {
  let st = emptyState();
  ensureCoachState(st);
  const store = {
    load: () => JSON.parse(JSON.stringify(st)),
    save: (s) => { st = JSON.parse(JSON.stringify(s)); },
    get: () => st,
  };
  const getCtx = () => {
    const state = store.load();
    return { plan, state, today, bm: currentBenchmarks(state).values, coaching: [] };
  };
  return { store, getCtx, today };
}

/** Scripted model: each entry is a function(requestBody) → { stopReason, content }. Records requests. */
function scriptedModel(steps) {
  const requests = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const step = steps[i++];
    if (!step) throw new Error('script exhausted');
    const out = step(body);
    if (out.httpStatus) return { status: out.httpStatus, ok: false, json: async () => out.body };
    return { status: 200, ok: true, json: async () => ({ mode: 'ai', model: 'claude-opus-5-5', ...out }) };
  };
  return { fetchImpl, requests };
}
const think = (t) => ({ type: 'thinking', thinking: '', signature: `sig-${t}` });
const text = (t) => ({ type: 'text', text: t });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const lastToolResult = (body, id) => JSON.parse(body.messages.at(-1).content.find((b) => b.tool_use_id === id).content);
const turnOpts = (h, fetchImpl) => ({ conn, timeZone: 'America/Chicago', getCtx: h.getCtx, loadState: h.store.load, saveState: h.store.save, fetchImpl });

// Oct 10 2026 (Sat, Week 0): mobility (optional) + easy recovery swim (optional)
const oct10 = plan.byDate['2026-10-10'].sessions;

test('safety detector', () => {
  assert.ok(detectRedFlags('I had chest pain on my run').length);
  assert.ok(detectRedFlags('my heart is racing at rest').length);
  assert.equal(detectRedFlags('my legs are sore').length, 0);
});

test('missing configuration → clear error, nothing fabricated', async () => {
  const h = harness();
  await assert.rejects(runTurn('What do I have tomorrow?', { ...turnOpts(h, null), conn: { endpoint: '' } }), (e) => e instanceof CoachError && e.kind === 'not_configured');
  assert.equal(h.store.get().coach.messages.length, 0);
  // Backend deployed without API key → 503 not_configured → athlete message + error notice, no coach reply, transcript untouched
  const m = scriptedModel([() => ({ httpStatus: 503, body: { error: 'The AI Coach backend is deployed but ANTHROPIC_API_KEY is not set.', code: 'not_configured' } })]);
  await assert.rejects(runTurn('Hello', turnOpts(h, m.fetchImpl)), (e) => e.kind === 'not_configured');
  const c = h.store.get().coach;
  assert.deepEqual(c.messages.map((x) => x.role), ['athlete', 'notice']);
  assert.match(c.messages[1].text, /ANTHROPIC_API_KEY/);
  assert.equal(c.messages.some((x) => x.role === 'coach'), false);
  assert.deepEqual(c.apiMessages, []);
  // empty message
  await assert.rejects(runTurn('   ', turnOpts(h, m.fetchImpl)), (e) => e.kind === 'empty');
});

test('the model receives the actual message, local date and real schedule snapshot', async () => {
  const h = harness();
  const m = scriptedModel([() => ({ stopReason: 'end_turn', content: [think('a'), text('Tomorrow you have mobility and an easy swim.')] })]);
  await runTurn('What session do I have tomorrow?', turnOpts(h, m.fetchImpl));
  const req = m.requests[0];
  assert.equal(req.localDate, TODAY);
  assert.equal(req.timeZone, 'America/Chicago');
  const user = req.messages.at(-1);
  assert.equal(user.role, 'user');
  assert.equal(user.content[1].text, 'What session do I have tomorrow?');
  const snap = user.content[0].text;
  assert.match(snap, /Friday 2026-10-09 \(today\)/);
  assert.match(snap, /Saturday 2026-10-10 \(tomorrow\)/);
  for (const s of oct10) assert.ok(snap.includes(`[${s.id}]`), `snapshot lists ${s.id}`);
  const coach = h.store.get().coach.messages.at(-1);
  assert.equal(coach.role, 'coach');
  assert.equal(coach.mode, 'ai');
});

test('Tests A–F: date-specific requests, follow-ups, revised proposal, explanation — one continuous conversation', async () => {
  const h = harness();
  const swim = oct10.find((s) => s.sport === 'swim');
  const steps = [
    // A: "Change plan on October 10, 2026." → model checks the date, asks what to change
    () => ({ stopReason: 'tool_use', content: [think('A1'), toolUse('t1', 'get_schedule', { start_date: '2026-10-10', end_date: '2026-10-10' })] }),
    (body) => {
      const r = lastToolResult(body, 't1');
      assert.deepEqual(r.sessions.map((s) => s.id).sort(), oct10.map((s) => s.id).sort()); // real data
      return { stopReason: 'end_turn', content: [think('A2'), text('On Saturday Oct 10 you have Mobility & tissue care (20 min) and an Easy recovery swim. What would you like to change?')] };
    },
    // B: "replace October 10, session" → two sessions → asks which one
    () => ({ stopReason: 'end_turn', content: [think('B'), text('There are two sessions that day — the mobility routine or the easy swim. Which one, and what would you like instead?')] }),
    // C: "I can't train tomorrow because of work." → looks at the week, asks move or skip
    () => ({ stopReason: 'tool_use', content: [think('C1'), toolUse('t2', 'get_weekly_schedule', { date: '2026-10-10' })] }),
    (body) => {
      const r = lastToolResult(body, 't2');
      assert.equal(r.week, 0);
      assert.ok(r.days.some((d) => d.date === '2026-10-11'));
      return { stopReason: 'end_turn', content: [think('C2'), text('No problem. Tomorrow (Sat Oct 10) has mobility and an easy swim. Would you like to move them or skip them?')] };
    },
    // D: "Move it to Sunday." → proposes moving the swim to Sunday Oct 11
    () => ({ stopReason: 'tool_use', content: [think('D1'), toolUse('t3', 'propose_reschedule_workout', { workout_id: swim.id, new_date: '2026-10-11', new_duration_min: null, reason: 'Sunday has only an easy spin, so an easy swim fits.' })] }),
    (body) => {
      const r = lastToolResult(body, 't3');
      assert.equal(r.status, 'pending_athlete_approval');
      return { stopReason: 'end_turn', content: [think('D2'), text('I\'ve proposed moving the easy swim to Sunday Oct 11 — accept it below if that works.')] };
    },
    // E: "Actually, I think I should skip it instead." → replaces the pending proposal
    () => ({ stopReason: 'tool_use', content: [think('E1'), toolUse('t4', 'propose_skip_workout', { workout_id: swim.id, reason: 'It\'s an optional recovery swim; skipping costs nothing this week.' })] }),
    () => ({ stopReason: 'end_turn', content: [think('E2'), text('Updated: I now propose skipping the swim instead of moving it.')] }),
    // F: "Why are you recommending that?" → conversational answer, no tools
    () => ({ stopReason: 'end_turn', content: [think('F'), text('Because this is your post-Waco recovery week: the swim is optional and easy, so skipping it protects recovery without losing fitness.')] }),
  ];
  const m = scriptedModel(steps);
  const o = turnOpts(h, m.fetchImpl);

  await runTurn('Change plan on October 10, 2026.', o);
  await runTurn('replace October 10, session', o);
  await runTurn("I can't train tomorrow because of work.", o);
  await runTurn('Move it to Sunday.', o);
  let c = h.store.get().coach;
  const firstProposal = pendingProposalMessage(c.messages);
  assert.equal(firstProposal.proposal.changes[0].action, 'move');
  assert.equal(firstProposal.proposal.changes[0].newDate, '2026-10-11');
  assert.deepEqual(h.store.get().reschedules, {}); // not applied without approval

  await runTurn('Actually, I think I should skip it instead.', o);
  c = h.store.get().coach;
  const pend = c.messages.filter((x) => x.proposalStatus === 'pending');
  assert.equal(pend.length, 1); // no duplicate proposals
  assert.equal(pend[0].proposal.changes[0].action, 'skip');
  assert.equal(c.messages.find((x) => x.id === firstProposal.id).proposalStatus, 'superseded');

  await runTurn('Why are you recommending that?', o);

  // Continuity: every request is the previous transcript + new turns, byte-identical (append-only)
  for (let i = 1; i < m.requests.length; i += 1) {
    const prev = m.requests[i - 1].messages;
    const cur = m.requests[i].messages;
    assert.deepEqual(cur.slice(0, prev.length), prev, `request ${i} must replay request ${i - 1} verbatim`);
  }
  // Thinking blocks are replayed unchanged
  const finalReq = m.requests.at(-1);
  assert.ok(finalReq.messages.some((x) => x.role === 'assistant' && x.content.some((b) => b.type === 'thinking' && b.signature === 'sig-A1')));
  // The last request carries the athlete's actual words, and the pending proposal in the snapshot
  assert.equal(finalReq.messages.at(-1).content[1].text, 'Why are you recommending that?');
  assert.match(finalReq.messages.at(-1).content[0].text, /Pending proposal: .*Skip/);
  // No welcome/generic text was ever produced by the app
  assert.equal(h.store.get().coach.messages.filter((x) => x.role === 'coach').length, 6);
});

test('approval workflow: accept applies validated change + informs the model next turn; reject leaves plan unchanged', async () => {
  const coachUI = await import('../js/ui/coach.js');
  const store = await import('../js/store/store.js');
  const swim = oct10.find((s) => s.sport === 'swim');
  // Seed the real app store with a pending AI proposal
  const st = emptyState();
  ensureCoachState(st);
  const proposal = { id: 'p1', source: 'ai', summary: 'Skip easy swim', changes: [{ action: 'skip', workoutId: swim.id, reason: 'r' }], today: TODAY };
  proposal.fingerprint = fingerprint(st, affectedIds(proposal));
  st.coach.messages.push({ id: 'm1', role: 'coach', mode: 'ai', text: 'x', proposal, proposalStatus: 'pending', validation: validateProposal(plan, st, proposal, { today: TODAY }) });
  store.save(st);
  const r = coachUI.acceptProposal('m1', { today: TODAY, plan });
  assert.ok(r.ok);
  const after = store.load();
  assert.equal(effectiveSession(plan, after, swim.id).cancelled, true);
  assert.deepEqual(after.logs, {}); // never marked completed
  assert.match(after.coach.events[0], /ACCEPTED/);
  // reject path
  const st2 = emptyState();
  ensureCoachState(st2);
  st2.coach.messages.push({ id: 'm2', role: 'coach', mode: 'ai', text: 'x', proposal: { ...proposal, id: 'p2' }, proposalStatus: 'pending' });
  store.save(st2);
  assert.ok(coachUI.rejectProposal('m2'));
  const after2 = store.load();
  assert.deepEqual(after2.overrides, {});
  assert.match(after2.coach.events[0], /REJECTED/);
});

test('tools use real data and validation; invalid proposals are not shown', () => {
  const h = harness('2026-11-02');
  const ctx = h.getCtx();
  const wed = plan.byDate['2026-11-04'].sessions;
  const wedRun = wed.find((s) => s.sport === 'run');
  const tueBike = plan.byDate['2026-11-03'].sessions.find((s) => s.sport === 'bike');
  const week = executeTool('get_weekly_schedule', { date: '2026-11-04' }, ctx);
  assert.equal(week.week, 4);
  assert.ok(week.days.some((d) => d.id === wedRun.id));
  const det = executeTool('get_workout_details', { workout_id: wedRun.id }, ctx);
  assert.equal(det.id, wedRun.id);
  assert.ok(det.main_set.length);
  assert.match(executeTool('get_workout_details', { workout_id: '2099-01-01#0' }, ctx).error, /No workout/);
  assert.match(executeTool('get_schedule', { start_date: '2026-11-01', end_date: '2026-12-31' }, ctx).error, /Range too long/);
  // conflicting move (stacking demanding sessions) is rejected and NOT registered as pending
  const turn = {};
  const bad = executeTool('propose_reschedule_workout', { workout_id: tueBike.id, new_date: '2026-11-05', new_duration_min: null, reason: 'x' }, ctx, turn);
  assert.equal(bad.status, 'rejected_by_validator');
  assert.match(bad.errors.join(' '), /stacking/);
  assert.equal(turn.proposal, undefined);
  // valid move of the Wednesday easy run to Friday
  const ok = executeTool('propose_reschedule_workout', { workout_id: wedRun.id, new_date: '2026-11-06', new_duration_min: null, reason: 'Light day' }, ctx, turn);
  assert.equal(ok.status, 'pending_athlete_approval');
  assert.equal(turn.proposal.proposal.changes[0].workoutId, wedRun.id);
  // completed workouts cannot be changed
  const h2 = harness('2026-11-02');
  const s2 = h2.store.load();
  s2.logs[wedRun.id] = { status: 'completed', actual: {} };
  h2.store.save(s2);
  const done = executeTool('propose_skip_workout', { workout_id: wedRun.id, reason: 'x' }, h2.getCtx(), {});
  assert.equal(done.status, 'rejected_by_validator');
  // recent training reports missing check-ins honestly
  assert.match(String(executeTool('get_recent_training', { days: 7 }, ctx).checkins), /No daily check-ins/);
});

test('withdraw, new conversation, compaction, step limit, failure rollback', async () => {
  const h = harness();
  const swim = oct10.find((s) => s.sport === 'swim');
  const m = scriptedModel([
    () => ({ stopReason: 'tool_use', content: [toolUse('a', 'propose_skip_workout', { workout_id: swim.id, reason: 'r' })] }),
    () => ({ stopReason: 'end_turn', content: [text('Proposed.')] }),
    () => ({ stopReason: 'tool_use', content: [toolUse('b', 'withdraw_pending_proposal', { reason: 'athlete changed mind' })] }),
    () => ({ stopReason: 'end_turn', content: [text('Okay, keeping it as planned.')] }),
  ]);
  await runTurn('skip tomorrow\'s swim', turnOpts(h, m.fetchImpl));
  await runTurn('never mind, keep it', turnOpts(h, m.fetchImpl));
  assert.equal(pendingProposalMessage(h.store.get().coach.messages), null);
  assert.equal(h.store.get().coach.messages.find((x) => x.proposal).proposalStatus, 'withdrawn');
  // new conversation inherits nothing
  const fresh = newConversation(h.store.load());
  assert.deepEqual([fresh.coach.messages.length, fresh.coach.apiMessages.length], [0, 0]);
  // compaction: oversized transcript restarts with a plain-text recap (no old thinking blocks)
  const s = h.store.load();
  s.coach.apiMessages = [{ role: 'user', content: 'x'.repeat(MAX_TRANSCRIPT_CHARS + 10) }, { role: 'assistant', content: [think('old'), text('old')] }];
  h.store.save(s);
  const m2 = scriptedModel([() => ({ stopReason: 'end_turn', content: [text('hi')] })]);
  await runTurn('hello again', turnOpts(h, m2.fetchImpl));
  assert.equal(m2.requests[0].messages.length, 1);
  assert.match(m2.requests[0].messages[0].content[0].text, /conversation_recap/);
  // step limit: a model that never stops calling tools is cut off safely
  const loop = scriptedModel(Array.from({ length: 10 }, (_, i) => () => ({ stopReason: 'tool_use', content: [toolUse(`l${i}`, 'get_athlete_profile', {})] })));
  const r = await runTurn('loop', turnOpts(h, loop.fetchImpl));
  assert.ok(r.steps <= 8);
  const tr = h.store.get().coach.apiMessages;
  assert.equal(tr.at(-1).role, 'user'); // every tool_use has its tool_result
  // failure mid-turn rolls the transcript back
  const before = JSON.stringify(h.store.get().coach.apiMessages);
  const fail = scriptedModel([() => ({ stopReason: 'tool_use', content: [toolUse('f', 'get_athlete_profile', {})] }), () => ({ httpStatus: 504, body: { error: 'timed out', code: 'timeout' } })]);
  await assert.rejects(runTurn('this will time out', turnOpts(h, fail.fetchImpl)), (e) => e.kind === 'timeout');
  assert.equal(JSON.stringify(h.store.get().coach.apiMessages), before);
  assert.ok(h.store.get().coach.messages.at(-1).retryText);
});

test('client API errors are typed', async () => {
  const resp = (status, body) => () => Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) });
  const args = { endpoint: 'https://x.dev', messages: [{ role: 'user', content: 'hi' }] };
  await assert.rejects(callCoachAPI({ ...args, endpoint: '' }), (e) => e.kind === 'not_configured');
  await assert.rejects(callCoachAPI(args, { fetchImpl: () => Promise.reject(new TypeError('x')) }), (e) => e.kind === 'network');
  await assert.rejects(callCoachAPI(args, { timeoutMs: 5, fetchImpl: () => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('a'), { name: 'AbortError' })), 20)) }), (e) => e.kind === 'timeout');
  await assert.rejects(callCoachAPI(args, { fetchImpl: resp(401, { error: 'no' }) }), (e) => e.kind === 'unauthorized');
  await assert.rejects(callCoachAPI(args, { fetchImpl: resp(200, { message: 'old format' }) }), (e) => e.kind === 'malformed');
});

// ---- adjustment engine (unchanged behavior, still enforced for AI proposals) ----
test('adjustments: conflicts, load guard, stale proposals, undo, planned vs actual', () => {
  const st = emptyState();
  const wedRun = plan.byDate['2026-11-04'].sessions.find((s) => s.sport === 'run');
  const tueBike = plan.byDate['2026-11-03'].sessions.find((s) => s.sport === 'bike');
  assert.match(validateProposal(plan, st, { changes: [{ action: 'move', workoutId: tueBike.id, newDate: '2026-11-05' }] }, { today: '2026-11-02' }).errors.join(' '), /stacking/);
  const satW5 = plan.byDate['2026-11-14'].sessions.find((s) => s.intensity === 'long');
  assert.match(validateProposal(plan, st, { changes: [{ action: 'move', workoutId: satW5.id, newDate: '2026-11-18' }] }, { today: '2026-11-09' }).errors.join(' '), /more training load/);
  const p = { summary: 'm', changes: [{ action: 'move', workoutId: wedRun.id, newDate: '2026-11-06', reason: 'r' }], today: '2026-11-02' };
  p.fingerprint = fingerprint(st, affectedIds(p));
  const changed = JSON.parse(JSON.stringify(st));
  changed.logs[wedRun.id] = { status: 'completed', actual: {} };
  assert.equal(applyProposal(plan, changed, p, { today: '2026-11-02' }).stale, true);
  const ok = applyProposal(plan, st, p, { today: '2026-11-02' });
  assert.ok(ok.ok);
  assert.ok(canUndo(ok.state, ok.state.changeHistory[0], { today: '2026-11-02' }).ok);
  assert.equal(effectiveSession(plan, undoChange(ok.state, ok.state.changeHistory[0].id, { today: '2026-11-02' }).state, wedRun.id).date, '2026-11-04');
  const w = plan.weeks[4];
  const a = aggregate(w.days, st.logs, { plan, state: st });
  const b = aggregate(w.days, ok.state.logs, { plan, state: ok.state });
  assert.equal(a.planned.total, b.planned.total);
  assert.deepEqual(a.actual, b.actual);
  // weekend swap is judged on the final schedule
  const sat = plan.byDate['2026-11-07'].sessions;
  const sun = plan.byDate['2026-11-08'].sessions;
  const swap = { changes: [...sat.filter((s) => s.sport !== 'rest').map((s) => ({ action: 'move', workoutId: s.id, newDate: '2026-11-08' })), ...sun.map((s) => ({ action: 'move', workoutId: s.id, newDate: '2026-11-07' }))] };
  assert.ok(validateProposal(plan, st, swap, { today: '2026-11-02' }).ok);
});

test('snapshot reports events and pending proposal', () => {
  const h = harness();
  const snap = buildSnapshot(h.getCtx(), { timeZone: 'America/Chicago', pending: { summary: 'Skip swim', changes: [] }, events: ['The athlete ACCEPTED the proposal "x".'] });
  assert.match(snap, /Pending proposal: Skip swim/);
  assert.match(snap, /Since your last reply: The athlete ACCEPTED/);
});
