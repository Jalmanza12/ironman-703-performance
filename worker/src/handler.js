// Request handling for the AI Coach Worker (SDK-free so it can be unit-tested).
// createHandler({ callModel }) → fetch(request, env). `callModel(env, {system, messages})`
// returns { stopReason, text, model } or throws an error with .status / .name.

import { validateRequest, validateOutput, buildMessages, SYSTEM_PROMPT } from './schema.js';

export const MAX_BODY_BYTES = 64 * 1024;
const RATE = { windowMs: 10 * 60 * 1000, max: 30 };

export function createHandler({ callModel, now = () => Date.now() }) {
  const hits = new Map(); // best-effort per-isolate limiter (add a Cloudflare Rate Limiting binding for global limits)

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
      return json(200, { ok: true, configured: !!env.ANTHROPIC_API_KEY, mock: !env.ANTHROPIC_API_KEY && env.MOCK_MODE === 'true', accessCodeRequired: !!env.COACH_ACCESS_CODE });
    }
    if (request.method !== 'POST' || url.pathname !== '/coach') return json(404, { error: 'Not found.' });

    if (!env.COACH_ACCESS_CODE) return json(503, { error: 'Server is missing COACH_ACCESS_CODE.', code: 'not_configured' });
    if (!safeEqual(request.headers.get('X-Coach-Access') || '', env.COACH_ACCESS_CODE)) return json(401, { error: 'Access code rejected.' });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json(429, { error: 'Too many requests — try again in a few minutes.' });
    if (env.RATE_LIMITER?.limit) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: 'Too many requests — try again in a few minutes.' });
    }

    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_BODY_BYTES) return json(413, { error: 'Request too large.' });
    let raw;
    try {
      raw = await request.text();
    } catch {
      return json(400, { error: 'Could not read request.' });
    }
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Request too large.' });
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
        return json(200, { mode: 'mock', message: '[MOCK RESPONSE — not AI-generated] The backend is running without an API key. Your message was received and validated; no coaching advice was generated.', intents: ['question'], followUpQuestion: null, safetyLevel: 'none', proposal: null, availabilityUpdate: null });
      }
      return json(503, { error: 'AI backend is deployed but ANTHROPIC_API_KEY is not set.', code: 'not_configured' });
    }

    let result;
    try {
      result = await callModel(env, { system: SYSTEM_PROMPT, messages: buildMessages(body.messages, body.context) });
    } catch (e) {
      // Log only the error class/status — never request bodies, keys, or headers.
      console.error('coach_model_error', e?.name || 'Error', e?.status || '');
      if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'TimeoutError' || e?.name === 'AbortError') return json(504, { error: 'The AI model timed out. Please try again.' });
      if (e?.status === 429) return json(429, { error: 'The AI service is busy. Try again shortly.' });
      if (e?.status === 401 || e?.status === 403) return json(502, { error: 'The AI service rejected the server credentials.' });
      return json(502, { error: 'The AI service is unavailable right now.' });
    }
    if (result.stopReason === 'refusal') {
      return json(200, { mode: 'ai', model: result.model, message: "I can't help with that request. I can help adjust training sessions, recovery, and race preparation.", intents: ['question'], followUpQuestion: null, safetyLevel: 'none', proposal: null, availabilityUpdate: null });
    }
    if (result.stopReason === 'max_tokens') return json(502, { error: 'The AI response was cut off. Please try a shorter request.', code: 'malformed_output' });
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      return json(502, { error: 'The AI returned malformed output.', code: 'malformed_output' });
    }
    const v = validateOutput(parsed, body.context);
    if (!v.ok) {
      console.error('coach_output_invalid', v.errors.join(','));
      return json(502, { error: 'The AI returned output that failed validation.', code: 'malformed_output' });
    }
    return json(200, { mode: 'ai', model: result.model, ...v.value });
  };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
