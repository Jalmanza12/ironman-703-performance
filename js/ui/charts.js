// Dependency-free SVG charts. One y-axis per chart (never dual-axis); hover tooltips on every
// mark; series always carry a legend + direct label so identity never relies on color alone.

import { esc } from './h.js';

const W = 640;
let uid = 0;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function wrap(id, svg, legend = '', table = '') {
  return `<div class="chart" id="${id}">${legend}${svg}<div class="chart-tip" role="tooltip"></div>${table}</div>`;
}

export function legendHTML(series) {
  if (series.length < 2) return '';
  return `<div class="legend" aria-hidden="true">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

/** Stacked bars. data: [{label, values:{key:n}, tip}] series:[{key,name,color}] */
export function stackedBars(data, series, { height = 220, unit = '', yFmt = (v) => v, overlay = null } = {}) {
  if (!data.length) return '<div class="chart-empty">No data yet.</div>';
  const id = `c${++uid}`;
  const pad = { l: 40, r: 10, t: 12, b: 26 };
  const totals = data.map((d) => series.reduce((a, s) => a + (d.values[s.key] || 0), 0));
  const max = niceMax(Math.max(...totals, ...(overlay ? overlay.map((o) => o || 0) : [0])));
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const bw = iw / data.length;
  const barW = Math.max(4, Math.min(28, bw * 0.62));
  let g = '';
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + ih - (ih * i) / 4;
    g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text class="axis-label" x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${esc(yFmt((max * i) / 4))}</text>`;
  }
  data.forEach((d, i) => {
    const x = pad.l + bw * i + (bw - barW) / 2;
    let y = pad.t + ih;
    series.forEach((s, si) => {
      const v = d.values[s.key] || 0;
      if (v <= 0) return;
      const h = Math.max(0, (v / max) * ih - (si ? 2 : 0));
      y -= h + (si ? 2 : 0);
      g += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="${si === series.length - 1 ? 3 : 1}" fill="${s.color}" data-tip="${esc(d.tip || `${d.label}: ${s.name} ${yFmt(v)}${unit}`)}"/>`;
    });
    if (overlay && overlay[i] != null) {
      const oy = pad.t + ih - (overlay[i] / max) * ih;
      g += `<line x1="${x - 3}" x2="${x + barW + 3}" y1="${oy}" y2="${oy}" stroke="#f3eee4" stroke-width="2" stroke-dasharray="3 2" data-tip="${esc(`${d.label}: planned ${yFmt(overlay[i])}${unit}`)}"/>`;
    }
    if (data.length <= 26 && (data.length < 14 || i % 2 === 0)) g += `<text class="axis-label" x="${x + barW / 2}" y="${height - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    g += `<rect x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(d.tip || `${d.label}: ${yFmt(totals[i])}${unit}`)}"/>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Stacked bar chart">${g}</svg>`;
  return wrap(id, svg, legendHTML(series.concat(overlay ? [{ name: 'Planned (dashed)', color: 'repeating-linear-gradient(90deg,#f3eee4 0 3px,transparent 3px 5px)' }] : [])));
}

/** Line chart. series: [{name,color,points:[{x(index or date label), y, tip}]}], labels: x labels */
export function lineChart(series, labels, { height = 220, yFmt = (v) => v, yMin = null, invert = false, band = null, refLine = null } = {}) {
  const pts = series.flatMap((s) => s.points.filter((p) => p.y != null));
  if (!pts.length) return '<div class="chart-empty">No data yet.</div>';
  const id = `c${++uid}`;
  const pad = { l: 48, r: 14, t: 12, b: 26 };
  let lo = yMin ?? Math.min(...pts.map((p) => p.y), ...(band ? band.map((b) => b.lo) : []), refLine?.y ?? Infinity);
  let hi = Math.max(...pts.map((p) => p.y), ...(band ? band.map((b) => b.hi) : []), refLine?.y ?? -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = Math.max(1, labels.length - 1);
  const X = (i) => pad.l + (iw * i) / n;
  const Y = (v) => (invert ? pad.t + ((v - lo) / (hi - lo)) * ih : pad.t + ih - ((v - lo) / (hi - lo)) * ih);
  let g = '';
  for (let i = 0; i <= 4; i += 1) {
    const v = lo + ((hi - lo) * i) / 4;
    const y = Y(v);
    g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text class="axis-label" x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${esc(yFmt(v))}</text>`;
  }
  if (band) {
    const top = band.map((b, i) => `${X(b.i ?? i)},${Y(b.hi)}`).join(' ');
    const bot = band.map((b, i) => `${X(b.i ?? i)},${Y(b.lo)}`).reverse().join(' ');
    g += `<polygon points="${top} ${bot}" fill="rgba(233,196,106,.14)" stroke="none"/>`;
  }
  if (refLine) g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(refLine.y)}" y2="${Y(refLine.y)}" stroke="#e9c46a" stroke-width="1.5" stroke-dasharray="5 4"/><text class="val-label" x="${W - pad.r}" y="${Y(refLine.y) - 6}" text-anchor="end">${esc(refLine.label)}</text>`;
  for (const s of series) {
    const p = s.points.filter((q) => q.y != null);
    if (p.length > 1) g += `<polyline points="${p.map((q) => `${X(q.i)},${Y(q.y)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const q of p) g += `<circle cx="${X(q.i)}" cy="${Y(q.y)}" r="4.5" fill="${s.color}" stroke="#111a2f" stroke-width="2" data-tip="${esc(q.tip || `${labels[q.i]}: ${yFmt(q.y)}`)}"/>`;
    const last = p[p.length - 1];
    if (series.length <= 4 && last) g += `<text class="val-label" x="${Math.min(X(last.i) + 8, W - 4)}" y="${Y(last.y) - 8}" text-anchor="${X(last.i) > W - 80 ? 'end' : 'start'}">${esc(s.name)}</text>`;
  }
  const step = Math.ceil(labels.length / 8);
  labels.forEach((l, i) => {
    if (i % step === 0 || i === labels.length - 1) g += `<text class="axis-label" x="${X(i)}" y="${height - 8}" text-anchor="middle">${esc(l)}</text>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Line chart">${g}</svg>`;
  return wrap(id, svg, legendHTML(series));
}

/** Attach hover/touch tooltips to all charts in a root element. */
export function bindTooltips(root) {
  root.querySelectorAll('.chart').forEach((c) => {
    const tip = c.querySelector('.chart-tip');
    if (!tip) return;
    const show = (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return tip.classList.remove('show');
      const r = c.getBoundingClientRect();
      const pt = e.touches ? e.touches[0] : e;
      tip.textContent = t.getAttribute('data-tip');
      tip.style.left = `${Math.min(Math.max(pt.clientX - r.left, 80), r.width - 80)}px`;
      tip.style.top = `${pt.clientY - r.top}px`;
      tip.classList.add('show');
    };
    c.addEventListener('mousemove', show);
    c.addEventListener('touchstart', show, { passive: true });
    c.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

/** Simple horizontal planned-vs-actual bars (with text values; no color-only meaning). */
export function hbars(rows) {
  return rows.map((r) => {
    const pct = r.planned ? Math.min(1.25, r.actual / r.planned) : 0;
    return `<div class="bar-h"><span>${esc(r.label)}</span><div class="track" title="${esc(`${r.actualText} of ${r.plannedText}`)}"><div class="fill" style="width:${Math.round(Math.min(1, pct) * 100)}%;background:${r.color}"></div></div><span class="muted small" style="text-align:right">${esc(r.actualText)} / ${esc(r.plannedText)}</span></div>`;
  }).join('');
}
