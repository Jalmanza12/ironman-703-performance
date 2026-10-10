import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../js/plan/generator.js';
import { emptyState, migrate } from '../js/store/store.js';
import { effectiveSession, effectiveSessionsOn, validateProposal, applyProposal, undoChange, canUndo, fingerprint, affectedIds } from '../js/lib/adjustments.js';
import { classifyIntent, detectRedFlags, resolveDate, resolveRange, planOffline } from '../js/lib/coachRules.js';
import { buildCoachContext, toCoachMessage, supersedePending, activeProposal, callCoachAPI, CoachError, transcript } from '../js/lib/coachCore.js';
import { aggregate } from '../js/lib/load.js';
import { dayOfWeek } from '../js/lib/dates.js';

const plan = buildPlan();
const fresh = () => emptyState();
const on = (date, sport) => plan.byDate[date].sessions.find((s) => s.sport === sport && (!sport || true));
const ctxFor = (state, today) => ({ plan, state, today, bm: {}, coaching: [] });

// Week 4: Mon Nov 2 – Sun Nov 8 2026. Wed Nov 4 = CSS swim (key) + easy run (supporting).
const MON = '2026-11-02';
const WED = '2026-11-04';
const wedRun = plan.byDate[WED].sessions.find((s) => s.sport === 'run');

test('request classification', () => {
  assert.ok(classifyIntent("I can't train tomorrow because I have work").includes('skip'));
  assert.ok(classifyIntent("I missed today's bike workout. What should I do?").includes('missed'));
  assert.ok(classifyIntent('I only have 45 minutes to train today.').includes('shorten'));
  assert.ok(classifyIntent('Can I move my long run to Saturday?').includes('reschedule'));
  assert.ok(classifyIntent('I feel exhausted. Should I take a rest day?').includes('recovery'));
  assert.ok(classifyIntent('I have a work trip next week and can only train three days.').includes('weekly'));
  assert.ok(classifyIntent('My legs are sore after yesterday\'s brick workout.').includes('recovery'));
  assert.ok(classifyIntent('I want to prioritize improving my bike performance.').includes('priority'));
  assert.ok(classifyIntent('I can no longer train on Fridays, but I am available on Monday evenings.').includes('availability'));
  assert.deepEqual(classifyIntent('What is CSS?'), ['question']);
  assert.ok(classifyIntent('I had chest pain on my run').includes('safety'));
});

test('local-date resolution (never UTC)', () => {
  assert.equal(resolveDate('tomorrow', '2026-11-03').date, '2026-11-04');
  assert.equal(resolveDate('yesterday', '2026-11-01').date, '2026-10-31');
  assert.equal(resolveDate('on Friday', '2026-11-02').date, '2026-11-06');
  assert.equal(resolveDate('next Friday', '2026-11-02').date, '2026-11-13');
  assert.equal(resolveDate('I missed Monday', '2026-11-04', { preferPast: true }).date, '2026-11-02');
  assert.equal(resolveDate('Mar 14', '2027-01-10').date, '2027-03-14');
  assert.ok(resolveDate('Wednesday', '2026-11-04').ambiguousToday);
  const r = resolveRange('I am traveling Monday through Wednesday next week', '2026-11-04');
  assert.deepEqual([r.start, r.end], ['2026-11-09', '2026-11-11']);
});

test('effective plan: overrides never mutate the generated plan; completed history is preserved', () => {
  const st = fresh();
  const before = JSON.stringify(plan.sessions[wedRun.id]);
  const res = applyProposal(plan, st, { summary: 's', changes: [{ action: 'shorten', workoutId: wedRun.id, newDurationMin: 20, reason: 'r' }] }, { today: MON });
  assert.ok(res.ok);
  assert.equal(JSON.stringify(plan.sessions[wedRun.id]), before);
  assert.equal(effectiveSession(plan, res.state, wedRun.id).durationMin, 20);
  assert.deepEqual(res.state.logs, {}); // nothing marked completed
  // completed sessions cannot be changed
  const st2 = fresh();
  st2.logs[wedRun.id] = { status: 'completed', actual: { durationMin: 30 } };
  const v = validateProposal(plan, st2, { changes: [{ action: 'skip', workoutId: wedRun.id }] }, { today: MON });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /already logged as completed/);
});

