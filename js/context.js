// Builds the shared per-render context: plan, saved state, benchmarks, prediction, coaching.
// Every page reads from this — one source of truth.

import { buildPlan } from './plan/generator.js';
import { load, update } from './store/store.js';
import { currentBenchmarks } from './lib/benchmarks.js';
import { predictRace } from './lib/prediction.js';
import { predictionEvidence } from './lib/load.js';
import { runCoaching } from './lib/coaching.js';
import { todayLocalISO } from './lib/dates.js';

export function context() {
  const plan = buildPlan();
  let state = load();
  if (state.planVersion !== plan.version) state = update((s) => { s.planVersion = plan.version; });
  const { values: bm, history } = currentBenchmarks(state);
  const today = todayLocalISO();
  const evidence = predictionEvidence(plan, state, bm);
  const prediction = predictRace(bm, state.profile, evidence);
  const coaching = runCoaching({ plan, state, bm, history, today });
  return { plan, state, bm, history, today, evidence, prediction, coaching };
}
