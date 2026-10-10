// Request handling for the AI Coach Worker (SDK-free so it can be unit-tested).
// Each POST /coach runs ONE model step: the browser sends the append-only transcript (including
// prior tool calls/results), the Worker calls the model with the fixed system prompt + tools, and
// returns the assistant content. When the model asks for tools, the browser runs them against the
// athlete's real data and calls again with the results.
// createHandler({ callModel }) → fetch(request, env). `callModel(env, { system, tools, messages })`
// returns { stopReason, content, model, inputTransformations } or throws (.name / .status).

import { validateRequest, sanitizeContent, SYSTEM_PROMPT, TOOLS } from './schema.js';

export const MAX_BODY_BYTES = 512 * 1024;
const RATE = { windowMs: 10 * 60 * 1000, max: 120 }; // model steps, not messages (tool loops use several)

export function createHandler({ callModel, now = () => Date.now() }) {
  const hits = new Map(); // best-effort per-isolate limiter; add a Rate Limiting binding for global limits

  function rateLimited(ip) {
    const t = now();
    const list = (hits.get(ip) || []).filter((x) => t - x < RATE.windowMs);
    list.push(t);
    hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return list.length > RATE.max;
  }

  return async function fetchHandler(request, env = {}) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://jalmanza12.github.io').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Coach-Access',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (origin && !allowed.includes(origin)) return json(403, { error: 'Origin not allowed.' });

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, configured: !!env.ANTHROPIC_API_KEY && !!env.COACH_ACCESS_CODE, apiKey: !!env.ANTHROPIC_API_KEY, accessCode: !!env.COACH_ACCESS_CODE, model: env.COACH_MODEL || 'claude-opus-5-5', mock: env.MOCK_MODE === 'true' });
    }
    if (request.method !== 'POST' || url.pathname !== '/coach') return json(404, { error: 'Not found.' });

    if (!env.COACH_ACCESS_CODE) return json(503, { error: 'The AI Coach backend is missing its COACH_ACCESS_CODE secret.', code: 'not_configured' });
    if (!safeEqual(request.headers.get('X-Coach-Access') || '', env.COACH_ACCESS_CODE)) return json(401, { error: 'Access code rejected.', code: 'unauthorized' });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json(429, { error: 'Too many requests — try again in a few minutes.' });
    if (env.RATE_LIMITER?.limit) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: 'Too many requests — try again in a few minutes.' });
    }

    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return json(413, { error: 'Conversation too large — start a new conversation.' });
    let raw;
    try {
      raw = await request.text();
    } catch {
      return json(400, { error: 'Could not read request.' });
    }
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Conversation too large — start a new conversation.' });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'Body must be valid JSON.' });
    }
    const vr = validateRequest(body);
    if (!vr.ok) return json(400, { error: vr.error });

    if (!env.ANTHROPIC_API_KEY) {
      if (env.MOCK_MODE === 'true') {
        return json(200, { mode: 'mock', model: 'mock', stopReason: 'end_turn', content: [{ type: 'text', text: '[DEVELOPMENT MOCK — not AI-generated] The backend is running without ANTHROPIC_API_KEY. Your message reached the server; no coaching was generated.' }] });
      }
      return json(503, { error: 'The AI Coach backend is deployed but ANTHROPIC_API_KEY is not set.', code: 'not_configured' });
    }

    let result;
    try {
      result = await callModel(env, { system: SYSTEM_PROMPT, tools: TOOLS, messages: body.messages });
    } catch (e) {
      // Log only error class/status — never transcript content, keys or headers.
      console.error('coach_model_error', e?.name || 'Error', e?.status || '');
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return json(504, { error: 'The AI model timed out. Please try again.', code: 'timeout' });
      if (e?.status === 429 || e?.status === 529) return json(503, { error: 'The AI service is busy right now. Try again shortly.', code: 'busy' });
      if (e?.status === 401 || e?.status === 403) return json(502, { error: 'The AI service rejected the server\'s API key. Check ANTHROPIC_API_KEY.', code: 'bad_key' });
      if (e?.status === 400) return json(502, { error: 'The AI service rejected the conversation. Start a new conversation and try again.', code: 'bad_request' });
      return json(502, { error: 'The AI service is unavailable right now.', code: 'unavailable' });
    }
    if (result.stopReason === 'refusal') {
      return json(200, { mode: 'ai', model: result.model, stopReason: 'refusal', content: [{ type: 'text', text: "I can't help with that request. I'm happy to help with your training, recovery, schedule and race preparation." }] });
    }
    const content = sanitizeContent(result.content);
    if (!content.length) return json(502, { error: 'The AI returned an empty response.', code: 'empty' });
    return json(200, { mode: 'ai', model: result.model, stopReason: result.stopReason, content, inputTransformations: result.inputTransformations || [] });
  };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