test('scenario: "I cannot run Wednesday. Can you adjust my plan?" — reads the week, protects demanding days, applies only on approval', () => {
  const st = fresh();
  const ctx = ctxFor(st, MON);
  // reads the correct week
  const c = buildCoachContext(ctx);
  assert.ok(c.sessions.some((s) => s.id === wedRun.id));
  assert.ok(c.sessions.some((s) => s.date === '2026-11-07' && s.intensity === 'long')); // weekend long ride visible
  const reply = planOffline('I cannot run Wednesday. Can you adjust my plan?', ctx);
  assert.ok(reply.proposal, reply.message);
  assert.equal(reply.proposal.changes.length, 1);
  const ch = reply.proposal.changes[0];
  assert.equal(ch.workoutId, wedRun.id);
  if (ch.action === 'move') {
    // never onto a day that already has a demanding bike/run session or the Monday rest day
    const target = effectiveSessionsOn(plan, st, ch.newDate);
    assert.ok(!target.some((s) => ['bike', 'run'].includes(s.sport) && ['hard', 'long', 'test'].includes(s.intensity)), ch.newDate);
    assert.notEqual(dayOfWeek(ch.newDate), 1);
  } else assert.equal(ch.action, 'skip');
  assert.ok(ch.reason.length > 10);
  const msg = toCoachMessage(reply, ctx, { mode: 'rules', id: 'm1' });
  assert.equal(msg.proposalStatus, 'pending');
  // original plan unchanged until acceptance
  assert.deepEqual(st.reschedules, {});
  assert.deepEqual(st.overrides, {});
  // accept → applies only the validated change
  const res = applyProposal(plan, st, msg.proposal, { today: MON, source: 'rules' });
  assert.ok(res.ok);
  assert.deepEqual(Object.keys({ ...res.state.reschedules, ...res.state.overrides }), [wedRun.id]);
  assert.equal(res.state.changeHistory.length, 1);
  assert.deepEqual(res.state.logs, {});
  // reject path: state untouched
  const st3 = fresh();
  const m2 = toCoachMessage(reply, ctxFor(st3, MON), { mode: 'rules', id: 'm2' });
  m2.proposalStatus = 'rejected';
  assert.deepEqual(st3.reschedules, {});
  assert.deepEqual(st3.overrides, {});
});

test('follow-up memory: "can\'t run tomorrow" → move-or-skip question → "move it to Friday" → "actually only 25 minutes Friday"', () => {
  const st = fresh();
  const tue = '2026-11-03';
  const ctx = ctxFor(st, tue);
  const q = planOffline("I can't run tomorrow", ctx);
  assert.equal(q.proposal, null);
  assert.equal(q.pending.type, 'move_or_skip');
  assert.deepEqual(q.pending.workoutIds, [wedRun.id]);
  const p1 = planOffline('Move it to Friday', ctx, { pending: q.pending });
  assert.equal(p1.proposal.changes[0].action, 'move');
  assert.equal(p1.proposal.changes[0].newDate, '2026-11-06');
  const p2 = planOffline('Actually, I only have 25 minutes Friday', ctx, { activeProposal: p1.proposal });
  assert.equal(p2.proposal.changes[0].newDate, '2026-11-06');
  assert.equal(p2.proposal.changes[0].newDurationMin, 25);
  // modifying a proposal supersedes the earlier one (edge 11 + 18)
  const msgs = [toCoachMessage(p1, ctx, { mode: 'rules', id: 'a' })];
  supersedePending(msgs);
  msgs.push(toCoachMessage(p2, ctx, { mode: 'rules', id: 'b' }));
  assert.equal(msgs[0].proposalStatus, 'superseded');
  assert.equal(activeProposal(msgs).id, 'p-b');
});

test('multi-day travel: keeps key sessions where they fit, skips the rest, never compresses', () => {
  const st = fresh();
  const today = '2026-11-04';
  const reply = planOffline('I am traveling Monday through Wednesday next week. I can only train Thursday, Friday, Saturday, and Sunday.', ctxFor(st, today));
  assert.ok(reply.proposal);
  const changes = reply.proposal.changes;
  const affected = ['2026-11-09', '2026-11-10', '2026-11-11'].flatMap((d) => plan.byDate[d].sessions).filter((s) => s.sport !== 'rest');
  assert.equal(changes.length, affected.length);
  assert.ok(changes.some((c) => c.action === 'skip'));
  for (const c of changes.filter((x) => x.action === 'move')) assert.ok(c.newDate >= '2026-11-12' && c.newDate <= '2026-11-15');
  const v = validateProposal(plan, st, reply.proposal, { today });
  assert.ok(v.ok, v.errors.join('; '));
});

