// Gráficos da análise de sensibilidade por SRE: um gráfico por penalidade, resumo dos passos e o
// gráfico de perfil de uma segmentação calculada no navegador (modelo.js).
import { cssVar, FONTE_UI, FONTE_MONO, num, km, TIPOS } from './util.js';
import { media, desvio } from './estatistica.js';
import { hexA } from './graficos.js';

const CONFIG = { displaylogo: false, responsive: true, locale: 'pt-BR', modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines'] };
const MINI = { ...CONFIG, displayModeBar: false, staticPlot: false };
const TRACO = { funcional: 'dash', estrutural: 'dot', combinada: 'solid' };
const COR_REMOVIDA = '#9e9e9e', COR_NOVA = '#2e9d4f';
export const NOMES_TIPO = { funcional: 'Funcional (IGG, l2)', estrutural: 'Estrutural (d0, PELT normal)', combinada: 'Funcional + estrutural' };

function cores() {
  return {
    texto: cssVar('--texto'), texto2: cssVar('--texto-2'), mudo: cssVar('--texto-mudo'), grade: cssVar('--grade'), eixo: cssVar('--eixo'),
    sup: cssVar('--superficie'), destaque: cssVar('--destaque'), func: cssVar('--s-func'), estrut: cssVar('--s-estrut'), comb: cssVar('--s-comb'), d0: cssVar('--s-d0'),
  };
}
const corTipo = (c, t) => ({ funcional: c.func, estrutural: c.estrut, combinada: c.comb }[t]);

function eixo(c, extra = {}) {
  const t = typeof extra.title === 'string' ? { title: { text: extra.title, font: { color: c.texto2, size: 12 } } } : {};
  return { gridcolor: c.grade, linecolor: c.eixo, zerolinecolor: c.eixo, tickfont: { family: FONTE_MONO, color: c.mudo, size: 11 }, automargin: true, ...extra, ...t };
}
function base(c, extra = {}) {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', separators: ',.',
    font: { family: FONTE_UI, color: c.texto, size: 12 },
    hoverlabel: { bgcolor: c.sup, bordercolor: c.eixo, font: { color: c.texto } },
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { color: c.texto2, size: 12 }, bgcolor: 'rgba(0,0,0,0)' },
    margin: { l: 56, r: 16, t: 16, b: 44 }, hovermode: 'closest', ...extra,
  };
}
const alvoEl = (el) => (typeof el === 'string' ? document.getElementById(el) : el);
const desenhar = (el, tr, lay, cfg = CONFIG) => Plotly.react(alvoEl(el), tr, lay, cfg);

// rampa sequencial (azul) para a ordem dos passos; a referência fica em laranja
export function corPasso(i, n, iRef) {
  if (i === iRef) return cssVar('--destaque');
  const r = ['#9cc3f0', '#6da7ec', '#3987e5', '#256abf', '#1c5cab', '#104281', '#0d366b'];
  return r[Math.round((i / Math.max(n - 1, 1)) * (r.length - 1))];
}

// médias ± desvio de cada segmento de uma série
export function estatSegmentos(a, serie, quebras) {
  const N = serie.length;
  const lim = [0, ...quebras, N];
  const out = [];
  for (let i = 0; i < lim.length - 1; i++) {
    const v = serie.slice(lim[i], lim[i + 1]).filter(Number.isFinite);
    const k0 = a.ini[lim[i]], k1 = lim[i + 1] < N ? a.ini[lim[i + 1]] : a.fim[N - 1];
    out.push({ k0, k1, n: lim[i + 1] - lim[i], m: v.length ? media(v) : null, sd: v.length > 1 ? desvio(v, 1) : 0 });
  }
  return out;
}

function faixasSeg(estat) {
  const mx = [], my = [], bx = [], by = [], cd = [];
  estat.forEach((s, i) => {
    if (s.m === null) return;
    mx.push(s.k0, s.k1, null); my.push(s.m, s.m, null); cd.push([i + 1, s.sd, s.k1 - s.k0], [i + 1, s.sd, s.k1 - s.k0], null);
    bx.push(s.k0, s.k1, s.k1, s.k0, s.k0, null); by.push(s.m + s.sd, s.m + s.sd, s.m - s.sd, s.m - s.sd, s.m + s.sd, null);
  });
  return { mx, my, bx, by, cd };
}

