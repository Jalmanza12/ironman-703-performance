// Resolves workout target specs against the athlete's *current, validated* benchmarks.
// When a benchmark is missing, the resolver falls back to heart rate (if LTHR exists) and
// always to RPE, and marks the target as provisional. It never invents a number.

import { formatDuration, per100ydToPer100m, per100mToPer100yd, paceSecPerMileToKm } from './units.js';
import { validFTP, validHR, validRunPace, validCSS } from './zones.js';

const rpeText = (r) => (r ? `RPE ${r[0]}${r[1] !== r[0] ? `–${r[1]}` : ''}/10` : null);

/**
 * target spec kinds:
 *  bike: { kind:'bike', pct:[lo,hi], hr:[lo,hi] (×bike LTHR), rpe:[a,b], cad:'85–95 rpm' }
 *  run:  { kind:'run', mult:[fast,slow] (× threshold pace), hr:[lo,hi] (×run LTHR), rpe:[a,b] }
 *  swim: { kind:'swim', plus:[lo,hi] (s added to CSS/100), rpe:[a,b] }
 *  rpe:  { kind:'rpe', rpe:[a,b], hrRun?:[lo,hi], hrBike?:[lo,hi] }
 */
export function describeTarget(t, bm = {}) {
  if (!t) return null;
  const out = { lines: [], provisional: false, rpe: rpeText(t.rpe) };
  if (t.kind === 'bike') {
    const pctTxt = `${Math.round(t.pct[0] * 100)}–${Math.round(t.pct[1] * 100)}% FTP`;
    if (validFTP(bm.ftp)) {
      out.lines.push(`${Math.round(bm.ftp * t.pct[0])}–${Math.round(bm.ftp * t.pct[1])} W (${pctTxt})`);
    } else {
      out.provisional = true;
      out.lines.push(`${pctTxt} — FTP not yet established`);
    }
    if (t.hr) out.lines.push(hrLine(bm.lthrBike, t.hr, 'bike LTHR'));
    if (t.cad) out.lines.push(`Cadence ${t.cad}`);
  } else if (t.kind === 'run') {
    if (validRunPace(bm.thresholdPace)) {
      const fast = bm.thresholdPace * t.mult[0];
      const slow = bm.thresholdPace * t.mult[1];
      out.lines.push(`${formatDuration(fast)}–${formatDuration(slow)} /mi (${formatDuration(paceSecPerMileToKm(fast))}–${formatDuration(paceSecPerMileToKm(slow))} /km)`);
    } else {
      out.provisional = true;
      out.lines.push(`${multLabel(t.mult)} — threshold pace not yet established`);
    }
    if (t.hr) out.lines.push(hrLine(bm.lthrRun, t.hr, 'run LTHR'));
  } else if (t.kind === 'swim') {
    if (validCSS(bm.css)) {
      const unit = bm.poolUnit || 'yd';
      out.lines.push(`${formatDuration(bm.css + t.plus[0])}–${formatDuration(bm.css + t.plus[1])} /100${unit} (CSS ${signed(t.plus[0])} to ${signed(t.plus[1])} s)`);
    } else {
      out.provisional = true;
      out.lines.push(`CSS ${signed(t.plus[0])} to ${signed(t.plus[1])} s/100 — CSS not yet established`);
    }
  } else if (t.kind === 'rpe') {
    if (t.hrRun) out.lines.push(hrLine(bm.lthrRun, t.hrRun, 'run LTHR'));
    if (t.hrBike) out.lines.push(hrLine(bm.lthrBike, t.hrBike, 'bike LTHR'));
  }
  out.lines = out.lines.filter(Boolean);
  return out;
}

function hrLine(lthr, [lo, hi], label) {
  const pct = `${Math.round(lo * 100)}–${Math.round(hi * 100)}% ${label}`;
  if (validHR(lthr)) return `HR ${Math.round(lthr * lo)}–${Math.round(lthr * hi)} bpm (${pct})`;
  return `HR ${pct} (LTHR not yet established)`;
}

function multLabel([fast, slow]) {
  const f = Math.round((fast - 1) * 100);
  const s = Math.round((slow - 1) * 100);
  const fmt = (n) => (n === 0 ? 'threshold' : n > 0 ? `${n}% slower` : `${-n}% faster`);
  return `${fmt(f)} to ${fmt(s)} than threshold pace`;
}

function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Flat one-line text for exports and compact views. */
export function targetText(t, bm) {
  const d = describeTarget(t, bm);
  if (!d) return '';
  return [...d.lines, d.rpe].filter(Boolean).join(' · ');
}

/** Swim CSS expressed in both units for display. */
export function cssBothUnits(css, unit) {
  if (!validCSS(css)) return null;
  return unit === 'm'
    ? { per100m: css, per100yd: per100mToPer100yd(css) }
    : { per100yd: css, per100m: per100ydToPer100m(css) };
}