test('edge cases: empty message, safety, pain, no plan, no upcoming workouts', async () => {
  // 1 empty message: the UI guard returns before anything is stored
  const coach = await import('../js/ui/coach.js');
  const { load } = await import('../js/store/store.js');
  const n = load().coach.messages.length;
  await coach.send('   ', () => {}, null);
  assert.equal(load().coach.messages.length, n);
  // 16 serious symptoms → urgent, no proposal
  const st = fresh();
  const r = planOffline('I felt chest pain and almost fainted on my ride', ctxFor(st, MON));
  assert.equal(r.safetyLevel, 'urgent');
  assert.equal(r.proposal, null);
  assert.ok(detectRedFlags('my heart is racing at rest').length);
  const urgentAi = toCoachMessage({ message: 'x', safetyLevel: 'urgent', proposal: { summary: 's', changes: [{ action: 'skip', workoutId: wedRun.id }] } }, ctxFor(st, MON), { mode: 'ai' });
  assert.equal(urgentAi.proposal, undefined);
  // localized pain → caution + low-impact replacement, plus advice
  const p = planOffline('My shin hurts when I run', ctxFor(st, MON));
  assert.equal(p.safetyLevel, 'caution');
  assert.match(p.message, /sports-medicine|physiotherapist/);
  // 4 no plan for the date (before plan window) & 5 no upcoming workouts (after race)
  assert.doesNotThrow(() => buildCoachContext(ctxFor(st, '2026-09-01')));
  const after = planOffline("I can't train tomorrow", ctxFor(st, '2027-03-20'));
  assert.equal(after.proposal, null);
});

test('edge cases: completed workout, conflicting date, excessive load, unknown id, partial failure', () => {
  const st = fresh();
  // 6 skip a completed workout
  st.logs[wedRun.id] = { status: 'completed', actual: {} };
  const done = planOffline('I need to skip my run on Wednesday', ctxFor(st, MON));
  assert.match(done.message, /already logged as completed/);
  delete st.logs[wedRun.id];
  // 7 conflicting date: move Tuesday's bike intervals onto Thursday's hard run day
  const tueBike = plan.byDate['2026-11-03'].sessions.find((s) => s.sport === 'bike');
  const v7 = validateProposal(plan, st, { changes: [{ action: 'move', workoutId: tueBike.id, newDate: '2026-11-05' }] }, { today: MON });
  assert.equal(v7.ok, false);
  assert.match(v7.errors.join(' '), /stacking/);
  // 8 excessive load: cram last week's long ride into this week
  const satW5 = plan.byDate['2026-11-14'].sessions.find((s) => s.intensity === 'long');
  const v8 = validateProposal(plan, st, { changes: [{ action: 'move', workoutId: satW5.id, newDate: '2026-11-18' }] }, { today: '2026-11-09' });
  assert.equal(v8.ok, false);
  assert.match(v8.errors.join(' '), /more training load/);
  // 12 unknown workout id
  const v12 = validateProposal(plan, st, { changes: [{ action: 'skip', workoutId: '2026-11-04#9' }] }, { today: MON });
  assert.equal(v12.ok, false);
  assert.match(v12.errors[0], /does not exist/);
  // 15 multi-change proposal with one invalid change → nothing applied
  const bad = { summary: 'x', changes: [{ action: 'skip', workoutId: wedRun.id, reason: 'ok' }, { action: 'move', workoutId: tueBike.id, newDate: '2026-11-05', reason: 'bad' }] };
  const res = applyProposal(plan, st, bad, { today: MON });
  assert.equal(res.ok, false);
  assert.deepEqual(st.overrides, {});
  assert.deepEqual(st.reschedules, {});
});

