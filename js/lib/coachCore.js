// HTTP client for the AI Coach backend (Cloudflare Worker). Never sends or stores an
// AI-provider key — only the athlete's own access code for their Worker.

export class CoachError extends Error {
  constructor(kind, message) {
    super(message);
    // 'empty' | 'too_long' | 'not_configured' | 'timeout' | 'network' | 'unauthorized' |
    // 'rate_limited' | 'busy' | 'server' | 'malformed'
    this.kind = kind;
  }
}

/** One model step. Returns { mode, model, stopReason, content }. */
export async function callCoachAPI({ endpoint, accessCode, messages, timeZone, localDate }, { timeoutMs = 70000, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint) throw new CoachError('not_configured', 'The AI Coach is not connected yet.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${endpoint.replace(/\/$/, '')}/coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessCode ? { 'X-Coach-Access': accessCode } : {}) },
      body: JSON.stringify({ messages, timeZone, localDate }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new CoachError('timeout', 'The AI coach took too long to respond.');
    throw new CoachError('network', 'Could not reach the AI Coach backend (check the URL and your connection).');
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    throw new CoachError('malformed', 'The AI Coach backend returned an unreadable response.');
  }
  if (res.status === 401 || res.status === 403) throw new CoachError('unauthorized', body?.error || 'Access code rejected.');
  if (res.status === 429) throw new CoachError('rate_limited', body?.error || 'Too many requests — try again in a minute.');
  if (res.status === 503 && body?.code === 'not_configured') throw new CoachError('not_configured', body.error);
  if (res.status === 503) throw new CoachError('busy', body?.error || 'The AI service is busy.');
  if (res.status === 504) throw new CoachError('timeout', body?.error || 'The AI model timed out.');
  if (!res.ok) throw new CoachError('server', body?.error || `AI Coach error (${res.status}).`);
  if (!body || !Array.isArray(body.content) || !body.content.length || typeof body.stopReason !== 'string') throw new CoachError('malformed', 'The AI Coach returned an invalid response.');
  return body;
}

export async function checkHealth(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!endpoint) return { state: 'not_configured', text: 'Not connected' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${endpoint.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    const b = await r.json();
    if (b.configured) return { state: 'ok', text: `AI connected · ${b.model}` };
    if (b.mock) return { state: 'mock', text: 'Development mock mode (not AI)' };
    if (!b.apiKey) return { state: 'bad', text: 'Backend missing ANTHROPIC_API_KEY' };
    return { state: 'bad', text: 'Backend missing COACH_ACCESS_CODE' };
  } catch {
    return { state: 'bad', text: 'Backend unreachable' };
  } finally {
    clearTimeout(t);
  }
}
