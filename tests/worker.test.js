import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, MAX_BODY_BYTES } from '../worker/src/handler.js';
import { validateRequest, TOOLS, SYSTEM_PROMPT } from '../worker/src/schema.js';

const ORIGIN = 'https://jalmanza12.github.io';
const ENV = { ANTHROPIC_API_KEY: 'test-key', COACH_ACCESS_CODE: 'secret-code', ALLOWED_ORIGINS: ORIGIN };
const valid = { messages: [{ role: 'user', content: [{ type: 'text', text: '<app_snapshot>…</app_snapshot>' }, { type: 'text', text: "I can't train tomorrow" }] }], timeZone: 'America/Chicago', localDate: '2026-10-09' };

function req(body, { headers = {}, method = 'POST', path = '/coach' } = {}) {
  return new Request(`https://coach.example.dev${path}`, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Coach-Access': 'secret-code', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
}
const handlerWith = (callModel) => createHandler({ callModel });

test('CORS, origin restriction, health reports configuration without secrets', async () => {
  const h = handlerWith(async () => ({}));
  const pre = await h(req(null, { method: 'OPTIONS' }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await h(req(valid, { headers: { Origin: 'https://evil.example' } }), ENV)).status, 403);
  const health = await (await h(req(null, { method: 'GET', path: '/health' }), ENV)).json();
  assert.equal(health.configured, true);
  assert.ok(!JSON.stringify(health).includes('test-key'));
  const noKey = await (await h(req(null, { method: 'GET', path: '/health' }), { ...ENV, ANTHROPIC_API_KEY: '' })).json();
  assert.deepEqual([noKey.configured, noKey.apiKey], [false, false]);
});

test('auth, size limit, JSON and transcript validation', async () => {
  const h = handlerWith(async () => ({ stopReason: 'end_turn', content: [{ type: 'text', text: 'hi' }], model: 'm' }));
  assert.equal((await h(req(valid, { headers: { 'X-Coach-Access': 'wrong' } }), ENV)).status, 401);
  assert.equal((await h(req('x'.repeat(MAX_BODY_BYTES + 10)), ENV)).status, 413);
  assert.equal((await h(req('{not json'), ENV)).status, 400);
  assert.equal((await h(req({ messages: [{ role: 'user', content: '   ' }] }), ENV)).status, 400);
  assert.equal(validateRequest({ messages: [{ role: 'assistant', content: 'hi' }] }).ok, false);
  assert.equal(validateRequest({ messages: [{ role: 'user', content: [{ type: 'tool_use', id: 'x', name: 'get_schedule', input: {} }] }] }).ok, false);
  assert.equal(validateRequest({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'delete_everything', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '{}' }] }] }).ok, false);
  const multi = { messages: [valid.messages[0], { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'get_schedule', input: { start_date: '2026-10-10', end_date: '2026-10-10' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"sessions":[]}' }] }] };
  assert.equal(validateRequest(multi).ok, true);
});

test('missing API key → 503 not_configured; mock mode is explicitly labeled', async () => {
  const h = handlerWith(async () => { throw new Error('should not be called'); });
  const r = await h(req(valid), { ...ENV, ANTHROPIC_API_KEY: '' });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'not_configured');
  const m = await (await h(req(valid), { ...ENV, ANTHROPIC_API_KEY: '', MOCK_MODE: 'true' })).json();
  assert.equal(m.mode, 'mock');
  assert.match(m.content[0].text, /DEVELOPMENT MOCK — not AI-generated/);
});

test('model step: transcript, system prompt and tools are passed; content returned verbatim', async () => {
  let seen;
  const content = [{ type: 'thinking', thinking: '', signature: 'abc' }, { type: 'tool_use', id: 't1', name: 'get_schedule', input: { start_date: '2026-10-10', end_date: '2026-10-10' } }];
  const h = handlerWith(async (_env, args) => { seen = args; return { stopReason: 'tool_use', content, model: 'claude-opus-5-5' }; });
  const r = await h(req(valid), ENV);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.mode, 'ai');
  assert.equal(b.stopReason, 'tool_use');
  assert.deepEqual(b.content, content);
  assert.deepEqual(seen.messages, valid.messages); // the athlete's actual message reaches the model
  assert.equal(seen.system, SYSTEM_PROMPT);
  assert.equal(seen.tools, TOOLS);
});

test('AI failures map to clear errors; refusals are handled; unknown tool calls are dropped', async () => {
  const thrower = (e) => handlerWith(async () => { throw e; });
  assert.equal((await thrower(Object.assign(new Error('t'), { name: 'TimeoutError' }))(req(valid), ENV)).status, 504);
  assert.equal((await thrower(Object.assign(new Error('x'), { name: 'APIError', status: 500 }))(req(valid), ENV)).status, 502);
  assert.equal((await thrower(Object.assign(new Error('x'), { name: 'APIError', status: 529 }))(req(valid), ENV)).status, 503);
  const badKey = await thrower(Object.assign(new Error('x'), { name: 'APIError', status: 401 }))(req(valid), ENV);
  assert.match((await badKey.json()).error, /ANTHROPIC_API_KEY/);
  const refusal = await (await handlerWith(async () => ({ stopReason: 'refusal', content: [], model: 'm' }))(req(valid), ENV)).json();
  assert.equal(refusal.stopReason, 'refusal');
  const empty = await handlerWith(async () => ({ stopReason: 'end_turn', content: [{ type: 'tool_use', id: 'z', name: 'rm_rf', input: {} }], model: 'm' }))(req(valid), ENV);
  assert.equal(empty.status, 502);
});

test('rate limiting per client', async () => {
  const h = handlerWith(async () => ({ stopReason: 'end_turn', content: [{ type: 'text', text: 'ok' }], model: 'm' }));
  let last;
  for (let i = 0; i < 121; i += 1) last = await h(req(valid, { headers: { 'CF-Connecting-IP': '9.9.9.9' } }), ENV);
  assert.equal(last.status, 429);
});

test('tool definitions are strict-schema friendly and cover read + propose actions', () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ['get_athlete_profile', 'get_schedule', 'get_weekly_schedule', 'get_workout_details', 'get_recent_training', 'propose_skip_workout', 'propose_reschedule_workout', 'propose_modify_workout', 'propose_replace_workout', 'propose_weekly_adjustment', 'propose_availability_update', 'withdraw_pending_proposal']) assert.ok(names.includes(n), n);
  const walk = (s) => {
    if (s.anyOf) return s.anyOf.forEach(walk);
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  for (const t of TOOLS) {
    assert.equal(t.strict, true);
    walk(t.input_schema);
  }
});
