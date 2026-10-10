// Cloudflare Worker entry: wires the Anthropic SDK into the tested request handler.
// Secrets (ANTHROPIC_API_KEY, COACH_ACCESS_CODE) come from Worker secrets — never from the repo.

import Anthropic from '@anthropic-ai/sdk';
import { createHandler } from './handler.js';
import { OUTPUT_SCHEMA } from './schema.js';

async function callModel(env, { system, messages }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 1 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: env.COACH_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      // Server-side fallback: if a safety classifier declines, the API retries on Anthropic's
      // recommended fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: env.COACH_EFFORT || 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    });
  } catch (e) {
    // Normalize SDK errors (typed classes, most specific first) for the handler.
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    if (e instanceof Anthropic.APIError) throw Object.assign(new Error('api_error'), { name: 'APIError', status: e.status });
    throw Object.assign(new Error('unknown'), { name: 'Error' });
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { stopReason: response.stop_reason, text, model: response.model };
}

const handler = createHandler({ callModel });

export default {
  fetch: (request, env) => handler(request, env),
};
