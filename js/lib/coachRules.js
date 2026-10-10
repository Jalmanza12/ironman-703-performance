// Deterministic coaching helpers shared by the AI Coach UI:
//  - classifyIntent(): request categories (also used to tag AI requests)
//  - detectRedFlags(): symptoms that must short-circuit schedule changes
//  - resolveDate()/resolveRange(): relative dates in the athlete's LOCAL calendar
//  - planOffline(): a rules-based planner used when the AI backend is not configured or is
//    unavailable. Its replies are ALWAYS labeled "Rules-based planner — not AI".
// All proposals it creates go through the same validateProposal()/applyProposal() path.

import { addDays, dayOfWeek, mondayOf, isISODate, formatShort, diffDays, DOW } from './dates.js';
import { effectiveSession, effectiveSessionsOn, validateProposal, isDemandingLeg, DAYS } from './adjustments.js';
import { DONE } from './load.js';

export const INTENTS = ['skip', 'reschedule', 'shorten', 'replace', 'availability', 'recovery', 'weekly', 'priority', 'question', 'safety', 'pain', 'illness', 'missed', 'race_prep', 'review'];

const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const WD_RE = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)s?';

const RED_FLAGS = [
  [/chest (pain|tightness|pressure)/i, 'chest pain or pressure'],
  [/\b(faint(ed|ing)?|passed out|blacked out|collapse[d]?)\b/i, 'fainting or collapse'],
  [/(severe|can'?t catch my|cannot catch my|struggling to) breath|short(ness)? of breath at rest|can'?t breathe/i, 'severe shortness of breath'],
  [/\b(palpitations|heart (is |was |keeps )?(racing|pounding|skipping|fluttering)|irregular heart ?beat)\b/i, 'heart rhythm symptoms'],
  [/\b(dizz(y|iness)|lightheaded|light-headed)\b/i, 'dizziness'],
  [/\bconfus(ed|ion)\b|\bslurred\b/i, 'confusion'],
];

export function detectRedFlags(text = '') {
  return RED_FLAGS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

export function classifyIntent(text = '') {
  const t = text.toLowerCase();
  const out = new Set();
  if (detectRedFlags(text).length) out.add('safety');
  if (/\b(pain|painful|hurts?|hurting|injur(y|ed)|tweak(ed)?|strain(ed)?|sprain(ed)?|swollen|swelling|shin splints?|achilles|plantar)\b/.test(t)) out.add('pain');
  if (/\b(sick|ill|illness|fever|flu|covid|cold|sore throat|congest(ed|ion))\b/.test(t) && !/\bcold (water|weather|morning)\b/.test(t)) out.add('illness');
  if (/\b(exhausted|tired|fatigue[d]?|wiped|burn(ed|t)? out|no energy|drained|slept (badly|poorly)|bad sleep|rest day|need (a )?rest|sore|soreness|heavy legs|legs are (dead|heavy|sore))\b/.test(t)) out.add('recovery');
  if (/\b(missed|didn'?t (do|get to|make)|skipped)\b/.test(t)) out.add('missed');
  if (/\b(can'?t|cannot|can not|won'?t be able|unable|no time|not able)\b.*\b(train|run|ride|bike|swim|lift|workout|session|make it|do)\b|\bskip\b|\bcancel\b|\bdrop\b/.test(t)) out.add('skip');
  if (/\b(move|reschedul\w*|swap|switch|shift|push|instead on|do it on|change .* to|on (sunday|monday|tuesday|wednesday|thursday|friday|saturday) instead|adjust|rearrange|work around|fit (it|this) in)\b/.test(t)) out.add('reschedule');
  if (/\bonly (have|got)\b.*\b(\d+)\s*(min|minutes|mins|hour|hours|hr|hrs|h)\b|\b(\d+)\s*(min|minutes|mins)\b.*\bonly\b|\bshort(en|er)?\b|\bshort on time\b|\blimited time\b/.test(t)) out.add('shorten');
  if (/\breplace\b|\binstead of\b|\bindoors?\b.*\binstead\b|\btrainer instead\b|\btreadmill instead\b/.test(t)) out.add('replace');
  if (/\b(no longer|can'?t anymore|not available|available on|availability|free on|can only train)\b.*\b(day|days|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|evenings?|mornings?)\b/.test(t)) out.add('availability');
  if (/\b(travel(l?ing)?|trip|away|vacation|out of town|conference|business trip)\b|\b(through|thru|until|to)\b\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\bnext week\b.*\b(only|can)\b|\bthis week\b.*\b(only|can)\b/.test(t)) out.add('weekly');
  if (/\b(prioriti[sz]e|focus (on|more)|improve my|weakness|limiter)\b/.test(t)) out.add('priority');
  if (/\b(race day|race week|taper|race morning|race plan|pacing plan)\b/.test(t)) out.add('race_prep');
  if (/\b(review|how am i doing|progress|recent training|on track)\b/.test(t)) out.add('review');
  if (!out.size) out.add('question');
  return [...out];
}

/** Resolve the first date reference in text relative to the athlete's local `today`. */
export function resolveDate(text, today, { preferPast = false } = {}) {
  const t = text.toLowerCase();
  if (/\bday after tomorrow\b/.test(t)) return { date: addDays(today, 2), label: 'the day after tomorrow' };
  if (/\btomorrow\b/.test(t)) return { date: addDays(today, 1), label: 'tomorrow' };
  if (/\byesterday\b/.test(t)) return { date: addDays(today, -1), label: 'yesterday' };
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) return { date: today, label: 'today' };
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isISODate(iso[1])) return { date: iso[1], label: iso[1] };
  const md = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md) return monthDay(Number(md[1]) - 1, Number(md[2]), today);
  const mn = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/);
  if (mn) return monthDay(MONTHS[mn[1]], Number(mn[2]), today);
  const wd = t.match(new RegExp(`\\b(next|this|last|coming)?\\s*${WD_RE}\\b`));
  if (wd) {
    const target = WEEKDAYS[wd[2].replace(/s$/, '')] ?? WEEKDAYS[wd[2]];
    if (target == null) return null;
    const cur = dayOfWeek(today);
    if (wd[1] === 'next') {
      // "next Friday" = Friday of next week (Mon-based weeks)
      const nextMon = addDays(mondayOf(today), 7);
      return { date: addDays(nextMon, (target + 6) % 7), label: `next ${DOW[target]}` };
    }
    if (wd[1] === 'last' || (preferPast && wd[1] !== 'this' && wd[1] !== 'coming')) {
      const back = (cur - target + 7) % 7;
      return { date: addDays(today, -(back === 0 && wd[1] === 'last' ? 7 : back)), label: `${wd[1] === 'last' ? 'last ' : ''}${DOW[target]}` };
    }
    const fwd = (target - cur + 7) % 7;
    return { date: addDays(today, fwd), label: fwd === 0 ? `today (${DOW[target]})` : DOW[target], ambiguousToday: fwd === 0 && !wd[1] };
  }
  return null;
}

function monthDay(m, d, today) {
  const y = Number(today.slice(0, 4));
  for (const yy of [y, y + 1]) {
    const iso = `${yy}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isISODate(iso) && diffDays(today, iso) >= -60) return { date: iso, label: formatShort(iso) };
  }
  return null;
}

/** Resolve a date range like "Monday through Wednesday next week" or "next week". */
export function resolveRange(text, today) {
  const t = text.toLowerCase();
  const nextWeek = /\bnext week\b/.test(t);
  const base = nextWeek ? addDays(mondayOf(today), 7) : mondayOf(today);
  const m = t.match(new RegExp(`${WD_RE}\\s*(?:-|–|to|through|thru|until|till)\\s*${WD_RE}`));
  if (m) {
    const a = WEEKDAYS[m[1].replace(/s$/, '')] ?? WEEKDAYS[m[1]];
    const b = WEEKDAYS[m[2].replace(/s$/, '')] ?? WEEKDAYS[m[2]];
    let start = addDays(base, (a + 6) % 7);
    let end = addDays(base, (b + 6) % 7);
    if (!nextWeek && end < today) { start = addDays(start, 7); end = addDays(end, 7); }
    if (end < start) end = addDays(end, 7);
    return { start, end, label: `${formatShort(start)} – ${formatShort(end)}` };
  }
  return null;
}

/** "I can only train Thursday, Friday, Saturday and Sunday" → set of weekday numbers. */
export function parseOnlyDays(text) {
  const t = text.toLowerCase();
  const m = t.match(/\bonly (?:train|be able to train|available|free)(?: on)?\s+([a-z ,&]+)/);
  if (!m) return null;
  const days = [...m[1].matchAll(new RegExp(WD_RE, 'g'))].map((x) => WEEKDAYS[x[1].replace(/s$/, '')] ?? WEEKDAYS[x[1]]).filter((x) => x != null);
  return days.length ? new Set(days) : null;
}

export function parseMinutes(text) {
  const t = text.toLowerCase();
  const h = t.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/);
  const m = t.match(/(\d+)\s*(minutes?|mins?|min)\b/);
  let total = 0;
  if (h) total += Math.round(Number(h[1]) * 60);
  if (m) total += Number(m[1]);
  return total || null;
}

const SPORT_WORDS = [
  ['run', /\b(run|running|jog|long run|brick run)\b/],
  ['bike', /\b(bike|ride|riding|cycling|cycle|trainer)\b/],
  ['swim', /\b(swim|swimming|pool)\b/],
  ['strength', /\b(lift|lifting|strength|gym|weights)\b/],
];
export function sportsMentioned(text) {
  return SPORT_WORDS.filter(([, re]) => re.test(text.toLowerCase())).map(([s]) => s);
}

/** Session filter from the athlete's words ("long run", "long ride", "brick", "swim"...). */
export function sessionMatcher(text) {
  const t = text.toLowerCase();
  if (/\blong run\b/.test(t)) return (s) => s.sport === 'run' && s.intensity === 'long';
  if (/\blong (ride|bike)\b/.test(t)) return (s) => s.sport === 'bike' && s.intensity === 'long';
  if (/\bbrick\b/.test(t) && !/\bafter\b.*\bbrick\b/.test(t)) return (s) => !!s.brick || (s.sport === 'bike' && s.intensity === 'long');
  if (/\b(intervals?|quality|hard (session|workout))\b/.test(t)) return (s) => s.intensity === 'hard';
  const sports = sportsMentioned(text);
  return sports.length ? (s) => sports.includes(s.sport) : null;
}

// ---------------- Offline planner ----------------

function open(s, state) {
  return s && !s.cancelled && s.sport !== 'rest' && s.sport !== 'race' && !DONE.has(state.logs?.[s.id]?.status) && state.logs?.[s.id]?.status !== 'skipped';
}

/** Best recovery-safe day in the session's training week (or null). */
export function bestSlot(plan, state, session, { today, exclude = new Set(), extraChanges = [] } = {}) {
  const wkStart = mondayOf(session.originalDate || session.date);
  let best = null;
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(wkStart, i);
    if (d < today || d === session.date || exclude.has(d)) continue;
    const proposal = { changes: [...extraChanges, { action: 'move', workoutId: session.id, newDate: d }] };
    const v = validateProposal(plan, state, proposal, { today });
    if (!v.ok) continue;
    const mins = effectiveSessionsOn(plan, state, d).filter((x) => !x.cancelled).reduce((a, x) => a + (x.durationMin || 0), 0);
    const sameSport = effectiveSessionsOn(plan, state, d).some((x) => !x.cancelled && x.sport === session.sport);
    // Consider the weekend: a leg session the day before a long ride/run costs some freshness.
    const beforeLong = ['bike', 'run'].includes(session.sport) && effectiveSessionsOn(plan, state, addDays(d, 1)).some((x) => !x.cancelled && x.intensity === 'long');
    const score = v.warnings.length * 100 + mins + (sameSport ? 80 : 0) + (beforeLong ? 30 : 0) + Math.abs(diffDays(session.date, d)) * 5;
    if (!best || score < best.score) best = { date: d, score, warnings: v.warnings };
  }
  return best;
}

function describe(s) {
  return `${s.title} (${formatShort(s.date)}, ${s.durationMin} min)`;
}

function result(message, extra = {}) {
  return { mode: 'rules', message, intents: extra.intents || [], followUpQuestion: extra.followUpQuestion || null, safetyLevel: extra.safetyLevel || 'none', proposal: extra.proposal || null, availabilityUpdate: extra.availabilityUpdate || null, pending: extra.pending || null };
}

/**
 * Rules-based planner. `conv.pending` carries a follow-up question (e.g. move-or-skip);
 * `conv.activeProposal` lets "actually only 25 minutes" refine the pending proposal.
 */
export function planOffline(text, { plan, state, today }, conv = {}) {
  const intents = classifyIntent(text);
  const flags = detectRedFlags(text);
  if (flags.length) {
    return result(`Stop exercising now. You mentioned ${flags.join(' and ')} — that needs prompt medical evaluation, not a schedule change. If symptoms are severe, ongoing, or include chest pain or fainting, call emergency services (911 in the US). I won't adjust your plan until you've been cleared; we can rebuild the week afterwards.`, { intents, safetyLevel: 'urgent' });
  }
  const t = text.toLowerCase();
  const pending = conv.pending;
  const active = conv.activeProposal;

  // Follow-up to a move-or-skip question.
  if (pending?.type === 'move_or_skip') {
    const ids = pending.workoutIds.filter((id) => open(effectiveSession(plan, state, id), state));
    if (/\bskip\b|\bdrop\b|\bforget\b|\bjust skip\b/.test(t) && !/\bmove\b/.test(t)) return skipProposal(plan, state, ids, today, intents);
    const d = resolveDate(text, today);
    const mins = parseMinutes(text);
    if (d || /\bmove\b|\breschedul/.test(t)) return moveProposal(plan, state, ids, d?.date, today, intents, mins, '', { mustMove: true });
  }
  // Refining an active proposal ("actually I only have 25 minutes Friday").
  if (active && /\b(actually|instead|only|change (that|it)|make it)\b/.test(t) && (parseMinutes(text) || resolveDate(text, today))) {
    const mins = parseMinutes(text);
    const d = resolveDate(text, today);
    const ids = active.changes.map((c) => c.workoutId);
    const moving = active.changes.filter((c) => c.action === 'move');
    if (moving.length) return moveProposal(plan, state, ids, d?.date || moving[0].newDate, today, intents, mins, 'Updated proposal', { mustMove: true });
    if (mins) return shortenProposal(plan, state, ids, mins, today, intents);
  }

  if (intents.includes('pain')) return painProposal(plan, state, today, intents);
  if (intents.includes('illness')) return illnessProposal(plan, state, today, intents);

  if (intents.includes('availability') && !intents.includes('weekly')) {
    const av = parseAvailability(text);
    if (av) return result(`I can update your weekly availability: ${av.changes.map((c) => `${c.day.toUpperCase()} ${c.available ? 'available' : 'unavailable'}`).join(', ')}. After that, any move onto an unavailable day is blocked. Want me to also rearrange the next sessions that fall on those days? Ask "adjust next week for my new availability".`, { intents, availabilityUpdate: { ...av, reason: 'Athlete-reported change in availability.' } });
  }

  if (intents.includes('weekly')) {
    const range = resolveRange(text, today);
    const only = parseOnlyDays(text);
    if (range || only) return weeklyProposal(plan, state, today, intents, range, only, text);
  }

  if (intents.includes('recovery') && !intents.includes('reschedule')) return fatigueProposal(plan, state, today, intents, text);

  if (intents.includes('shorten')) {
    const mins = parseMinutes(text);
    const d = resolveDate(text, today) || { date: today, label: 'today' };
    if (mins) {
      const ids = effectiveSessionsOn(plan, state, d.date).filter((s) => open(s, state)).map((s) => s.id);
      if (!ids.length) return result(`There's nothing left to train on ${formatShort(d.date)}, so no change is needed.`, { intents });
      return shortenProposal(plan, state, ids, mins, today, intents);
    }
  }

  if (intents.some((i) => ['skip', 'missed', 'reschedule'].includes(i))) {
    const missed = intents.includes('missed');
    const d = resolveDate(text, today, { preferPast: missed });
    const sports = sportsMentioned(text);
    const match = sessionMatcher(text);
    const moveTo = (() => {
      const m = t.match(new RegExp(`\\b(?:to|on|until|for)\\s+(?:next |this )?${WD_RE}\\b`));
      if (!m || !intents.includes('reschedule')) return null;
      const r = resolveDate(m[0].replace(/^(to|on|until|for)\s+/, ''), today);
      return r?.date;
    })();
    let date = d?.date;
    if (moveTo && d && d.date === moveTo) date = null; // the only date is the destination
    if (!date) date = missed ? today : null;
    if (!date && match) {
      // "Can you move my long run" with no date → next upcoming matching session.
      const upcoming = upcomingSessions(plan, state, today, 8).find(match);
      if (upcoming) date = upcoming.date;
    }
    if (!date) return result('Which day are you referring to? (e.g., "tomorrow", "Wednesday", or a date)', { intents, followUpQuestion: 'Which day?' });
    let sessions = effectiveSessionsOn(plan, state, date).filter((s) => s.sport !== 'rest');
    if (match) sessions = sessions.filter(match);
    if (missed && !sessions.length && !d) {
      const y = addDays(today, -1);
      sessions = effectiveSessionsOn(plan, state, y).filter((s) => s.sport !== 'rest' && (!match || match(s)));
      date = y;
    }
    const done = sessions.filter((s) => DONE.has(state.logs?.[s.id]?.status));
    if (done.length && done.length === sessions.length) return result(`${done.map(describe).join(', ')} is already logged as ${state.logs[done[0].id].status}. Completed history is never changed, so there's nothing to adjust.`, { intents });
    sessions = sessions.filter((s) => open(s, state) || (missed && !state.logs?.[s.id]));
    if (!sessions.length) return result(`No ${sports.length ? `${sports.join('/')} ` : ''}session was scheduled on ${formatShort(date)}, so there's nothing to make up or move.`, { intents });
    if (sessions.some((s) => s.sport === 'race')) return result('That is race day — it cannot be rescheduled here.', { intents });
    const ids = sessions.map((s) => s.id);
    if (intents.includes('reschedule') || moveTo) return moveProposal(plan, state, ids, moveTo, today, intents, parseMinutes(text), '', { mustMove: intents.includes('skip') || intents.includes('missed') });
    if (missed) return missedProposal(plan, state, ids, today, intents);
    if (/\b(skip|cancel|drop)\b/.test(t)) return skipProposal(plan, state, ids, today, intents, 'You asked to skip it; nothing is added elsewhere.');
    // "I can't train tomorrow" → ask move or skip (essential detail missing).
    const list = sessions.map(describe).join(' and ');
    return result(`You have ${list}. Would you like to move ${sessions.length > 1 ? 'them' : 'it'} to another day or skip ${sessions.length > 1 ? 'them' : 'it'}? (Reply e.g. "move it to Friday" or "skip it".)`, { intents, followUpQuestion: 'Move or skip?', pending: { type: 'move_or_skip', workoutIds: ids } });
  }

  return informational(plan, state, today, intents);
}

function upcomingSessions(plan, state, today, days) {
  const out = [];
  for (let i = 0; i < days; i += 1) out.push(...effectiveSessionsOn(plan, state, addDays(today, i)).filter((s) => open(s, state)));
  return out;
}

function proposal(summary, changes, expectedImpact, recoveryNotes = '') {
  return { summary, changes, expectedImpact, recoveryNotes };
}

function skipProposal(plan, state, ids, today, intents, why = 'Low enough priority that skipping protects recovery and the next quality session.') {
  const ss = ids.map((id) => effectiveSession(plan, state, id));
  const key = ss.filter((s) => s.priority?.startsWith('Key'));
  return result(`OK — I recommend skipping ${ss.map(describe).join(' and ')} rather than cramming ${ss.length > 1 ? 'them' : 'it'} into other days.${key.length ? ' One is a key session; one missed key session does not change your fitness — consistency over weeks does.' : ''}`, {
    intents, proposal: proposal(`Skip ${ss.length} session${ss.length > 1 ? 's' : ''}`, ss.map((s) => ({ action: 'skip', workoutId: s.id, reason: why })), 'Weekly volume drops slightly; no compensatory training is added.', 'Use the free time for sleep or an easy walk.'),
  });
}

/** Weekend swap: long ride (+ its brick) ⇄ long run, judged on the final schedule. */
function swapProposal(plan, state, s, toDate, today) {
  const isLong = (x) => !x.cancelled && x.intensity === 'long';
  const target = effectiveSessionsOn(plan, state, toDate).filter((x) => open(x, state));
  const source = effectiveSessionsOn(plan, state, s.date).filter((x) => open(x, state));
  if (!isLong(s) || !target.some(isLong)) return null;
  const moveSrc = s.sport === 'bike' ? source.filter((x) => x.id === s.id || x.brick) : [s];
  const moveTgt = target.filter((x) => isLong(x) || x.brick);
  const changes = [
    ...moveSrc.map((x) => ({ action: 'move', workoutId: x.id, newDate: toDate, reason: `Swap the weekend: ${x.title} moves to ${DOW[dayOfWeek(toDate)]} as requested.` })),
    ...moveTgt.map((x) => ({ action: 'move', workoutId: x.id, newDate: s.date, reason: `Swaps to ${DOW[dayOfWeek(s.date)]} so the two long sessions stay on separate days.` })),
  ];
  const v = validateProposal(plan, state, { changes }, { today });
  return v.ok ? changes : null;
}

function moveProposal(plan, state, ids, toDate, today, intents, minutes = null, prefix = '', { mustMove = false } = {}) {
  const changes = [];
  const notes = [];
  const kept = [];
  const skips = [];
  for (const id of ids) {
    const s = effectiveSession(plan, state, id);
    let dest = toDate;
    let why = '';
    const shorten = minutes && minutes < s.durationMin ? { newDurationMin: Math.max(10, minutes) } : {};
    if (dest) {
      const v = validateProposal(plan, state, { changes: [...changes, { action: 'move', workoutId: id, newDate: dest, ...shorten }] }, { today });
      if (!v.ok) {
        const swap = !shorten.newDurationMin && swapProposal(plan, state, s, dest, today);
        if (swap) {
          changes.push(...swap);
          notes.push(`${DOW[dayOfWeek(dest)]} already has your other long session, so I suggest swapping the weekend rather than stacking them.`);
          continue;
        }
        notes.push(`${DOW[dayOfWeek(dest)]} doesn't work for ${s.title}: ${v.errors[0].replace(/^.*?: /, '')}`);
        if (!mustMove) { kept.push(s); continue; }
        const alt = bestSlot(plan, state, s, { today, extraChanges: changes });
        dest = alt?.date || null;
        why = alt ? `Moved to the nearest recovery-safe day instead of ${formatShort(toDate)}.` : '';
      } else why = `Moved to ${DOW[dayOfWeek(dest)]} as requested; it does not stack on another demanding session.`;
    } else {
      const alt = bestSlot(plan, state, s, { today, extraChanges: changes });
      dest = alt?.date || null;
      if (alt) why = `${DOW[dayOfWeek(dest)]} is the lightest day this week that doesn't create back-to-back hard sessions.`;
    }
    if (dest) changes.push({ action: 'move', workoutId: id, newDate: dest, ...shorten, reason: why || 'Rescheduled within the same training week.' });
    else skips.push(s);
  }
  for (const s of skips) changes.push({ action: 'skip', workoutId: s.id, reason: 'No recovery-safe day left this week; skipping is better than stacking.' });
  if (!changes.length) return result(`${notes.join(' ')} I'd keep ${kept.map((s) => s.title).join(', ') || 'it'} where ${kept.length > 1 ? 'they are' : 'it is'}.`.trim(), { intents });
  const v = validateProposal(plan, state, { changes }, { today });
  const moved = changes.filter((c) => c.action === 'move');
  const msg = [prefix ? `${prefix}:` : '', notes.join(' '),
    moved.length ? `I suggest moving ${moved.map((c) => `${effectiveSession(plan, state, c.workoutId).title} to ${formatShort(c.newDate)}${c.newDurationMin ? ` (shortened to ${c.newDurationMin} min)` : ''}`).join('; ')}.` : '',
    skips.length ? `${skips.map((s) => s.title).join(', ')} should be skipped — there's no day this week that fits without stacking hard sessions.` : '',
    kept.length ? `${kept.map((s) => s.title).join(', ')} stays where it is.` : '',
    v.warnings.length ? `Trade-off to know: ${v.warnings[0].replace(/^.*?: /, '')}` : ''].filter(Boolean).join(' ');
  return result(msg, { intents, proposal: proposal(prefix || 'Reschedule within the week', changes, 'Weekly volume is preserved where it fits safely; nothing is stacked onto a demanding day.', 'Keep the session at the planned intensity; if the new day feels heavy, run it easy.') });
}

function missedProposal(plan, state, ids, today, intents) {
  const out = [];
  for (const id of ids) {
    const s = effectiveSession(plan, state, id);
    if (s.priority?.startsWith('Key')) {
      const alt = bestSlot(plan, state, s, { today, extraChanges: out });
      if (alt) { out.push({ action: 'move', workoutId: id, newDate: alt.date, reason: `Key session; ${DOW[dayOfWeek(alt.date)]} fits without stacking demanding sessions.` }); continue; }
    }
    out.push({ action: 'skip', workoutId: id, reason: s.priority?.startsWith('Key') ? 'No recovery-safe make-up day remains this week.' : 'Not a key session — making it up would add fatigue for little benefit.' });
  }
  const moved = out.filter((c) => c.action === 'move');
  const vw = validateProposal(plan, state, { changes: out }, { today }).warnings;
  return result(`${moved.length ? `Make up ${moved.map((c) => `${effectiveSession(plan, state, c.workoutId).title} on ${DOW[dayOfWeek(c.newDate)]}`).join(', ')}.` : 'Let it go — don\'t make it up.'} ${out.some((c) => c.action === 'skip') ? 'Missed non-key sessions are simply marked skipped in the plan; adding them elsewhere would just add fatigue.' : ''}${vw.length ? ` Trade-off: ${vw[0].replace(/^.*?: /, '')}` : ''}`.trim(), { intents, proposal: proposal('Handle missed session', out, 'No extra volume is added to the rest of the week.') });
}

function shortenProposal(plan, state, ids, minutes, today, intents) {
  const ss = ids.map((id) => effectiveSession(plan, state, id)).filter((s) => open(s, state));
  const total = ss.reduce((a, s) => a + (s.durationMin || 0), 0);
  if (total <= minutes) return result(`Good news: everything planned (${total} min) already fits in ${minutes} minutes. No change needed.`, { intents });
  const ranked = [...ss].sort((a, b) => (b.priority?.startsWith('Key') ? 1 : 0) - (a.priority?.startsWith('Key') ? 1 : 0) || (b.plannedRPE || 0) - (a.plannedRPE || 0));
  const keep = ranked[0];
  const changes = [];
  if (minutes >= 20) {
    if (keep.durationMin > minutes) changes.push({ action: 'shorten', workoutId: keep.id, newDurationMin: minutes, reason: `Keep the most important session and fit it into ${minutes} min: shorter warm-up, roughly two-thirds of the main set, brief cool-down.` });
    for (const s of ranked.slice(1)) changes.push({ action: 'skip', workoutId: s.id, reason: 'Lower priority than the main session today.' });
  } else for (const s of ranked) changes.push({ action: 'skip', workoutId: s.id, reason: `${minutes} min is too short for a meaningful version; a 10–15 min walk or mobility is fine.` });
  return result(`With ${minutes} minutes, ${minutes >= 20 ? `prioritise ${keep.title}` : 'skip today'}${minutes >= 20 && keep.durationMin > minutes ? ` in a ${minutes}-minute version (follow the session's "Limited time" modification)` : ''}${ranked.length > 1 && minutes >= 20 ? ` and skip ${ranked.slice(1).map((s) => s.title).join(', ')}` : ''}.`, { intents, proposal: proposal(`Fit today into ${minutes} min`, changes, 'Slightly less volume today; no make-up session is added.') });
}

function fatigueProposal(plan, state, today, intents, text) {
  const next = upcomingSessions(plan, state, today, 2);
  const target = next.find(isDemandingLeg) || next.find((s) => s.intensity === 'hard');
  const recent = Object.entries(state.daily || {}).filter(([d]) => d <= today && d > addDays(today, -4)).map(([, v]) => v);
  const sleep = recent.map((v) => Number(v.sleepH)).filter((x) => x > 0);
  const data = sleep.length ? ` Your recent check-ins show ${(sleep.reduce((a, b) => a + b, 0) / sleep.length).toFixed(1)} h average sleep.` : ' I don\'t have recent check-in data — logging sleep and fatigue helps me judge this.';
  if (!target) {
    const todays = effectiveSessionsOn(plan, state, today).filter((s) => open(s, state));
    if (!todays.length) return result(`Today and tomorrow are already light, so no change is needed. Prioritise sleep (8+ h in bed) and food.${data}`, { intents });
    return result(`Take today as a rest day.${data} Nothing demanding is scheduled in the next two days, so skipping today's session costs very little.`, { intents, proposal: proposal('Rest day', todays.map((s) => ({ action: 'skip', workoutId: s.id, reason: 'Unusual fatigue reported; recovery comes first.' })), 'Small volume reduction; protects the next key session.', 'If fatigue persists for 3+ days or comes with illness or poor sleep, take two easy days and consider talking to a clinician.') });
  }
  const easyMin = Math.max(20, Math.min(45, Math.round((target.durationMin || 60) * 0.5)));
  const sore = /\bsore|soreness|heavy legs|legs are\b/i.test(text);
  const opener = sore ? 'Some soreness after a big session (like a brick) is normal; it usually eases within 24–72 hours. Moving easily helps, but hard work on sore legs tends to reduce quality.' : 'Feeling unusually fatigued is a good reason to back off.';
  return result(`${opener}${data} I suggest turning ${describe(target)} into an easy ${easyMin}-minute ${target.sport === 'bike' ? 'spin' : target.sport === 'run' ? 'jog or walk' : 'session'} (or skipping it if you still feel flat). One easier session won't cost fitness; training hard while fatigued often costs the next week.`, {
    intents,
    proposal: proposal('Convert next hard session to easy', [{ action: 'replace', workoutId: target.id, replacement: { title: target.sport === 'bike' ? 'Easy recovery spin' : target.sport === 'run' ? 'Easy recovery jog' : 'Easy recovery session', sport: target.sport, durationMin: Math.min(easyMin, Math.round((target.durationMin || 60) * 1.25)), intensity: 'easy', description: 'Zone 1–2 / RPE 2–3 only. Stop early if you feel worse.' }, reason: 'Reported fatigue — protect recovery.' }], 'Removes one quality session this week; the remaining schedule is unchanged.', 'Re-check how you feel tomorrow morning. Fatigue lasting several days, with poor sleep or low mood, is a reason to reduce load further.'),
  });
}

function painProposal(plan, state, today, intents) {
  const runs = upcomingSessions(plan, state, today, 3).filter((s) => s.sport === 'run');
  const msg = 'Pain is a signal to modify, not push through. Avoid activities that provoke it; if the pain is sharp, localized to bone, worsening, changes how you move, or lasts more than a few days, see a sports-medicine clinician or physiotherapist. I can\'t diagnose injuries.';
  if (!runs.length) return result(`${msg} Nothing running-specific is scheduled in the next 3 days. Tell me which sessions hurt and I'll adjust them.`, { intents, safetyLevel: 'caution' });
  return result(`${msg} As a conservative step, I suggest replacing your next ${runs.length} run${runs.length > 1 ? 's' : ''} with pain-free, low-impact work (easy bike or swim) — only if those don't hurt either.`, {
    intents, safetyLevel: 'caution',
    proposal: proposal('Low-impact substitutes while pain settles', runs.map((s) => ({ action: 'replace', workoutId: s.id, replacement: { title: 'Pain-free easy spin or swim', sport: 'bike', durationMin: Math.min(45, Math.round(s.durationMin * 1.25)), intensity: 'easy', description: 'Easy spin (or swim) only if completely pain-free. Stop if pain increases.' }, reason: 'Reported pain — reduce impact.' })), 'Less running load for a few days; aerobic work continues if pain-free.', 'Seek qualified advice if pain persists or worsens.'),
  });
}

function illnessProposal(plan, state, today, intents) {
  const next = upcomingSessions(plan, state, today, 2);
  const msg = 'With illness: symptoms only above the neck and no fever → easy sessions only; fever, chest symptoms, or body aches → rest until they resolve. Return gradually and see a doctor if symptoms are severe or persistent.';
  if (!next.length) return result(msg, { intents, safetyLevel: 'caution' });
  return result(`${msg} I suggest skipping the next two days of training to let you recover.`, { intents, safetyLevel: 'caution', proposal: proposal('Rest while ill', next.map((s) => ({ action: 'skip', workoutId: s.id, reason: 'Illness reported — rest first.' })), 'Short pause; fitness is not lost in a few days.', 'Resume with easy sessions once symptom-free for 24 h.') });
}

function parseAvailability(text) {
  const t = text.toLowerCase();
  const changes = [];
  const neg = t.match(new RegExp(`(?:no longer|can'?t|cannot|not available|unavailable)[^.]*?${WD_RE}`, 'g')) || [];
  const pos = t.match(new RegExp(`(?:available|free|can (?:also )?train)[^.]*?${WD_RE}`, 'g')) || [];
  for (const seg of neg) for (const m of seg.matchAll(new RegExp(WD_RE, 'g'))) changes.push({ day: DAYS[WEEKDAYS[m[1].replace(/s$/, '')] ?? WEEKDAYS[m[1]]], available: false, maxMinutes: 0 });
  for (const seg of pos) {
    if (/not available|unavailable/.test(seg)) continue;
    for (const m of seg.matchAll(new RegExp(WD_RE, 'g'))) {
      const day = DAYS[WEEKDAYS[m[1].replace(/s$/, '')] ?? WEEKDAYS[m[1]]];
      if (!changes.some((c) => c.day === day)) changes.push({ day, available: true, maxMinutes: parseMinutes(seg) });
    }
  }
  return changes.length ? { changes } : null;
}

function weeklyProposal(plan, state, today, intents, range, onlyDays, text) {
  const nextWeek = /\bnext week\b/.test(text.toLowerCase());
  const wkStart = range ? mondayOf(range.start) : nextWeek ? addDays(mondayOf(today), 7) : mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wkStart, i)).filter((d) => d >= today);
  const blocked = new Set(days.filter((d) => (range ? d >= range.start && d <= range.end : !onlyDays.has(dayOfWeek(d)))));
  const affected = [...blocked].flatMap((d) => effectiveSessionsOn(plan, state, d)).filter((s) => open(s, state));
  if (!affected.length) return result(`Nothing is scheduled on those days (${[...blocked].map((d) => DOW[dayOfWeek(d)]).join(', ')}), so the plan already works.`, { intents });
  const order = [...affected].sort((a, b) => (b.priority?.startsWith('Key') ? 1 : 0) - (a.priority?.startsWith('Key') ? 1 : 0) || (b.intensity === 'long' ? 1 : 0) - (a.intensity === 'long' ? 1 : 0));
  const changes = [];
  for (const s of order) {
    const keyish = s.priority?.startsWith('Key') && ['bike', 'run', 'swim'].includes(s.sport);
    const alt = keyish ? bestSlot(plan, state, s, { today, exclude: blocked, extraChanges: changes }) : null;
    if (alt) changes.push({ action: 'move', workoutId: s.id, newDate: alt.date, reason: `Key session moved to ${DOW[dayOfWeek(alt.date)]} — fits without stacking demanding sessions.` });
    else changes.push({ action: 'skip', workoutId: s.id, reason: keyish ? 'No recovery-safe slot remains on your available days.' : 'Lower-priority session; skipped rather than crammed into fewer days.' });
  }
  const v = validateProposal(plan, state, { changes }, { today });
  const final = v.ok ? changes : changes.map((c) => (c.action === 'move' && v.items.find((i) => i.change === c)?.errors?.length ? { action: 'skip', workoutId: c.workoutId, reason: 'Could not be placed safely.' } : c));
  const moved = final.filter((c) => c.action === 'move').length;
  const skipped = final.length - moved;
  return result(`Here's a revised week for ${range ? range.label : 'your available days'}: I kept ${moved} key session${moved === 1 ? '' : 's'} by moving ${moved === 1 ? 'it' : 'them'} to your available days, and skip ${skipped} lower-priority session${skipped === 1 ? '' : 's'}. I did not compress the full week into fewer days — that would stack hard sessions and add injury and fatigue risk.`, { intents, proposal: proposal(`Revised week (${range ? range.label : 'limited availability'})`, final, `About ${skipped} session${skipped === 1 ? '' : 's'} less this week; key race-specific work is preserved where it fits.`, 'Keep the moved sessions at planned intensity only if you slept well while traveling.') });
}

function informational(plan, state, today, intents) {
  const day = plan.byDate[today] || plan.days[0];
  const up = upcomingSessions(plan, state, today, 7).filter((s) => s.priority?.startsWith('Key')).slice(0, 4);
  const parts = [`You're in ${day.phaseName} (week ${day.week}); race day is in ${Math.max(0, diffDays(today, '2027-03-14'))} days.`];
  if (up.length) parts.push(`Key sessions coming up: ${up.map((s) => `${DOW[dayOfWeek(s.date)].slice(0, 3)} ${s.title}`).join('; ')}.`);
  if (intents.includes('race_prep')) parts.push('For race prep, open the Race Day page: pacing bands, fueling schedule and checklists. The taper starts March 1.');
  if (intents.includes('priority')) parts.push('Changing training priorities needs coaching judgment — the AI coach can propose specific swaps. The plan already weights the bike heavily (Tue quality + Sat long ride).');
  parts.push('Ask me to skip, move, shorten, or replace a session, or describe a schedule conflict, and I\'ll propose a change for you to approve.');
  return result(parts.join(' '), { intents });
}