test('edge cases: plan changed while pending, date rollover, overlapping proposals, undo', () => {
  const st = fresh();
  const p = { summary: 'skip run', changes: [{ action: 'skip', workoutId: wedRun.id, reason: 'r' }], today: MON };
  p.fingerprint = fingerprint(st, affectedIds(p));
  // 9 the athlete logs the session while the proposal is pending
  const changed = JSON.parse(JSON.stringify(st));
  changed.logs[wedRun.id] = { status: 'completed', actual: {} };
  const r9 = applyProposal(plan, changed, p, { today: MON });
  assert.equal(r9.ok, false);
  assert.equal(r9.stale, true);
  assert.equal(r9.validation.ok, false);
  // 17 local date rolled over since the proposal (e.g., timezone/midnight) → re-validated first
  const p17 = { summary: 'move', changes: [{ action: 'move', workoutId: wedRun.id, newDate: '2026-11-06', reason: 'r' }], today: MON };
  p17.fingerprint = fingerprint(st, affectedIds(p17));
  const r17 = applyProposal(plan, st, p17, { today: '2026-11-07' });
  assert.equal(r17.stale, true);
  assert.equal(r17.validation.ok, false); // Nov 6 is now in the past
  // happy path + undo
  const ok = applyProposal(plan, st, p17, { today: MON });
  assert.ok(ok.ok);
  assert.equal(effectiveSession(plan, ok.state, wedRun.id).date, '2026-11-06');
  assert.ok(canUndo(ok.state, ok.state.changeHistory[0], { today: MON }).ok);
  const u = undoChange(ok.state, ok.state.changeHistory[0].id, { today: MON });
  assert.ok(u.ok);
  assert.equal(effectiveSession(plan, u.state, wedRun.id).date, WED);
  // undo blocked once the session is logged
  ok.state.logs[wedRun.id] = { status: 'completed', actual: {} };
  assert.equal(canUndo(ok.state, ok.state.changeHistory[0], { today: MON }).ok, false);
});

test('edge 13: conversation and pending proposal survive a reload (persisted state)', () => {
  const st = fresh();
  const reply = planOffline('Skip my run on Wednesday', ctxFor(st, MON));
  const msg = toCoachMessage(reply, ctxFor(st, MON), { mode: 'rules', id: 'x' });
  st.coach.messages.push({ role: 'athlete', id: 'q', text: 'Skip my run on Wednesday' }, msg);
  const reloaded = migrate(JSON.parse(JSON.stringify(st)));
  assert.equal(reloaded.coach.messages.length, 2);
  assert.equal(activeProposal(reloaded.coach.messages).id, 'p-x');
  assert.deepEqual(transcript(reloaded.coach.messages).map((t) => t.role), ['user', 'assistant']);
});

test('planned vs actual stay distinct after adjustments; history is not rewritten', () => {
  const st = fresh();
  const w = plan.weeks[4];
  st.logs[w.days[1].sessions[0].id] = { status: 'completed', actual: { durationMin: 60, rpe: 6 } };
  const before = aggregate(w.days, st.logs, { plan, state: st });
  const res = applyProposal(plan, st, { summary: 's', changes: [{ action: 'skip', workoutId: wedRun.id, reason: 'r' }] }, { today: MON });
  const after = aggregate(w.days, res.state.logs, { plan, state: res.state });
  assert.equal(after.planned.run, before.planned.run - wedRun.durationMin);
  assert.deepEqual(after.actual, before.actual);
});

test('client API failures: not configured, timeout, network, unauthorized, malformed', async () => {
  await assert.rejects(callCoachAPI({ endpoint: '', messages: [], context: {} }), (e) => e instanceof CoachError && e.kind === 'not_configured');
  const hang = () => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 30));
  await assert.rejects(callCoachAPI({ endpoint: 'https://x.dev', messages: [], context: {} }, { timeoutMs: 10, fetchImpl: hang }), (e) => e.kind === 'timeout');
  await assert.rejects(callCoachAPI({ endpoint: 'https://x.dev', messages: [], context: {} }, { fetchImpl: () => Promise.reject(new TypeError('fail')) }), (e) => e.kind === 'network');
  const resp = (status, body) => () => Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) });
  await assert.rejects(callCoachAPI({ endpoint: 'https://x.dev', messages: [], context: {} }, { fetchImpl: resp(401, { error: 'no' }) }), (e) => e.kind === 'unauthorized');
  await assert.rejects(callCoachAPI({ endpoint: 'https://x.dev', messages: [], context: {} }, { fetchImpl: resp(200, { nope: 1 }) }), (e) => e.kind === 'malformed');
  const ok = await callCoachAPI({ endpoint: 'https://x.dev', messages: [{ role: 'user', text: 'hi' }], context: {} }, { fetchImpl: resp(200, { message: 'hello', mode: 'ai' }) });
  assert.equal(ok.message, 'hello');
});
