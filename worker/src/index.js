// Cloudflare Worker entry: wires the Anthropic SDK into the tested request handler.
// Secrets (ANTHROPIC_API_KEY, COACH_ACCESS_CODE) come from Worker secrets — never from the repo.

import Anthropic from '@anthropic-ai/sdk';
import { createHandler } from './handler.js';

async function callModel(env, { system, tools, messages }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 1 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: env.COACH_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: [
        // Retry on Anthropic's recommended fallback model if a safety classifier declines.
        'server-side-fallback-2026-07-01',
        // The transcript is replayed append-only; if a thinking block ever fails the
        // conversation check, drop it instead of failing the request.
        'thinking-binding-controls-2026-08-01',
      ],
      fallbacks: 'default',
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: env.COACH_EFFORT || 'medium' },
      // Stable prefix (tools → system) is cached; the conversation follows.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      tool_choice: { type: 'auto' },
      messages,
    });
  } catch (e) {
    // Normalize SDK errors (typed classes, most specific first) for the handler.
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    if (e instanceof Anthropic.APIError) throw Object.assign(new Error('api_error'), { name: 'APIError', status: e.status });
    throw Object.assign(new Error('unknown'), { name: 'Error' });
  }
  return {
    stopReason: response.stop_reason,
    content: response.content,
    model: response.model,
    inputTransformations: response.input_transformations || [],
  };
}

const handler = createHandler({ callModel });

export default {
  fetch: (request, env) => handler(request, env),
};
