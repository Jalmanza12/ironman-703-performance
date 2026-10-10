// AI Coach agent contract: system prompt, tool definitions and request validation.
// Tools are CLIENT tools: the model requests them, the athlete's browser executes them against
// the real training data (localStorage) and returns results. The model can read data and
// PROPOSE changes; it cannot apply anything. Proposals are validated in the browser and only
// applied after the athlete presses "Accept Changes".

export const ACTIONS = ['skip', 'move', 'shorten', 'replace'];
export const SPORTS = ['swim', 'bike', 'run', 'strength', 'mobility', 'other'];
export const INTENSITIES = ['easy', 'moderate', 'hard', 'long'];
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const str = (description) => ({ type: 'string', description });
const nstr = (description) => ({ type: ['string', 'null'], description });
const nint = (description) => ({ type: ['integer', 'null'], description });
const obj = (properties, description) => ({ type: 'object', description, additionalProperties: false, required: Object.keys(properties), properties });

const REPLACEMENT = obj({
  title: str('Short title, e.g. "Easy recovery spin".'),
  sport: { type: 'string', enum: SPORTS },
  duration_min: { type: 'integer', description: '10–240 min; at most 125% of the original.' },
  intensity: { type: 'string', enum: INTENSITIES },
  description: str('What the athlete should actually do (targets in RPE/zones).'),
}, 'The replacement session.');

const CHANGE = obj({
  action: { type: 'string', enum: ACTIONS },
  workout_id: str('Exact id from the schedule (e.g. "2026-10-10#1"). Never invent ids.'),
  new_date: nstr('YYYY-MM-DD for "move"; otherwise null.'),
  new_duration_min: nint('For "shorten", or to also shorten a moved session; otherwise null.'),
  replacement: { anyOf: [{ type: 'null' }, REPLACEMENT] },
  reason: str('Why this change, in athlete-friendly language.'),
}, 'One change to one workout.');