// explicação ao passar o mouse numa quebra: segmentos dos dois lados
function textoQuebra(a, serie, quebras, b, un) {
  const lim = [0, ...quebras, serie.length];
  const i = lim.indexOf(b);
  if (i < 1) return '';
  const lado = (lo, hi) => {
    const v = serie.slice(lo, hi);
    const k1 = hi < a.ini.length ? a.ini[hi] : a.fim[a.fim.length - 1];
    return `km ${num(a.ini[lo], 1)}–${num(k1, 1)}: média ${num(media(v), 1)}${un}, desvio ${num(v.length > 1 ? desvio(v, 1) : 0, 1)}`;
  };
  return `antes: ${lado(lim[i - 1], b)}<br>depois: ${lado(b, lim[i + 1])}`;
}

/** perfil de uma segmentação calculada (passo da sensibilidade ou resultado de um dataset enviado).
 *  r = saída de modelo.segmentarSre; anterior = passo anterior (destaca quebras removidas/novas) */
export function grafPasso(el, a, r, { anterior = null, alvo = 'estrutural', titulo = '', altura = 640, tipos = TIPOS, comparar = null } = {}) {
  const c = cores();
  const x = a.ini.map((v, i) => 0.5 * (v + a.fim[i]));
  const chave = alvo === 'estrutural' ? 'estrut_s' : 'func_s';
  const estD0 = estatSegmentos(a, a.d0, r.estrut_s);
  const estIgg = estatSegmentos(a, a.igg, r.func_s);
  const fd = faixasSeg(estD0), fi = faixasSeg(estIgg);
  const traces = [
    { x: fd.bx, y: fd.by, fill: 'toself', fillcolor: hexA(c.estrut, 0.14), line: { width: 0 }, mode: 'lines', hoverinfo: 'skip', showlegend: false },
    { x, y: a.d0, mode: 'lines', name: 'd0', line: { color: c.d0, width: 1.3 }, hovertemplate: 'km %{x:.3f}<br>d0 %{y:.1f}<extra></extra>' },
    { x: fd.mx, y: fd.my, mode: 'lines', name: 'média ± desvio (estrutural)', line: { color: c.estrut, width: 2.6 }, customdata: fd.cd,
      hovertemplate: 'segmento estrutural %{customdata[0]}<br>média %{y:.1f} ± %{customdata[1]:.1f}<br>%{customdata[2]:.2f} km<extra></extra>' },
    { x: fi.bx, y: fi.by, fill: 'toself', fillcolor: hexA(c.func, 0.16), line: { width: 0 }, mode: 'lines', hoverinfo: 'skip', showlegend: false, yaxis: 'y2' },
    { x, y: a.igg, mode: 'lines', name: 'IGG', showlegend: false, line: { color: '#6250d6', width: 1.2 }, yaxis: 'y2', hovertemplate: 'km %{x:.3f}<br>IGG %{y:.1f}<extra></extra>' },
    { x: fi.mx, y: fi.my, mode: 'lines', name: 'média ± desvio (funcional)', line: { color: c.func, width: 2.4 }, customdata: fi.cd, yaxis: 'y2',
      hovertemplate: 'segmento funcional %{customdata[0]}<br>IGG médio %{y:.1f} ± %{customdata[1]:.1f}<br>%{customdata[2]:.2f} km<extra></extra>' },
    { x, y: a.iri, mode: 'lines', name: 'IRI', showlegend: false, line: { color: '#2e7d32', width: 1.2 }, yaxis: 'y3', hovertemplate: 'km %{x:.3f}<br>IRI %{y:.2f} m/km<extra></extra>' },
  ];
  const shapes = [];
  const qs = { funcional: r.func_s, estrutural: r.estrut_s, combinada: r.comb_s };
  tipos.forEach((t) => {
    qs[t].forEach((b) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1,
      line: { color: corTipo(c, t), dash: TRACO[t], width: t === 'combinada' ? 1.8 : 1.4 }, opacity: 0.85 }));
    traces.push({ x: [null], y: [null], mode: 'lines', name: `${t} (${qs[t].length + 1} seg.)`, line: { color: corTipo(c, t), dash: TRACO[t], width: 2 }, hoverinfo: 'skip' });
  });
  // marcadores no topo com a explicação de cada quebra do alvo
  const serie = alvo === 'estrutural' ? a.d0 : a.igg;
  const topo = Math.max(...a.d0.filter(Number.isFinite));
  traces.push({
    x: r[chave].map((b) => a.ini[b]), y: r[chave].map(() => topo), mode: 'markers', name: `quebras ${alvo}`, showlegend: false,
    marker: { symbol: 'triangle-down', size: 11, color: corTipo(c, alvo), line: { color: c.sup, width: 1 } },
    text: r[chave].map((b) => textoQuebra(a, serie, r[chave], b, '')),
    hovertemplate: `<b>quebra ${alvo} no km %{x:.3f}</b><br>%{text}<extra></extra>`,
  });
  if (anterior) {
    const rem = anterior[chave].filter((b) => !r[chave].includes(b));
    const nov = r[chave].filter((b) => !anterior[chave].includes(b));
    rem.forEach((b) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1, line: { color: COR_REMOVIDA, dash: 'dashdot', width: 2.4 } }));
    nov.forEach((b) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1, line: { color: COR_NOVA, width: 3 }, opacity: 0.55 }));
    if (rem.length) traces.push({ x: [null], y: [null], mode: 'lines', name: `removida neste passo (${rem.length})`, line: { color: COR_REMOVIDA, dash: 'dashdot', width: 2.4 }, hoverinfo: 'skip' });
    if (nov.length) traces.push({ x: [null], y: [null], mode: 'lines', name: `nova neste passo (${nov.length})`, line: { color: COR_NOVA, width: 3 }, hoverinfo: 'skip' });
  }
  if (comparar && comparar.length) {
    comparar.forEach((k) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: k, x1: k, y0: 0.96, y1: 1, line: { color: '#7b2cbf', width: 3 } }));
    traces.push({ x: [null], y: [null], mode: 'lines', name: `sua segmentação (${comparar.length + 1} seg.)`, line: { color: '#7b2cbf', width: 3 }, hoverinfo: 'skip' });
  }
  return desenhar(el, traces, base(c, {
    height: altura, shapes, hovermode: 'x unified', margin: { l: 60, r: 16, t: titulo ? 76 : 50, b: 44 },
    title: titulo ? { text: titulo, x: 0, xanchor: 'left', y: 0.995, yanchor: 'top', font: { size: 14, color: c.texto } } : undefined,
    legend: { orientation: 'h', x: 0, y: 1.0, yanchor: 'bottom', font: { color: c.texto2, size: 12 }, bgcolor: 'rgba(0,0,0,0)' },
    xaxis: eixo(c, { title: 'Distância linear (km)', anchor: 'y3', showspikes: true, spikecolor: c.mudo, spikethickness: 1 }),
    yaxis: eixo(c, { domain: [0.5, 1], title: 'd0' }),
    yaxis2: eixo(c, { domain: [0.25, 0.46], title: 'IGG', rangemode: 'tozero' }),
    yaxis3: eixo(c, { domain: [0, 0.21], title: 'IRI (m/km)', rangemode: 'tozero' }),
  }));
}

