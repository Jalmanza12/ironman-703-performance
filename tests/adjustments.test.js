// Plan adjustments (manual reschedules + approved changes): validation, staleness, undo, load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../js/plan/generator.js';
import { emptyState } from '../js/store/store.js';
import { effectiveSession, validateProposal, applyProposal, fingerprint, affectedIds, undoChange, canUndo } from '../js/lib/adjustments.js';
import { aggregate } from '../js/lib/load.js';

const plan = buildPlan();

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

