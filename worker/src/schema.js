// Output contract for the AI Coach model + server-side validation + system prompt.
// The model has NO ability to change data: it can only return a proposal in this schema,
// which the server validates here and the browser validates again against the real plan.

export const INTENTS = ['skip', 'reschedule', 'shorten', 'replace', 'availability', 'recovery', 'weekly', 'priority', 'question', 'safety', 'pain', 'illness', 'missed', 'race_prep', 'review'];
export const ACTIONS = ['skip', 'move', 'shorten', 'replace'];
export const SPORTS = ['swim', 'bike', 'run', 'strength', 'mobility', 'other'];
export const INTENSITIES = ['easy', 'moderate', 'hard', 'long'];
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const nullable = (schema) => ({ anyOf: [{ type: 'null' }, schema] });

export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'intents', 'followUpQuestion', 'safetyLevel', 'proposal', 'availabilityUpdate'],
  properties: {
    message: { type: 'string', description: 'Concise, athlete-friendly reply explaining the reasoning.' },
    intents: { type: 'array', items: { type: 'string', enum: INTENTS } },
    followUpQuestion: { type: ['string', 'null'] },
    safetyLevel: { type: 'string', enum: ['none', 'caution', 'urgent'] },
    proposal: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'changes', 'expectedImpact', 'recoveryNotes'],
      properties: {
        summary: { type: 'string' },
        expectedImpact: { type: 'string' },
        recoveryNotes: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'workoutId', 'newDate', 'newDurationMin', 'replacement', 'reason'],
            properties: {
              action: { type: 'string', enum: ACTIONS },
              workoutId: { type: 'string', description: 'Exact id from context.sessions. Never invent ids.' },
              newDate: { type: ['string', 'null'], description: 'YYYY-MM-DD for move; otherwise null.' },
              newDurationMin: { type: ['integer', 'null'], description: 'For shorten, or optional shortened duration on a move.' },
              replacement: nullable({
                type: 'object',
                additionalProperties: false,
                required: ['title', 'sport', 'durationMin', 'intensity', 'description'],
                properties: {
                  title: { type: 'string' },
                  sport: { type: 'string', enum: SPORTS },
                  durationMin: { type: 'integer' },
                  intensity: { type: 'string', enum: INTENSITIES },
                  description: { type: 'string' },
                },
              }),
              reason: { type: 'string' },
            },
          },
        },
      },
    }),
    availabilityUpdate: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['changes', 'reason'],
      properties: {
        reason: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['day', 'available', 'maxMinutes'],
            properties: { day: { type: 'string', enum: DAYS }, available: { type: 'boolean' }, maxMinutes: { type: ['integer', 'null'] } },
          },
        },
      },
    }),
  },
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

/** Validate the incoming browser request. Returns { ok, error }. */
export function validateRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  const { messages, context } = body;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 16) return { ok: false, error: 'messages must contain 1–16 turns.' };
  for (const m of messages) {
    if (!m || !['user', 'assistant'].includes(m.role) || !isStr(m.text, 4000) || !m.text.trim()) return { ok: false, error: 'Each message needs a role (user/assistant) and 1–4000 characters of text.' };
  }
  if (messages[messages.length - 1].role !== 'user') return { ok: false, error: 'The last message must come from the athlete.' };
  if (!context || typeof context !== 'object') return { ok: false, error: 'context is required.' };
  if (!ISO.test(context.today || '')) return { ok: false, error: 'context.today must be YYYY-MM-DD (athlete local date).' };
  if (!Array.isArray(context.sessions) || context.sessions.length > 150) return { ok: false, error: 'context.sessions must be an array (≤150).' };
  for (const s of context.sessions) if (!s || !isStr(s.id, 40) || !ISO.test(s.date || '')) return { ok: false, error: 'Each session needs an id and date.' };
  return { ok: true };
}

/**
 * Validate model output against the schema AND the provided context.
 * Returns { ok, errors, value } — value has proposal set to null if it referenced unknown ids.
 */