/** mini-gráfico de um passo (grade de pequenos múltiplos) */
export function grafPassoMini(el, a, r, { anterior = null, alvo = 'estrutural', ref = false, selecionado = false } = {}) {
  const c = cores();
  const x = a.ini.map((v, i) => 0.5 * (v + a.fim[i]));
  const [serie, chave, cor] = alvo === 'estrutural' ? [a.d0, 'estrut_s', c.estrut] : [a.igg, 'func_s', c.func];
  const f = faixasSeg(estatSegmentos(a, serie, r[chave]));
  const shapes = r.comb_s.map((b) => ({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1, line: { color: c.comb, width: 1 }, opacity: 0.7 }));
  if (anterior) {
    anterior[chave].filter((b) => !r[chave].includes(b)).forEach((b) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1, line: { color: COR_REMOVIDA, dash: 'dot', width: 1.6 } }));
    r[chave].filter((b) => !anterior[chave].includes(b)).forEach((b) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1, line: { color: COR_NOVA, width: 2.2 }, opacity: 0.6 }));
  }
  return desenhar(el, [
    { x: f.bx, y: f.by, fill: 'toself', fillcolor: hexA(cor, 0.15), line: { width: 0 }, mode: 'lines', hoverinfo: 'skip' },
    { x, y: serie, mode: 'lines', line: { color: c.d0, width: 1 }, hovertemplate: `km %{x:.2f}: %{y:.1f}<extra></extra>` },
    { x: f.mx, y: f.my, mode: 'lines', line: { color: cor, width: 2.2 }, hoverinfo: 'skip' },
  ], base(c, {
    showlegend: false, height: 170, shapes, margin: { l: 36, r: 6, t: 4, b: 22 },
    xaxis: eixo(c, { tickfont: { size: 10, color: c.mudo } }), yaxis: eixo(c, { tickfont: { size: 10, color: c.mudo } }),
    plot_bgcolor: selecionado ? hexA(c.destaque, 0.06) : ref ? hexA(c.destaque, 0.03) : 'rgba(0,0,0,0)',
  }), MINI);
}