/** Tool definitions (stable order — part of the cached prompt prefix). */
export const TOOLS = [
  {
    name: 'get_athlete_profile',
    description: 'Athlete profile and settings: race + date, goal, current phase/week, weekly availability, time limits, equipment, which benchmarks (FTP/CSS/threshold) exist. Use when availability, equipment or goals matter.',
    input_schema: obj({}),
  },
  {
    name: 'get_schedule',
    description: 'The athlete\'s ACTUAL effective schedule (after approved changes) between two local dates, inclusive (max 28 days): workout ids, dates, titles, sport, intensity, priority (Key/Supporting/Optional), planned minutes, and status (scheduled / completed / modified / replaced / skipped / not-logged / cancelled-by-plan-change), plus moved/shortened/replaced flags. Use for any question about specific dates, "tomorrow", "this weekend", or before proposing any change.',
    input_schema: obj({ start_date: str('YYYY-MM-DD (athlete local date)'), end_date: str('YYYY-MM-DD (athlete local date)') }),
  },
  {
    name: 'get_weekly_schedule',
    description: 'The full Monday–Sunday training week containing a date: every session, the week\'s phase, type (build / recovery / test / peak / taper / race), focus, deload notes, and planned vs completed minutes by sport. Use to reason about the whole week before moving or skipping anything.',
    input_schema: obj({ date: str('Any YYYY-MM-DD inside the week') }),
  },
  {
    name: 'get_workout_details',
    description: 'Full prescription and purpose of one workout: objective, why it exists, warm-up/main set/cool-down, targets, priority, fueling, modification guidance (fatigue, weather, limited time), and any log (actual duration, RPE, notes).',
    input_schema: obj({ workout_id: str('Exact workout id') }),
  },
  {
    name: 'get_recent_training',
    description: 'Recent training history: sessions in the last N days with planned vs actual status, daily check-ins (sleep, fatigue, soreness, motivation, pain, symptoms), weekly completion, automated coaching flags, and recent approved plan changes. Use for fatigue, missed-workout and "how am I doing" questions.',
    input_schema: obj({ days: { type: 'integer', description: '1–28' } }),
  },
  {
    name: 'propose_skip_workout',
    description: 'Propose skipping (cancelling) one planned workout. Creates or REPLACES the single pending proposal shown to the athlete with Accept/Reject buttons. Nothing changes until they accept.',
    input_schema: obj({ workout_id: str('Exact workout id'), reason: str('Why') }),
  },
  {
    name: 'propose_reschedule_workout',
    description: 'Propose moving one workout to another date (optionally shortening it). Creates or REPLACES the pending proposal. The app validates conflicts (no two demanding bike/run sessions on one day, availability, weekly load, taper, past dates) and returns errors/warnings.',
    input_schema: obj({ workout_id: str('Exact workout id'), new_date: str('YYYY-MM-DD'), new_duration_min: nint('Optional shorter duration, else null'), reason: str('Why') }),
  },
  {
    name: 'propose_modify_workout',
    description: 'Propose shortening one workout to a new duration. Creates or REPLACES the pending proposal.',
    input_schema: obj({ workout_id: str('Exact workout id'), new_duration_min: { type: 'integer', description: 'New planned minutes (10 to original−1)' }, reason: str('Why') }),
  },
  {
    name: 'propose_replace_workout',
    description: 'Propose replacing one workout with a different session (e.g., easy spin instead of a run when sore). Creates or REPLACES the pending proposal.',
    input_schema: obj({ workout_id: str('Exact workout id'), replacement: REPLACEMENT, reason: str('Why') }),
  },
  {
    name: 'propose_weekly_adjustment',
    description: 'Propose several coordinated changes at once (travel, multi-day conflicts, weekend swaps). All changes are validated together on the final schedule and applied atomically if accepted. Creates or REPLACES the pending proposal.',
    input_schema: obj({ summary: str('One-line summary'), changes: { type: 'array', items: CHANGE, description: '1–14 changes' }, expected_impact: str('Effect on the week / preparation'), recovery_notes: str('Recovery considerations') }),
  },
  {
    name: 'propose_availability_update',
    description: 'Propose updating the athlete\'s weekly availability (e.g., "can\'t train Fridays anymore"). Requires approval like any change.',
    input_schema: obj({ changes: { type: 'array', items: obj({ day: { type: 'string', enum: DAYS }, available: { type: 'boolean' }, max_minutes: nint('Daily limit in minutes, or null') }) }, reason: str('Why') }),
  },
  {
    name: 'withdraw_pending_proposal',
    description: 'Withdraw the current pending proposal without changing the plan (e.g., the athlete says "never mind, keep it as planned").',
    input_schema: obj({ reason: str('Why') }),
  },
].map((t) => ({ ...t, strict: true }));

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export const SYSTEM_PROMPT = `You are the AI Coach inside "70.3 Dallas HQ", the personal training app of one amateur triathlete preparing for IRONMAN 70.3 Dallas–Little Elm (Sunday 2027-03-14; goal: under 5:15). You talk with the athlete like an experienced, warm endurance coach and help them adapt training to real life without sacrificing recovery.

What you know and how to find out more
- Each athlete message begins with an <app_snapshot> written by the app: their LOCAL date, weekday and time zone, a date table, race countdown, current phase, this week's and next week's sessions (ids, titles, minutes, status), the pending proposal if any, and events since your last reply (e.g. a proposal the athlete accepted or rejected). Snapshots are facts from the app; the athlete's words follow them.
- Use tools to read anything else: get_schedule, get_weekly_schedule, get_workout_details, get_recent_training, get_athlete_profile. Call them whenever a question depends on dates, specific workouts, history, availability or recovery — don't guess. Don't call tools for things already answered in the snapshot or conversation.
- Never invent workouts, ids, dates, results, metrics or completed sessions. If data is missing (e.g., no check-ins logged, no FTP yet), say so plainly and, if useful, ask.
- Resolve "today", "tomorrow", weekdays and dates with the snapshot's date table in the athlete's time zone. If a date or the referenced workout is genuinely ambiguous, ask a short question. Keep track of what "it", "that session" and "the swim" refer to from the conversation.

Conversation vs. changes
- Most messages are conversation: answer questions, explain training, review the week, discuss options. No tool call is needed to explain your own earlier reasoning ("why are you recommending that?") — answer from the conversation and the data you already looked at.
- When the athlete wants a change, first look at the whole week (get_weekly_schedule) and the workout's purpose, then call one propose_* tool. If they haven't said what they want (e.g., "I can't train tomorrow" — move or skip?), ask before proposing, briefly mentioning what's scheduled and what you'd consider.
- A propose_* call creates or REPLACES the single pending proposal; the app shows it with Accept / Reject buttons. You cannot apply changes. If the athlete changes their mind ("actually skip it instead", "I meant Saturday"), call a propose_* tool again to replace the pending proposal; never stack duplicates. If they no longer want a change, call withdraw_pending_proposal.
- The tool result tells you whether the app's validator accepted the proposal (errors) and any warnings. If it's invalid, explain the conflict in plain words and offer the best alternative (you may propose again). Mention important warnings honestly.
- After proposing, tell the athlete what you proposed and why, and that it will only change once they press Accept.

Coaching judgment
- Prefer a sustainable week over preserving every minute. Don't make up every missed session: missed easy/optional sessions are usually best skipped; key sessions (long ride, long run, race-specific work, tests) may be moved within the same week when a recovery-safe day exists. Never stack a moved session onto a day with another demanding bike/run session, avoid back-to-back hard leg days, protect the Monday rest day and recovery weeks, and add nothing demanding in the final 5 days before the race. Consider time to race day and the training phase.
- Fatigue, poor sleep, soreness or illness → reduce stress (easier, shorter or skipped sessions). Localized, sharp, worsening or persistent pain → avoid aggravating activity and suggest a sports-medicine professional; don't diagnose.
- If the athlete mentions chest pain, fainting, severe shortness of breath, an irregular or racing heart at rest, confusion or similar: tell them to stop exercising and seek urgent medical care (call emergency services if severe). Don't propose schedule changes in that reply.
- Nutrition: general, evidence-informed guidance only (e.g., 60–90 g carbohydrate per hour on long sessions); no supplement doses or extreme hydration advice. Don't change race-day plans unilaterally.
- Never guarantee race outcomes. Distinguish the athlete's actual logged data from estimates and plan targets. Be transparent about uncertainty.

Style
- Natural, concise and specific (usually 2–6 sentences; short lists only when they help). Refer to sessions by name and weekday + date (e.g., "Saturday Oct 10"). Don't repeat greetings or introduce yourself again mid-conversation. Plain text; light markdown (bold, short bullet lists) is fine.`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_MESSAGES = 120;
const BLOCK_TYPES = new Set(['text', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking']);

/** Validate the transcript the browser sends (Messages API format). */
export function validateRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) return { ok: false, error: `messages must contain 1–${MAX_MESSAGES} entries.` };
  for (const [i, m] of messages.entries()) {
    if (!m || !['user', 'assistant'].includes(m.role)) return { ok: false, error: `messages[${i}].role must be user or assistant.` };
    if (typeof m.content === 'string') {
      if (!m.content.trim()) return { ok: false, error: `messages[${i}] is empty.` };
      continue;
    }
    if (!Array.isArray(m.content) || !m.content.length) return { ok: false, error: `messages[${i}].content must be text or blocks.` };
    for (const b of m.content) {
      if (!b || !BLOCK_TYPES.has(b.type)) return { ok: false, error: `messages[${i}] contains an unsupported block.` };
      if (b.type === 'text' && (typeof b.text !== 'string' || b.text.length > 20000)) return { ok: false, error: `messages[${i}] text block invalid.` };
      if (b.type === 'tool_use' && !TOOL_NAMES.has(b.name)) return { ok: false, error: `Unknown tool "${b.name}".` };
      if ((b.type === 'tool_use' || b.type === 'thinking' || b.type === 'redacted_thinking') && m.role !== 'assistant') return { ok: false, error: `messages[${i}]: ${b.type} must be in an assistant turn.` };
      if (b.type === 'tool_result' && m.role !== 'user') return { ok: false, error: `messages[${i}]: tool_result must be in a user turn.` };
    }
  }
  if (messages[0].role !== 'user') return { ok: false, error: 'The first message must come from the athlete.' };
  if (messages[messages.length - 1].role !== 'user') return { ok: false, error: 'The last message must be an athlete message or tool results.' };
  if (body.timeZone != null && (typeof body.timeZone !== 'string' || body.timeZone.length > 64)) return { ok: false, error: 'timeZone invalid.' };
  if (body.localDate != null && !ISO.test(body.localDate)) return { ok: false, error: 'localDate must be YYYY-MM-DD.' };
  return { ok: true };
}

/** Keep only content blocks the browser knows how to replay; tool_use names must be known tools. */
export function sanitizeContent(content) {
  return (content || []).filter((b) => b && BLOCK_TYPES.has(b.type) && (b.type !== 'tool_use' || TOOL_NAMES.has(b.name)));
}
