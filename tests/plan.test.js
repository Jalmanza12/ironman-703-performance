import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../js/plan/generator.js';
import { WEEKS } from '../js/plan/weeks.js';
import { aggregate, compareSession } from '../js/lib/load.js';
import { rescheduleOptions } from '../js/lib/reschedule.js';
import { dayOfWeek } from '../js/lib/dates.js';

const plan = buildPlan();

test('calendar spans Oct 5 2026 → race day Mar 14 2027 with every day present', () => {
  assert.equal(plan.days.length, 161);
  assert.equal(plan.days[0].date, '2026-10-05');
  assert.equal(plan.days.at(-1).date, '2027-03-14');
  assert.equal(plan.days.at(-1).sessions[0].sport, 'race');
  for (let i = 1; i < plan.days.length; i += 1) assert.ok(plan.days[i].date > plan.days[i - 1].date);
});

test('every day has a workout (or rest) with full instructions and a unique Bible passage', () => {
  const refs = new Set();
  for (const d of plan.days) {
    assert.ok(d.sessions.length >= 1, d.date);
    for (const s of d.sessions) {
      assert.ok(s.title && s.objective && s.purpose, `${d.date} ${s.title}`);
      assert.ok(s.main.length >= 1, `${d.date} main set`);
      assert.ok(s.modifications && s.modifications.illness, `${d.date} mods`);
      assert.ok(s.priority, `${d.date} priority`);
    }
    assert.ok(d.bible.ref && d.bible.summary && d.bible.reflection && d.bible.question, d.date);
    refs.add(d.bible.ref);
  }
  assert.equal(refs.size, plan.days.length);
  const t = plan.days.map((d) => d.bible.testament);
  assert.ok(t.includes('OT') && t.includes('NT'));
});

test('weeks start on Mondays; non-race weeks keep Monday as rest', () => {
  for (const w of plan.weeks) {
    assert.equal(dayOfWeek(w.start), 1, `week ${w.n}`);
    if (w.n >= 1) assert.ok(w.days[0].sessions.some((s) => s.sport === 'rest'), `week ${w.n} Monday`);
  }
});

test('recovery weeks reduce volume vs. preceding build week and describe the deload', () => {
  for (const w of plan.weeks.filter((x) => x.type === 'recovery' && x.n > 2)) {
    const prev = plan.weeks[w.n - 1];
    assert.ok(w.totals.totalMin < prev.totals.totalMin * 0.65, `week ${w.n}`);
    assert.ok(WEEKS[w.n].deload?.volume && WEEKS[w.n].deload?.markers);
  }
  const peak = plan.weeks.find((w) => w.type === 'peak');
  const taper = plan.weeks.find((w) => w.type === 'taper');
  assert.ok(taper.totals.totalMin < peak.totals.totalMin);
});

test('no back-to-back hard LEG days (bike/run intervals or tests) on weekdays; swim quality may sit between', () => {
  const hard = (d) => d.sessions.some((s) => (s.sport === 'bike' || s.sport === 'run') && (s.intensity === 'hard' || s.intensity === 'test'));
  for (let i = 1; i < plan.days.length; i += 1) {
    const a = plan.days[i - 1];
    const b = plan.days[i];
    const dow = dayOfWeek(b.date);
    if (dow === 0 || dow === 6) continue; // weekend long pair is intentional
    assert.ok(!(hard(a) && hard(b) && dayOfWeek(a.date) !== 6), `${a.date} & ${b.date}`);
  }
});

test('volume aggregation and planned vs actual completion', () => {
  const w = plan.weeks[4];
  const empty = aggregate(w.days, {});
  assert.equal(empty.actual.total, 0);
  assert.equal(empty.completion, 0);
  const logs = {};
  const tue = w.days[1].sessions[0];
  logs[tue.id] = { status: 'completed', actual: { durationMin: tue.durationMin, rpe: 6 } };
  const sat = w.days[5].sessions[0];
  logs[sat.id] = { status: 'skipped' };
  const a = aggregate(w.days, logs);
  assert.equal(a.actual.bike, tue.durationMin);
  assert.equal(a.actual.sessions, 1);
  assert.ok(a.completion > 0 && a.completion < 1);
  assert.equal(a.planned.total, w.days.flatMap((d) => d.sessions).filter((s) => s.sport !== 'rest' && s.priority !== 'Optional').reduce((x, s) => x + s.durationMin, 0));
});

test('session comparison gives specific feedback', () => {
  const s = plan.weeks[4].days[1].sessions[0]; // sweet spot
  const fb = compareSession(s, { status: 'completed', actual: { durationMin: s.durationMin, rpe: 9, intervalsCompleted: 2 } }, {});
  assert.ok(fb.fellShort.some((x) => /2\/3 intervals/.test(x)));
  assert.ok(fb.fellShort.some((x) => /harder than intended/.test(x)));
  const skip = compareSession(s, { status: 'skipped' }, {});
  assert.match(skip.change[0], /Reschedule/);
});

test('rescheduling respects recovery', () => {
  const longRide = plan.weeks[5].days[5].sessions[0];
  const r = rescheduleOptions(plan, longRide.id, { today: '2026-11-01' });
  for (const o of r.options) assert.ok([0, 6].includes(dayOfWeek(o.date)), o.date);
  const easy = plan.weeks[5].days[2].sessions[1]; // Wed easy run (supporting)
  assert.equal(rescheduleOptions(plan, easy.id, { today: '2026-11-01' }).allowed, false);
  const tue = plan.weeks[5].days[1].sessions[0];
  const opts = rescheduleOptions(plan, tue.id, { today: '2026-11-01' }).options.map((o) => o.date);
  assert.ok(!opts.includes('2026-11-09')); // Monday rest
  assert.ok(!opts.includes('2026-11-12')); // Thursday already hard
});