export function validateOutput(out, context) {
  const errors = [];
  if (!out || typeof out !== 'object') return { ok: false, errors: ['Output is not an object.'] };
  if (!isStr(out.message, 6000) || !out.message.trim()) errors.push('message missing');
  if (!Array.isArray(out.intents) || out.intents.some((i) => !INTENTS.includes(i))) errors.push('intents invalid');
  if (!(out.followUpQuestion === null || isStr(out.followUpQuestion, 500))) errors.push('followUpQuestion invalid');
  if (!['none', 'caution', 'urgent'].includes(out.safetyLevel)) errors.push('safetyLevel invalid');
  const value = { ...out };
  const ids = new Set((context?.sessions || []).map((s) => s.id));
  const notes = [];
  if (out.proposal !== null) {
    const p = out.proposal;
    if (!p || typeof p !== 'object' || !Array.isArray(p.changes) || !isStr(p.summary, 400) || !isStr(p.expectedImpact, 1000) || !isStr(p.recoveryNotes, 1000)) errors.push('proposal invalid');
    else {
      if (p.changes.length > 14) errors.push('too many changes');
      for (const c of p.changes) {
        if (!c || !ACTIONS.includes(c.action) || !isStr(c.workoutId, 40) || !isStr(c.reason, 600)) { errors.push('change invalid'); continue; }
        if (!(c.newDate === null || (typeof c.newDate === 'string' && ISO.test(c.newDate)))) errors.push('newDate invalid');
        if (!(c.newDurationMin === null || Number.isInteger(c.newDurationMin))) errors.push('newDurationMin invalid');
        if (c.action === 'move' && !c.newDate) errors.push('move without newDate');
        if (c.action === 'shorten' && !Number.isInteger(c.newDurationMin)) errors.push('shorten without newDurationMin');
        if (c.action === 'replace') {
          const r = c.replacement;
          if (!r || !isStr(r.title, 80) || !SPORTS.includes(r.sport) || !INTENSITIES.includes(r.intensity) || !Number.isInteger(r.durationMin) || !isStr(r.description, 600)) errors.push('replacement invalid');
        }
        if (!ids.has(c.workoutId)) notes.push(`unknown workout id ${c.workoutId}`);
      }
      if (!errors.length && notes.length) {
        value.proposal = null;
        value.message = `${out.message}\n\n(The proposed change referenced a workout that isn't in your plan, so it was withheld. Please rephrase or name the session.)`;
      }
    }
  }
  if (out.availabilityUpdate !== null) {
    const a = out.availabilityUpdate;
    if (!a || !Array.isArray(a.changes) || !isStr(a.reason, 600) || a.changes.some((d) => !DAYS.includes(d?.day) || typeof d.available !== 'boolean' || !(d.maxMinutes === null || (Number.isInteger(d.maxMinutes) && d.maxMinutes >= 0 && d.maxMinutes <= 600)))) errors.push('availabilityUpdate invalid');
  }
  if (out.safetyLevel === 'urgent') value.proposal = null; // never rearrange training around serious symptoms
  return { ok: errors.length === 0, errors, value, notes };
}

export const SYSTEM_PROMPT = `You are the AI Coach inside "70.3 Dallas HQ", a training app for one amateur triathlete preparing for IRONMAN 70.3 Dallas–Little Elm on 2027-03-14 with a sub-5:15 goal. You help the athlete adapt the plan to real life without sacrificing recovery.

How you work:
- Each request includes <training_context> JSON from the app: the athlete's LOCAL date ("today"), time zone, a date table, race info, training phase, the effective sessions for last week, this week and next week (each with an exact "id", date, title, sport, intensity, priority, duration, and status), availability, recent check-ins and coaching flags, and any proposal awaiting approval. Treat it as the only source of facts about the plan. Never invent workouts, ids, completed sessions, metrics or results. If something is not in the context, say you don't have it.
- Resolve relative dates ("tomorrow", "Friday", "next week") with the date table — never in UTC. If a date is genuinely ambiguous, ask.
- Classify the request (intents). If an essential detail is missing — e.g. "I can't train tomorrow" without saying whether to move or skip — ask one concise follow-up question (followUpQuestion) and do not propose yet. Don't ask for information already in the context or conversation.
- When a schedule change helps, return a proposal. You cannot change anything yourself: the athlete must approve, and the app validates every change. Use only ids from context.sessions. Actions: "skip" (cancel a planned session), "move" (newDate; optional newDurationMin to also shorten), "shorten" (newDurationMin), "replace" (replacement session). Every change needs a short reason.
- Reason about the whole week, not just the named session: the purpose and priority of each session, recovery between demanding sessions, the long weekend sessions, taper, and the athlete's availability.

Coaching principles:
- Prefer a sustainable schedule over preserving volume. Do not make up every missed session; often the right answer is to skip it. Never stack a moved session onto a day that already has a demanding bike/run session, never create back-to-back hard leg days on weekdays, keep Monday rest days when possible, and never add load to the final 5 days before the race.
- Key sessions matter more than supporting or optional ones. Moving a key session within the same week is reasonable when a recovery-safe day exists; otherwise skip it and explain the trade-off.
- For multi-day conflicts (travel), keep the most important race-specific sessions where they fit and skip lower-priority work instead of compressing the week.
- Fatigue, poor sleep, soreness or illness → reduce stress (easier or skipped sessions). Pain → avoid aggravating activity and suggest qualified sports-medicine advice if it is localized, sharp, worsening or persistent; do not diagnose.
- If the athlete reports chest pain, fainting, severe shortness of breath, irregular heartbeat, confusion or similar: set safetyLevel "urgent", tell them to stop exercising and seek urgent medical care, and return no proposal.
- Availability changes ("I can't train Fridays anymore") go in availabilityUpdate (day, available, maxMinutes) and also require approval.
- Nutrition guidance must be general and evidence-informed (e.g., carbohydrate 60–90 g/h on long sessions, protein spread across the day); no supplement doses or unsafe hydration advice. Don't change race-day fueling plans — suggest, and let the athlete decide.
- Never guarantee race outcomes. A skipped session does not necessarily change a race prediction; distinguish estimates from measured results.

Style: plain, warm, concise (usually 2–6 sentences), like an experienced endurance coach. Explain the why in athlete-friendly language. Mention dates as weekday + date. Respond only in the required JSON format.`;

/** Assemble Messages API turns: transcript + context attached to the latest athlete turn. */
export function buildMessages(messages, context) {
  const turns = messages.map((m) => ({ role: m.role, content: m.text }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const last = turns[turns.length - 1];
  last.content = `<training_context>\n${JSON.stringify(context)}\n</training_context>\n\n${last.content}`;
  return turns;
}