/** nº de segmentos × penalidade, por tipo */
export function grafSegmentosPen(el, passos, alvo, iRef, iSel, aoClicar) {
  const c = cores();
  const x = passos.map((p) => p.penalidade);
  const traces = TIPOS.map((t) => ({
    x, y: passos.map((p) => ({ funcional: p.func_s, estrutural: p.estrut_s, combinada: p.comb_s }[t].length + 1)),
    mode: 'lines+markers', name: t, line: { color: corTipo(c, t), dash: TRACO[t], width: 2, shape: 'hv' }, marker: { size: 7, line: { color: c.sup, width: 1.5 } },
    hovertemplate: `penalidade %{x:.3f} · ${t}: %{y} segmentos<extra></extra>`,
  }));
  const shapes = [
    { type: 'line', xref: 'x', yref: 'paper', x0: x[iRef], x1: x[iRef], y0: 0, y1: 1, line: { color: c.destaque, width: 1.5, dash: 'dot' } },
    { type: 'line', xref: 'x', yref: 'paper', x0: x[iSel], x1: x[iSel], y0: 0, y1: 1, line: { color: c.texto, width: 1.5 } },
  ];
  const r = desenhar(el, traces, base(c, {
    shapes, margin: { l: 56, r: 12, t: 40, b: 44 }, hovermode: 'x unified',
    xaxis: eixo(c, { title: alvo === 'estrutural' ? 'penalidade estrutural' : 'quociente de penalidade funcional (α_km)', type: x.every((v) => v > 0) && x[x.length - 1] / x[0] > 20 ? 'log' : 'linear' }),
    yaxis: eixo(c, { title: 'nº de segmentos', rangemode: 'tozero' }),
  }));
  if (aoClicar) r.then((g) => { g.removeAllListeners?.('plotly_click'); g.on('plotly_click', (ev) => aoClicar(ev.points[0].pointIndex)); });
  return r;
}

