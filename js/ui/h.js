// Tiny view helpers. All interpolated user/plan text goes through esc().

export function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const NE = '<span class="ne">Not yet established</span>';

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

export function sportChip(sport, label) {
  const names = { swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Strength', mobility: 'Mobility', rest: 'Rest', race: 'Race', other: 'Recovery' };
  return `<span class="chip ${esc(sport)}">${esc(label || names[sport] || sport)}</span>`;
}

export function statusDot(status) {
  return `<span class="status-dot ${esc(status || '')}" role="img" aria-label="${esc(status || 'not logged')}"></span>`;
}

export function priorityChip(p) {
  if (!p) return '';
  if (p.startsWith('Key')) return '<span class="chip key">Key</span>';
  if (p === 'Optional') return '<span class="chip">Optional</span>';
  if (p === 'Replaceable') return '<span class="chip">Replaceable</span>';
  return '<span class="chip">Mandatory</span>';
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function num(v) {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
