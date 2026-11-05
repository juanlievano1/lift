// Gráficas SVG ligeras (sin librerías, funcionan sin internet) con tooltip al tocar.

const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' });

// series: [{ name, points: [{ x: 'YYYY-MM-DD', y }], kind: 'line' | 'dots' }]
export function lineChart(el, { series, unit = '', decimals = 1 }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    el.innerHTML = `<p class="empty">Registra al menos 2 datos para ver la gráfica.</p>`;
    return;
  }
  const W = 340, H = 180, P = { l: 36, r: 10, t: 12, b: 24 };
  const xs = all.map((p) => +new Date(p.x));
  const ys = all.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 864e5; x1 += 864e5; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max((y1 - y0) * 0.15, 0.5);
  y0 -= pad; y1 += pad;
  const sx = (t) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r);
  const sy = (v) => H - P.b - ((v - y0) / (y1 - y0)) * (H - P.t - P.b);

  const ticks = niceTicks(y0, y1, 4);
  const grid = ticks.map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis" x="${P.l - 6}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`).join('');
  const xl = [x0, x1].map((t, i) => `<text class="axis" x="${sx(t)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${fmtDate(new Date(t).toISOString().slice(0, 10))}</text>`).join('');

  const marks = series.map((s, i) => {
    const pts = s.points.map((p) => [sx(+new Date(p.x)), sy(p.y)]);
    if (s.kind === 'dots') return pts.map(([x, y]) => `<circle class="dot s${i}" cx="${x}" cy="${y}" r="3"/>`).join('');
    const path = `<path class="${s.kind === 'plan' ? 'planline' : 'line'} s${i}" d="${pts.map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')}"/>`;
    // Con pocos puntos reales, marca cada uno para que se vean
    const markers = s.kind === 'line' && pts.length <= 16 ? pts.map(([x, y]) => `<circle class="pt" cx="${x}" cy="${y}" r="3.5"/>`).join('') : '';
    return path + markers;
  }).join('');

  const legend = series.length > 1
    ? `<div class="legend">${series.map((s, i) => `<span><i class="key s${i} ${s.kind}"></i>${s.name}</span>`).join('')}</div>`
    : '';

  el.innerHTML = `${legend}<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s.name).join(', ')}">${grid}${xl}${marks}<line class="cross" y1="${P.t}" y2="${H - P.b}" x1="-10" x2="-10"/><g class="hl"></g></svg><div class="tip" hidden></div></div>`;

  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tip');
  const cross = el.querySelector('.cross');
  const hl = el.querySelector('.hl');
  const dates = [...new Set(all.map((p) => p.x))].sort();

  const move = (evt) => {
    const r = svg.getBoundingClientRect();
    const vx = ((evt.clientX - r.left) / r.width) * W;
    let best = dates[0], bd = Infinity;
    for (const d of dates) { const dd = Math.abs(sx(+new Date(d)) - vx); if (dd < bd) { bd = dd; best = d; } }
    const x = sx(+new Date(best));
    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    // punto más cercano de cada serie (máx. 3,5 días de distancia)
    const rows = series.map((s, i) => {
      let p = null, pd = 3.5 * 864e5;
      for (const q of s.points) { const dd = Math.abs(+new Date(q.x) - +new Date(best)); if (dd <= pd) { pd = dd; p = q; } }
      return p ? { i, name: s.name, y: p.y } : null;
    }).filter(Boolean);
    hl.innerHTML = rows.map((r0) => `<circle class="hdot ${series[r0.i].kind}" cx="${x}" cy="${sy(r0.y)}" r="5"/>`).join('');
    tip.hidden = false;
    tip.innerHTML = `<b>${fmtDate(best)}</b>${rows.map((r0) => `<div><i class="key s${r0.i} ${series[r0.i].kind}"></i>${r0.name}: <b>${r0.y.toFixed(decimals)} ${unit}</b></div>`).join('')}`;
    const left = (x / W) * r.width;
    tip.style.left = Math.min(Math.max(left - 70, 0), r.width - 150) + 'px';
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); hl.innerHTML = ''; };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

// Barras horizontales de volumen semanal con banda objetivo.
// rows: [{ label, value, lo, hi }]
export function volumeBars(rows) {
  const max = Math.max(24, ...rows.map((r) => r.value));
  return `<div class="vbars">${rows.map((r) => {
    const st = r.value < r.lo ? 'low' : r.value > r.hi ? 'high' : 'ok';
    const lbl = { low: 'Bajo', ok: 'En rango', high: 'Alto' }[st];
    return `<div class="vrow" title="${r.label}: ${r.value} series (objetivo ${r.lo}–${r.hi})">
      <span class="vlabel">${r.label}</span>
      <span class="vtrack"><span class="vband" style="left:${(r.lo / max) * 100}%;width:${((r.hi - r.lo) / max) * 100}%"></span><span class="vfill ${st}" style="width:${Math.max((r.value / max) * 100, 1.5)}%"></span></span>
      <span class="vval">${fmtNum(r.value)} <small class="${st}">${lbl}</small></span>
    </div>`;
  }).join('')}</div>`;
}

const fmtNum = (n) => (Number.isInteger(n) ? n : n.toFixed(1));

function niceTicks(lo, hi, n) {
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(2));
  return out;
}