/** posição das quebras em cada passo (uma linha por penalidade, de baixo para cima) */
export function grafFaixasPassos(el, a, passos, alvo, iRef, iSel, aoClicar) {
  const c = cores();
  const chave = alvo === 'estrutural' ? 'estrut_s' : 'func_s';
  const n = passos.length;
  const traces = [];
  [[chave, 'y', alvo], ['comb_s', 'y2', 'combinada']].forEach(([k, yax, nome]) => {
    passos.forEach((p, i) => traces.push({
      x: p[k].map((b) => a.ini[b]), y: p[k].map(() => i), yaxis: yax, mode: 'markers', showlegend: false,
      marker: { symbol: 'line-ns-open', size: i === iSel ? 20 : 14, color: corPasso(i, n, iRef), line: { width: i === iSel || i === iRef ? 3 : 2, color: corPasso(i, n, iRef) } },
      customdata: p[k].map(() => i), hovertemplate: `${nome} · penalidade ${num(p.penalidade, 3)}<br>quebra no km %{x:.3f}<extra></extra>`,
    }));
  });
  const ticks = (k) => passos.map((p, i) => { const t = `${num(p.penalidade, p.penalidade < 1 ? 4 : 2)} (${p[k].length + 1})`; return i === iSel ? `<b>▶ ${t}</b>` : i === iRef ? `<b>${t}</b>` : t; });
  const h = Math.max(320, Math.min(900, 120 + n * 26));
  const r = desenhar(el, traces, base(c, {
    height: h, margin: { l: 120, r: 16, t: 16, b: 44 },
    xaxis: eixo(c, { title: 'Distância linear (km)', range: [a.ini[0], a.fim[a.fim.length - 1]], anchor: 'y2' }),
    yaxis: eixo(c, { domain: [0.52, 1], tickvals: passos.map((_, i) => i), ticktext: ticks(chave), range: [-0.6, n - 0.4], title: `quebras ${alvo}` }),
    yaxis2: eixo(c, { domain: [0, 0.46], tickvals: passos.map((_, i) => i), ticktext: ticks('comb_s'), range: [-0.6, n - 0.4], title: 'quebras combinada' }),
  }));
  if (aoClicar) r.then((g) => { g.removeAllListeners?.('plotly_click'); g.on('plotly_click', (ev) => aoClicar(ev.points[0].customdata)); });
  return r;
}

/** curva genérica com marcas verticais (diagnóstico da rede, calibração) */
export function grafCurva(el, x, y, tituloX, tituloY, { marcas = [], degrau = false } = {}) {
  const c = cores();
  const traces = [{ x, y, mode: degrau ? 'lines' : 'lines+markers', line: { color: c.estrut, width: 2, shape: degrau ? 'hv' : 'linear' }, marker: { size: 4 }, showlegend: false,
    hovertemplate: `${tituloX} %{x:.4g}<br>${tituloY} %{y:.4g}<extra></extra>` }];
  const shapes = marcas.map((m) => ({ type: 'line', xref: 'x', yref: 'paper', x0: m.x, x1: m.x, y0: 0, y1: 1, line: { color: m.cor, width: 1.6, dash: m.traco || 'solid' } }));
  marcas.forEach((m) => traces.push({ x: [null], y: [null], mode: 'lines', line: { color: m.cor, width: 2, dash: m.traco || 'solid' }, name: m.rotulo, hoverinfo: 'skip' }));
  return desenhar(el, traces, base(c, { shapes, margin: { l: 64, r: 12, t: 40, b: 44 }, xaxis: eixo(c, { title: tituloX }), yaxis: eixo(c, { title: tituloY }) }));
}

/** tabela de candidatos do funcional (penalidade × BIC) */
export function grafBicFuncional(el, cand, penEscolhida) {
  const c = cores();
  return desenhar(el, [
    { x: cand.map((k) => k.pen), y: cand.map((k) => k.bic), mode: 'lines+markers', line: { color: c.func, width: 2 }, marker: { size: 7 },
      customdata: cand.map((k) => k.quebras.length), hovertemplate: 'penalidade %{x:.3f}<br>BIC %{y:.2f}<br>%{customdata} quebras<extra></extra>', showlegend: false },
  ], base(c, {
    margin: { l: 60, r: 12, t: 12, b: 44 },
    shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: penEscolhida, x1: penEscolhida, y0: 0, y1: 1, line: { color: c.destaque, width: 1.6 } }],
    xaxis: eixo(c, { title: 'penalidade candidata (funcional)' }), yaxis: eixo(c, { title: 'BIC' }),
  }));
}

export { km };
