// Transparent rules-based coaching engine. Every output states the observation (data),
// the suggestion, and why. These are AUTOMATED OBSERVATIONS — not medical advice and not a
// substitute for a qualified coach or clinician.

import { addDays, diffDays } from './dates.js';
import { DONE, compareSession } from './load.js';
import { benchmarkTrend } from './benchmarks.js';

const LEVEL_ORDER = { stop: 0, warning: 1, caution: 2, info: 3, positive: 4 };

export function runCoaching({ plan, state, bm, history = {}, today }) {
  const out = [];
  const daysBack = (n) => Array.from({ length: n }, (_, i) => addDays(today, -i));
  const daily = (d) => state.daily[d] || {};
  const last3 = daysBack(3).map(daily);
  const last7 = daysBack(7).map(daily);

  // 1. Red flags — pain / symptoms.
  const symptoms = last3.flatMap((d) => d.symptoms || []);
  const redFlag = symptoms.filter((s) => ['chest pain', 'dizziness', 'fainting', 'palpitations', 'fever', 'shortness of breath at rest'].includes(s));
  if (redFlag.length) {
    out.push({ level: 'stop', title: 'Stop training and seek medical evaluation', observation: `Reported in the last 3 days: ${[...new Set(redFlag)].join(', ')}.`, suggestion: 'Do not train until evaluated by a medical professional. Chest pain, fainting, or severe breathlessness warrant urgent care.', why: 'These symptoms can indicate conditions where exercise is unsafe. No training benefit outweighs that risk.' });
  }
  const pains = last3.filter((d) => Number(d.pain) >= 4);
  if (pains.length) {
    const loc = [...new Set(pains.map((d) => d.painLocation).filter(Boolean))].join(', ');
    out.push({ level: 'warning', title: 'Pain reported — modify, do not push through', observation: `Pain ≥4/10 on ${pains.length} of the last 3 days${loc ? ` (${loc})` : ''}.`, suggestion: 'Replace impact or provoking sessions with pain-free alternatives (swim, easy bike). If pain alters your gait/stroke, persists >3–5 days, or is sharp/localised to bone, see a sports-medicine clinician.', why: 'Training through pain that changes mechanics is a common path from niggle to injury; early modification usually costs days, not weeks.' });
  } else if (last3.some((d) => Number(d.pain) >= 2)) {
    out.push({ level: 'info', title: 'Minor discomfort noted', observation: 'Pain 2–3/10 reported recently.', suggestion: 'Monitor. If it rises or affects movement, swap the next run for a bike or swim.', why: 'Low-level soreness is common; trend matters more than one day.' });
  }

  // 2. Illness keywords.
  if (symptoms.some((s) => ['sore throat', 'congestion', 'cold symptoms'].includes(s)) && !redFlag.length) {
    out.push({ level: 'caution', title: 'Illness symptoms', observation: 'Cold-type symptoms logged.', suggestion: 'Above-the-neck symptoms only and no fever: easy sessions only, no intervals. Below-the-neck symptoms or fever: rest.', why: 'Hard training while ill prolongs illness and lowers training quality.' });
  }

  // 3. Sleep + fatigue.
  const sleeps = last3.map((d) => Number(d.sleepH)).filter((v) => v > 0);
  const fatigues = last3.map((d) => Number(d.fatigue)).filter((v) => v > 0);
  const avgSleep = avg(sleeps);
  const avgFat = avg(fatigues);
  if (sleeps.length >= 2 && fatigues.length >= 2 && avgSleep < 6.5 && avgFat >= 7) {
    out.push({ level: 'warning', title: 'Reduce training stress for 1–2 days', observation: `Average sleep ${avgSleep.toFixed(1)} h and fatigue ${avgFat.toFixed(1)}/10 over the last 3 days.`, suggestion: 'Convert the next hard session to easy (or rest) and prioritise 8+ h in bed. Resume intervals when fatigue ≤5.', why: 'Short sleep with high perceived fatigue predicts poor session quality and higher illness/injury risk (Walsh 2021; Saw 2016). Subjective measures are among the most responsive markers.' });
  } else if (sleeps.length >= 3 && avgSleep < 6.5) {
    out.push({ level: 'caution', title: 'Sleep is running short', observation: `Average sleep ${avgSleep.toFixed(1)} h over 3 days.`, suggestion: 'Protect sleep before adding anything. If a session must go, drop an easy one, not the key one.', why: 'Sleep is the highest-return recovery tool available (Walsh 2021).' });
  }
  const sore = last3.map((d) => Number(d.soreness)).filter((v) => v > 0);
  if (sore.length >= 2 && sore.slice(0, 2).every((v) => v >= 7)) {
    out.push({ level: 'caution', title: 'High soreness two days running', observation: `Soreness ${sore.slice(0, 2).join(', ')}/10.`, suggestion: 'Swap the next run for a swim or easy spin; keep lifting loads but drop sets.', why: 'Persistent high soreness reduces movement quality and increases injury risk when running.' });
  }
  const mot = last7.map((d) => Number(d.motivation)).filter((v) => v > 0);
  if (mot.length >= 4 && avg(mot) <= 3) {
    out.push({ level: 'caution', title: 'Motivation is low', observation: `Average motivation ${avg(mot).toFixed(1)}/10 this week.`, suggestion: 'Check life stress (school, work). Consider an unplanned easy week. Persistent low mood with fatigue and poor performance warrants talking to a clinician.', why: 'Mood disturbance is an early sign of non-functional overreaching (Meeusen 2013).' });
  }

  // 4. Missed sessions — never cram.
  const window = plan.days.filter((d) => d.date <= today && d.date > addDays(today, -7));
  const keys = window.flatMap((d) => d.sessions.filter((s) => s.priority?.startsWith('Key') && s.sport !== 'rest' && !state.overrides?.[s.id]?.cancelled && !state.reschedules?.[s.id]));
  const missedKeys = keys.filter((s) => state.logs[s.id]?.status === 'skipped' || (!state.logs[s.id] && s.date < today));
  if (keys.length && missedKeys.length >= 2) {
    out.push({ level: 'caution', title: 'Several key sessions missed this week', observation: `${missedKeys.length} of ${keys.length} key sessions skipped or unlogged in the last 7 days.`, suggestion: 'Do not add them to the coming days. Resume the plan as written; if a test or long session was missed, use Reschedule to place it only where recovery allows.', why: 'Cramming missed volume concentrates load and raises injury and illness risk; consistency over weeks matters more than any single session.' });
  }

  // 5. Bike target misses / over-performance.
  const recentLogged = Object.entries(state.logs)
    .map(([id, l]) => ({ s: plan.sessions[id], l }))
    .filter((x) => x.s && DONE.has(x.l.status) && x.s.date <= today && diffDays(x.s.date, today) <= 21)
    .sort((a, b) => b.s.date.localeCompare(a.s.date));
  const bikeQ = recentLogged.filter((x) => x.s.sport === 'bike' && x.s.intensity === 'hard').slice(0, 3);
  const missedBike = bikeQ.filter((x) => (compareSession(x.s, x.l, bm).metrics.repsPct ?? 1) < 1 || Number(x.l.actual?.rpe) - (x.s.plannedRPE || 7) >= 2);
  if (bikeQ.length >= 2 && missedBike.length >= 2) {
    out.push({ level: 'caution', title: 'Repeatedly missing bike interval targets', observation: `${missedBike.length} of the last ${bikeQ.length} bike quality sessions had incomplete reps or much higher RPE than planned.`, suggestion: 'Check three causes in order: (1) recovery — sleep/fatigue logs; (2) fueling before/during; (3) targets — if recovery and fueling are fine, FTP may be set too high: retest at the next window or use the low end of ranges until then.', why: 'Repeated misses rarely mean "try harder." They point to fatigue, fueling, or an inaccurate benchmark.' });
  }
  const easyFeel = bikeQ.filter((x) => Number(x.l.actual?.rpe) > 0 && Number(x.l.actual.rpe) <= (x.s.plannedRPE || 7) - 2 && (compareSession(x.s, x.l, bm).metrics.repsPct ?? 1) >= 1);
  if (easyFeel.length >= 2) {
    out.push({ level: 'positive', title: 'Bike intervals feel easier than planned', observation: `${easyFeel.length} recent quality rides completed at RPE ≥2 below plan.`, suggestion: 'Keep current targets until the next scheduled FTP test; if it confirms, zones update automatically.', why: 'Zones change from repeatable tests, not single good days.' });
  }

  // 6. Run efficiency (pace at HR) trend on easy runs.
  const easyRuns = recentLogged.filter((x) => x.s.sport === 'run' && x.s.intensity === 'easy' && x.l.actual?.paceSecPerMile > 0 && x.l.actual?.avgHr > 0);
  const allEasy = Object.entries(state.logs).map(([id, l]) => ({ s: plan.sessions[id], l })).filter((x) => x.s && x.s.sport === 'run' && !x.s.brick && x.s.intensity !== 'hard' && x.l.actual?.paceSecPerMile > 0 && x.l.actual?.avgHr > 0).sort((a, b) => a.s.date.localeCompare(b.s.date));
  if (allEasy.length >= 6) {
    const ef = (x) => (1609.344 / x.l.actual.paceSecPerMile) * 60 / x.l.actual.avgHr; // m/min per beat
    const first = avg(allEasy.slice(0, 3).map(ef));
    const last = avg(allEasy.slice(-3).map(ef));
    const pct = (last / first - 1) * 100;
    if (pct >= 3) out.push({ level: 'positive', title: 'Aerobic running efficiency is improving', observation: `Speed per heartbeat on easy runs up ${pct.toFixed(1)}% (first 3 vs. last 3 logged).`, suggestion: 'Stay the course — this is what easy volume is for.', why: 'Faster pace at similar heart rate suggests aerobic adaptation (heat, terrain, and fatigue also influence it, so read trends, not single runs).' });
    else if (pct <= -5) out.push({ level: 'caution', title: 'Easy-run efficiency has dropped', observation: `Speed per heartbeat down ${Math.abs(pct).toFixed(1)}%.`, suggestion: 'Check heat, terrain, sleep and fatigue. If no external reason, take an extra easy day.', why: 'Declining efficiency without an external cause can indicate accumulated fatigue.' });
  }
  if (easyRuns.length >= 3 && bm.lthrRun > 0) {
    const tooHard = easyRuns.filter((x) => x.l.actual.avgHr > bm.lthrRun * 0.89);
    if (tooHard.length >= 2) out.push({ level: 'caution', title: 'Easy runs are drifting too hard', observation: `${tooHard.length} of the last ${easyRuns.length} easy runs averaged above Z2.`, suggestion: 'Slow down, walk short hills, run with HR visible.', why: 'Mostly-easy intensity distribution is consistently associated with better endurance development (Seiler 2010; Stöggl & Sperlich 2014). Grey-zone easy days steal from key sessions.' });
  }

  // 7. Swim progress.
  const swimQ = recentLogged.filter((x) => x.s.sport === 'swim' && x.s.intensity === 'hard' && Number(x.l.actual?.rpe) > 0);
  const swimEasy = swimQ.filter((x) => Number(x.l.actual.rpe) <= 6 && /faster|under target|ahead/i.test(x.l.actual.notes || ''));
  if (swimEasy.length >= 2) out.push({ level: 'positive', title: 'Swim sets look faster than target', observation: `${swimEasy.length} recent CSS sessions noted as faster than target at RPE ≤6.`, suggestion: 'Hold technique quality and retest CSS at the next scheduled test.', why: 'A retest confirms improvement before zones change.' });

  // 8. Weight / energy availability.
  const weights = Object.entries(state.daily).filter(([, d]) => d.weightLb > 0).sort(([a], [b]) => a.localeCompare(b));
  if (weights.length >= 6) {
    const recent = weights.filter(([d]) => d > addDays(today, -7) && d <= today).map(([, d]) => Number(d.weightLb));
    const prior = weights.filter(([d]) => d > addDays(today, -14) && d <= addDays(today, -7)).map(([, d]) => Number(d.weightLb));
    if (recent.length >= 3 && prior.length >= 3) {
      const ch = (avg(recent) - avg(prior)) / avg(prior) * 100;
      if (ch <= -1) out.push({ level: 'warning', title: 'Weight dropping quickly', observation: `7-day average down ${Math.abs(ch).toFixed(1)}% vs. the previous week.`, suggestion: 'Increase carbohydrate on training days and add a snack around key sessions. Rapid loss during heavy training risks low energy availability.', why: 'Low energy availability impairs training adaptation, bone health, immunity and performance (IOC REDs consensus, Mountjoy 2023). Target, if any: ≤0.5% body weight per week, base phase only.' });
      else if (ch <= -0.6 && avgFat >= 6) out.push({ level: 'caution', title: 'Weight trending down with rising fatigue', observation: `Weight −${Math.abs(ch).toFixed(1)}%/week; fatigue ${avgFat.toFixed(1)}/10.`, suggestion: 'Eat more on training days — performance first.', why: 'Combined weight loss and fatigue are early REDs warning signs.' });
    }
  }
  const hunger = last7.map((d) => Number(d.hunger)).filter((v) => v > 0);
  if (hunger.length >= 4 && avg(hunger) >= 8) out.push({ level: 'caution', title: 'Persistent high hunger', observation: `Average hunger ${avg(hunger).toFixed(1)}/10.`, suggestion: 'Likely under-fueling relative to training. Add carbohydrate around sessions and an evening protein snack.', why: 'Persistent hunger is a practical signal of energy deficit.' });

  // 9. Benchmarks — trends (never change zones from one workout).
  for (const t of ['ftp', 'css', 'thresholdPace']) {
    const tr = benchmarkTrend(history, t);
    if (!tr || !tr.meaningful) continue;
    const name = { ftp: 'FTP', css: 'CSS', thresholdPace: 'Run threshold pace' }[t];
    out.push({ level: tr.direction === 'improved' ? 'positive' : 'caution', title: `${name} ${tr.direction} ${Math.abs(tr.pct).toFixed(1)}%`, observation: `Last two tests: ${tr.from} → ${tr.to}.`, suggestion: tr.direction === 'improved' ? 'Zones and predictions now use the new value.' : (tr.confirmed ? 'A confirmed decline across two tests: review sleep, fueling and load with the 4-week review; consider an extra recovery week.' : 'Single lower test: check test conditions (fatigue, heat, equipment) before acting. Confirm at the next test.'), why: 'Repeatable tests, not individual workouts, drive zone changes.' });
  }

  // 10. Load spike (with caveat).
  const loads = plan.days.filter((d) => d.date <= today).map((d) => d.sessions.reduce((a, s) => {
    const l = state.logs[s.id];
    return a + (l && DONE.has(l.status) ? (Number(l.actual?.durationMin) || s.durationMin || 0) * (Number(l.actual?.rpe) || s.plannedRPE || 3) : 0);
  }, 0));
  if (loads.length >= 28) {
    const a7 = loads.slice(-7).reduce((x, y) => x + y, 0);
    const prior = loads.slice(-28, -7).reduce((x, y) => x + y, 0) / 3;
    if (prior > 0 && a7 > prior * 1.3) out.push({ level: 'caution', title: 'Training load jumped this week', observation: `This week's session-RPE load is ${Math.round((a7 / prior - 1) * 100)}% above your previous 3-week average.`, suggestion: 'Make sure the next easy days stay easy; watch sleep and soreness.', why: 'Rapid load increases are associated with injury risk; treat this as a prompt to check recovery, not a precise risk score (Impellizzeri 2020).' });
  }

  // 11. Fueling practice.
  const longOnes = recentLogged.filter((x) => (x.s.sport === 'bike' || x.s.sport === 'run') && Number(x.l.actual?.durationMin) >= 90);
  const fuelLogged = longOnes.filter((x) => x.l.actual?.carbsG !== undefined && x.l.actual?.carbsG !== '');
  if (longOnes.length >= 2 && fuelLogged.length) {
    const gph = avg(fuelLogged.map((x) => Number(x.l.actual.carbsG) / (Number(x.l.actual.durationMin) / 60)));
    if (gph < 50) out.push({ level: 'caution', title: 'Fueling below race needs', observation: `Long sessions average ${Math.round(gph)} g/h carbohydrate.`, suggestion: 'Add ~10 g/h every 1–2 weeks toward 60–90 g/h using a glucose+fructose product.', why: 'Carbohydrate intake of up to ~90 g/h supports performance in 2.5+ h events, and the gut adapts with practice (Jeukendrup 2014, 2017).' });
  }

  if (!out.length) out.push({ level: 'info', title: 'No flags', observation: 'Not enough logged data yet, or nothing outside normal ranges.', suggestion: 'Log daily check-ins and sessions to unlock specific guidance.', why: 'The engine only comments when data supports it.' });
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

function avg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
