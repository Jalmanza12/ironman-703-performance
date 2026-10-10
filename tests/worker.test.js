import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, MAX_BODY_BYTES } from '../worker/src/handler.js';
import { validateOutput, validateRequest, buildMessages, OUTPUT_SCHEMA } from '../worker/src/schema.js';

const ORIGIN = 'https://jalmanza12.github.io';
const ENV = { ANTHROPIC_API_KEY: 'test-key', COACH_ACCESS_CODE: 'secret-code', ALLOWED_ORIGINS: ORIGIN };
const context = { today: '2026-11-02', sessions: [{ id: '2026-11-04#1', date: '2026-11-04' }] };
const goodOutput = { message: 'Move it to Friday.', intents: ['reschedule'], followUpQuestion: null, safetyLevel: 'none', proposal: { summary: 'Move run', expectedImpact: 'none', recoveryNotes: '', changes: [{ action: 'move', workoutId: '2026-11-04#1', newDate: '2026-11-06', newDurationMin: null, replacement: null, reason: 'Light day' }] }, availabilityUpdate: null };

function req(body, { headers = {}, method = 'POST', path = '/coach' } = {}) {
  return new Request(`https://coach.example.dev${path}`, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Coach-Access': 'secret-code', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
}
const valid = { messages: [{ role: 'user', text: "I can't run Wednesday" }], context };
const handlerWith = (callModel) => createHandler({ callModel });

test('CORS preflight, origin restriction, health without secrets', async () => {
  const h = handlerWith(async () => ({}));
  const pre = await h(req(null, { method: 'OPTIONS' }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const bad = await h(req(valid, { headers: { Origin: 'https://evil.example' } }), ENV);
  assert.equal(bad.status, 403);
  const health = await (await h(req(null, { method: 'GET', path: '/health' }), ENV)).json();
  assert.equal(health.configured, true);
  assert.ok(!JSON.stringify(health).includes('test-key'));
});

test('auth, size limit, invalid JSON, request validation', async () => {
  const h = handlerWith(async () => ({ stopReason: 'end_turn', text: JSON.stringify(goodOutput), model: 'm' }));
  assert.equal((await h(req(valid, { headers: { 'X-Coach-Access': 'wrong' } }), ENV)).status, 401);
  assert.equal((await h(req('x'.repeat(MAX_BODY_BYTES + 10)), ENV)).status, 413);
  assert.equal((await h(req('{not json'), ENV)).status, 400);
  assert.equal((await h(req({ messages: [{ role: 'user', text: '   ' }], context }), ENV)).status, 400); // empty message
  assert.equal(validateRequest({ messages: [{ role: 'assistant', text: 'hi' }], context }).ok, false);
  assert.equal(validateRequest({ messages: [{ role: 'user', text: 'hi' }], context: { today: '11/02/2026', sessions: [] } }).ok, false);
});

test('missing API key → 503 not_configured; labeled mock mode when enabled', async () => {
  const h = handlerWith(async () => { throw new Error('should not be called'); });
  const r = await h(req(valid), { ...ENV, ANTHROPIC_API_KEY: '' });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'not_configured');
  const m = await (await h(req(valid), { ...ENV, ANTHROPIC_API_KEY: '', MOCK_MODE: 'true' })).json();
  assert.equal(m.mode, 'mock');
  assert.match(m.message, /MOCK RESPONSE — not AI-generated/);
});

test('valid model output is schema-validated and returned; context is attached to the last user turn', async () => {
  let seen;
  const h = handlerWith(async (_env, args) => { seen = args; return { stopReason: 'end_turn', text: JSON.stringify(goodOutput), model: 'claude-opus-5-5' }; });
  const r = await h(req(valid), ENV);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.mode, 'ai');
  assert.equal(b.proposal.changes[0].workoutId, '2026-11-04#1');
  assert.match(seen.messages.at(-1).content, /<training_context>/);
  assert.match(seen.system, /Never invent workouts, ids/);
});

test('AI failures: timeout → 504, provider down → 502, rate limited → 429, malformed → 502, refusal handled', async () => {
  const thrower = (e) => handlerWith(async () => { throw e; });
  assert.equal((await thrower(Object.assign(new Error('t'), { name: 'TimeoutError' }))(req(valid), ENV)).status, 504);
  assert.equal((await thrower(Object.assign(new Error('x'), { name: 'APIError', status: 500 }))(req(valid), ENV)).status, 502);
  assert.equal((await thrower(Object.assign(new Error('x'), { name: 'APIError', status: 429 }))(req(valid), ENV)).status, 429);
  const mal = await handlerWith(async () => ({ stopReason: 'end_turn', text: 'here is your plan: {', model: 'm' }))(req(valid), ENV);
  assert.equal(mal.status, 502);
  assert.equal((await mal.json()).code, 'malformed_output');
  const wrongShape = await handlerWith(async () => ({ stopReason: 'end_turn', text: JSON.stringify({ message: 'hi' }), model: 'm' }))(req(valid), ENV);
  assert.equal(wrongShape.status, 502);
  const refusal = await (await handlerWith(async () => ({ stopReason: 'refusal', text: '', model: 'm' }))(req(valid), ENV)).json();
  assert.equal(refusal.proposal, null);
});

test('server withholds proposals with invented workout ids and on urgent safety', () => {
  const invented = JSON.parse(JSON.stringify(goodOutput));
  invented.proposal.changes[0].workoutId = '2099-01-01#0';
  const v = validateOutput(invented, context);
  assert.equal(v.ok, true);
  assert.equal(v.value.proposal, null);
  assert.match(v.value.message, /withheld/);
  const urgent = { ...goodOutput, safetyLevel: 'urgent' };
  assert.equal(validateOutput(urgent, context).value.proposal, null);
  const badMove = JSON.parse(JSON.stringify(goodOutput));
  badMove.proposal.changes[0].newDate = null;
  assert.equal(validateOutput(badMove, context).ok, false);
});

test('rate limiting per client', async () => {
  const h = handlerWith(async () => ({ stopReason: 'end_turn', text: JSON.stringify(goodOutput), model: 'm' }));
  let last;
  for (let i = 0; i < 31; i += 1) last = await h(req(valid, { headers: { 'CF-Connecting-IP': '9.9.9.9' } }), ENV);
  assert.equal(last.status, 429);
});

test('output schema is strict-friendly (every object closed with required keys)', () => {
  const walk = (s) => {
    if (s.anyOf) return s.anyOf.forEach(walk);
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  walk(OUTPUT_SCHEMA);
  assert.equal(buildMessages([{ role: 'assistant', text: 'hi' }, { role: 'user', text: 'q' }], context)[0].role, 'user');
});
