// Gráficos "limpos" da segmentação, na ordem de leitura Funcional → Estrutural → Resultado:
// um sinal por gráfico, segmentos como faixas de fundo alternadas (sem linhas verticais cheias),
// média (ou reta) do segmento em destaque e uma régua de segmentos colorida pela classe de condição.
import { cssVar, FONTE_UI, FONTE_MONO, num, km, esc, classificar } from './util.js';
import { media, desvio } from './estatistica.js';
import { SINAIS_FUNC, SINAIS_ESTRUT } from './modelo.js';

const CONFIG = { displaylogo: false, responsive: true, locale: 'pt-BR', modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines'] };
const UN = { igg: '', iri: ' m/km', d0: ' (0,01 mm)', raio: ' m', aca: '' };
const CASAS = { igg: 1, iri: 2, d0: 1, raio: 0, aca: 0 };

function tema() {
  return { texto: cssVar('--texto'), texto2: cssVar('--texto-2'), mudo: cssVar('--texto-mudo'), grade: cssVar('--grade'), eixo: cssVar('--eixo'),
    sup: cssVar('--superficie'), sup2: cssVar('--superficie-2'), destaque: cssVar('--destaque'), func: '#7c3aed', estrut: cssVar('--s-estrut'), sinal: cssVar('--texto-mudo') };
}
const hexA = (hex, a) => { const h = hex.replace('#', ''); return h.length === 6 ? `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})` : hex; };
const fonte = FONTE_UI;

/** limites [lo, hi) de cada segmento em índices e km */
export function segmentos(a, quebras) {
  const N = a.ini.length, lim = [0, ...quebras, N];
  return lim.slice(0, -1).map((lo, i) => {
    const hi = lim[i + 1];
    return { lo, hi, k0: a.ini[lo], k1: hi < N ? a.ini[hi] : a.fim[N - 1] };
  });
}

/** % da grade de penalidades em que cada quebra (km) aparece a ≤ tol km */
export function robustez(quebrasKm, passosKm, tol = 0.4) {
  if (!passosKm.length) return quebrasKm.map(() => null);
  return quebrasKm.map((k) => passosKm.filter((lst) => lst.some((x) => Math.abs(x - k) <= tol)).length / passosKm.length);
}

/** um sinal com a segmentação. modo 'media' (média ± desvio) ou 'reta' (reta ajustada, para a ACA) */
export function grafSinal(el, a, chave, quebras, { titulo = '', modo = 'media', cor = null, rob = null, altura = 300, serie = null, outras = null, corOutras = '#7c3aed' } = {}) {
  const c = tema();
  const y = serie || a[chave];
  const x = a.ini.map((v, i) => 0.5 * (v + a.fim[i]));
  const segs = segmentos(a, quebras);
  const cr = cor || c.estrut;
  const shapes = segs.map((s, i) => ({ type: 'rect', xref: 'x', yref: 'paper', x0: s.k0, x1: s.k1, y0: 0, y1: 1, fillcolor: i % 2 ? hexA(cr, 0.07) : 'rgba(0,0,0,0)', line: { width: 0 }, layer: 'below' }));
  // fronteiras: linha vertical fina na cor do gráfico (a mesma cor aparece no gráfico unido)
  quebras.forEach((b) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1, line: { color: cr, width: 1.2, dash: 'dot' }, opacity: 0.8 }));
  // fronteiras de outra segmentação (as funcionais no gráfico estrutural), só como referência
  (outras || []).forEach((b) => shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: a.ini[b], x1: a.ini[b], y0: 0, y1: 1, line: { color: corOutras, width: 1.2, dash: 'dot' }, opacity: 0.8 }));
  const mx = [], my = [], cd = [], bx = [], by = [];
  segs.forEach((s, i) => {
    const v = y.slice(s.lo, s.hi).filter(Number.isFinite);
    if (!v.length) return;
    if (modo === 'reta' && v.length > 1) {
      const xs = x.slice(s.lo, s.hi), xm = media(xs), ym = media(v);
      let sxy = 0, sxx = 0;
      xs.forEach((xi, j) => { sxy += (xi - xm) * (v[j] - ym); sxx += (xi - xm) ** 2; });
      const b = sxx > 0 ? sxy / sxx : 0;
      mx.push(s.k0, s.k1, null); my.push(ym + b * (s.k0 - xm), ym + b * (s.k1 - xm), null);
      cd.push([i + 1, b, s.k1 - s.k0], [i + 1, b, s.k1 - s.k0], null);
    } else {
      const m = media(v), sd = v.length > 1 ? desvio(v, 1) : 0;
      mx.push(s.k0, s.k1, null); my.push(m, m, null); cd.push([i + 1, sd, s.k1 - s.k0], [i + 1, sd, s.k1 - s.k0], null);
      bx.push(s.k0, s.k1, s.k1, s.k0, s.k0, null); by.push(m + sd, m + sd, m - sd, m - sd, m + sd, null);
    }
  });
  const un = UN[chave] ?? '', cs = CASAS[chave] ?? 1;
  const traces = [];
  if (bx.length) traces.push({ x: bx, y: by, fill: 'toself', fillcolor: hexA(cr, 0.12), line: { width: 0 }, mode: 'lines', hoverinfo: 'skip', showlegend: false });
  if (outras && outras.length) traces.push({ x: [null], y: [null], mode: 'lines', name: 'fronteira funcional', line: { color: corOutras, dash: 'dot', width: 1.5 }, hoverinfo: 'skip' });
  traces.push({ x, y, mode: 'lines', line: { color: c.sinal, width: 0.9 }, opacity: 0.75, name: 'a cada 200 m', hovertemplate: `km %{x:.2f}: %{y:.${cs}f}${un}<extra></extra>` });
  traces.push({ x: mx, y: my, mode: 'lines', line: { color: cr, width: 3 }, customdata: cd, name: modo === 'reta' ? 'tendência do segmento' : 'média do segmento',
    hovertemplate: modo === 'reta' ? 'segmento %{customdata[0]}<br>%{customdata[2]:.2f} km<extra></extra>' : `segmento %{customdata[0]}: média %{y:.${cs}f}${un}<br>desvio %{customdata[1]:.${cs}f} · %{customdata[2]:.2f} km<extra></extra>` });
  // quebras: pequenos marcadores no topo; a opacidade mostra a robustez
  if (quebras.length) {
    const topo = Math.max(...y.filter(Number.isFinite));
    traces.push({ x: quebras.map((b) => a.ini[b]), y: quebras.map(() => topo), mode: 'markers', showlegend: false,
      marker: { symbol: 'triangle-down', size: 10, color: cr, opacity: rob ? rob.map((r) => (r === null ? 0.9 : 0.3 + 0.7 * r)) : 0.9, line: { width: 0 } },
      customdata: quebras.map((_, i) => (rob && rob[i] !== null ? `${Math.round(100 * rob[i])}%` : '—')),
      hovertemplate: 'quebra no km %{x:.2f}<br>robustez %{customdata} das penalidades<extra></extra>' });
  }
  return Plotly.react(typeof el === 'string' ? document.getElementById(el) : el, traces, {
    height: altura, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', separators: ',.', hovermode: 'closest', shapes,
    font: { family: fonte, color: c.texto, size: 12 },
    title: titulo ? { text: titulo, x: 0, xanchor: 'left', font: { size: 14, color: c.texto } } : undefined,
    margin: { l: 56, r: 12, t: titulo ? 40 : 12, b: 36 },
    legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.08, font: { size: 11, color: c.mudo } },
    xaxis: { title: { text: 'km', font: { size: 11, color: c.mudo } }, gridcolor: c.grade, linecolor: c.eixo, tickfont: { family: FONTE_MONO, color: c.mudo, size: 11 }, zeroline: false },
    yaxis: { gridcolor: c.grade, linecolor: c.eixo, tickfont: { family: FONTE_MONO, color: c.mudo, size: 11 }, zeroline: false, title: { text: titulo ? '' : chave, font: { size: 11, color: c.mudo } } },
  }, CONFIG);
}

/** gráfico unido: funcional (eixo esquerdo) e estrutural (eixo direito) com as fronteiras das duas
 *  segmentações. Fronteiras das duas a até tol km viram uma linha única "coincidente". */
export function grafUnido(el, a, r, { tol = 0.4, altura = 320 } = {}) {
  const c = tema();
  const cfg = r.cfg;
  const corF = '#7c3aed', corE = c.estrut, corC = c.texto;
  const x = a.ini.map((v, i) => 0.5 * (v + a.fim[i]));
  // as linhas cheias são exatamente as fronteiras do resultado (gráfico 4), classificadas pela origem;
  // fronteiras funcionais/estruturais que a regra de 1 km descartou ficam só como traço cinza claro
  const kmF = r.func_s.map((b) => a.ini[b]), kmE = r.estrut_s.map((b) => a.ini[b]);
  const kmR = r.comb_s.map((b) => a.ini[b]);
  const perto = (lst, k, d) => lst.some((v) => Math.abs(v - k) <= d);
  const coinc = [], soF = [], soE = [], div = [];
  kmR.forEach((k) => {
    const f = perto(kmF, k, tol), e = perto(kmE, k, 1e-6);
    if (f && e) coinc.push(k); else if (e) soE.push(k); else if (perto(kmF, k, 1e-6)) soF.push(k); else div.push(k);
  });
  const descart = [...kmF, ...kmE].filter((k) => !perto(kmR, k, 1e-6) && !(perto(kmF, k, 1e-6) && perto(kmR, k, tol) && perto(kmE, k, tol)));
  const medias = (serie, quebras) => {
    const mx = [], my = [];
    segmentos(a, quebras).forEach((s) => {
      const v = serie.slice(s.lo, s.hi).filter(Number.isFinite);
      if (v.length) { const m = media(v); mx.push(s.k0, s.k1, null); my.push(m, m, null); }
    });
    return { mx, my };
  };
  const serieE = cfg.estrut === 'aca' ? a.d0 : a[cfg.estrut];
  const chaveE = cfg.estrut === 'aca' ? 'd0' : cfg.estrut;
  const mF = medias(a[cfg.func], r.func_s), mE = medias(serieE, r.estrut_s);
  const nomeF = SINAIS_FUNC[cfg.func], nomeE = cfg.estrut === 'aca' ? 'D0' : SINAIS_ESTRUT[cfg.estrut].split(' (')[0];
  const shapes = segmentos(a, r.comb_s).map((s, i) => ({ type: 'rect', xref: 'x', yref: 'paper', x0: s.k0, x1: s.k1, y0: 0, y1: 1,
    fillcolor: i % 2 ? hexA(c.texto, 0.05) : 'rgba(0,0,0,0)', line: { width: 0 }, layer: 'below' }));
  const vline = (k, cor, dash, w) => ({ type: 'line', xref: 'x', yref: 'paper', x0: k, x1: k, y0: 0, y1: 1, line: { color: cor, width: w, dash } });
  descart.forEach((k) => shapes.push(vline(k, hexA(c.mudo, 0.55), 'dot', 1)));
  soF.forEach((k) => shapes.push(vline(k, corF, 'solid', 1.8)));
  soE.forEach((k) => shapes.push(vline(k, corE, 'solid', 1.8)));
  div.forEach((k) => shapes.push(vline(k, c.mudo, 'dash', 1.8)));
  coinc.forEach((k) => shapes.push(vline(k, corC, 'solid', 2.2)));
  const leg = (nome, cor, dash, w) => ({ x: [null], y: [null], mode: 'lines', name: nome, line: { color: cor, dash, width: w }, hoverinfo: 'skip' });
  const traces = [
    { x, y: a[cfg.func], mode: 'lines', name: nomeF, line: { color: hexA(corF, 0.45), width: 0.9 }, hovertemplate: `km %{x:.2f}: ${nomeF} %{y:.2f}<extra></extra>` },
    { x: mF.mx, y: mF.my, mode: 'lines', name: `média ${nomeF}`, line: { color: corF, width: 2.6 }, hoverinfo: 'skip' },
    { x, y: serieE, yaxis: 'y2', mode: 'lines', name: nomeE, line: { color: hexA(corE, 0.45), width: 0.9 }, hovertemplate: `km %{x:.2f}: ${nomeE} %{y:.1f}<extra></extra>` },
    { x: mE.mx, y: mE.my, yaxis: 'y2', mode: 'lines', name: `média ${nomeE}`, line: { color: corE, width: 2.6 }, hoverinfo: 'skip' },
    leg(`fronteira funcional (${soF.length})`, corF, 'solid', 1.8), leg(`fronteira estrutural (${soE.length})`, corE, 'solid', 1.8), leg(`coincidente (${coinc.length})`, corC, 'solid', 2.2),
    ...(div.length ? [leg(`divisão por 20 km (${div.length})`, c.mudo, 'dash', 1.8)] : []),
    ...(descart.length ? [leg(`descartada: segmento < 1 km (${descart.length})`, hexA(c.mudo, 0.55), 'dot', 1)] : []),
  ];
  return Plotly.react(typeof el === 'string' ? document.getElementById(el) : el, traces, {
    height: altura, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', separators: ',.', hovermode: 'x unified', shapes,
    font: { family: fonte, color: c.texto, size: 12 },
    margin: { l: 56, r: 60, t: 34, b: 36 },
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 11, color: c.mudo } },
    xaxis: { title: { text: 'km', font: { size: 11, color: c.mudo } }, gridcolor: c.grade, linecolor: c.eixo, tickfont: { family: FONTE_MONO, color: c.mudo, size: 11 }, zeroline: false },
    yaxis: { title: { text: nomeF + (UN[cfg.func] || ''), font: { size: 11, color: corF } }, gridcolor: c.grade, tickfont: { family: FONTE_MONO, color: corF, size: 11 }, zeroline: false, rangemode: 'tozero' },
    yaxis2: { title: { text: nomeE + (UN[chaveE] || ''), font: { size: 11, color: corE } }, overlaying: 'y', side: 'right', showgrid: false, tickfont: { family: FONTE_MONO, color: corE, size: 11 }, zeroline: false },
  }, CONFIG);
}

// classe de um valor; o raio não tem tabela de classes: usa a do d0 do mesmo trecho
const classeDe = (limites, param, v) => classificar(limites, param, v);

/** linhas da régua: segmentos funcionais, estruturais e o resultado (funcional + estrutural) com a classe limitante */
export function tabelaRegua(a, r, limites) {
  const cfg = r.cfg;
  const pf = cfg.func;   // igg ou iri têm classes
  const mediaDe = (serie, s) => { const v = serie.slice(s.lo, s.hi).filter(Number.isFinite); return v.length ? media(v) : null; };
  const ordem = ['Ótimo', 'Bom', 'Regular', 'Ruim', 'Péssimo'];
  const pior = (x, y) => (ordem.indexOf(x.classe) >= ordem.indexOf(y.classe) ? x : y);
  const linha = (quebras, tipo) => segmentos(a, quebras).map((s, i) => {
    const mf = mediaDe(a[pf], s), md0 = mediaDe(a.d0, s), mr = a.raio ? mediaDe(a.raio, s) : null;
    const cf = classeDe(limites, pf, mf), cd = classeDe(limites, 'd0', md0);
    const lim = cf.classe === 'Sem dado' ? cd : cd.classe === 'Sem dado' ? cf : pior(cf, cd);
    return { tipo, seg: i + 1, ...s, ext: s.k1 - s.k0, mf, md0, mr, cf, cd, lim };
  });
  return { funcional: linha(r.func_s, 'funcional'), estrutural: linha(r.estrut_s, 'estrutural'), combinada: linha(r.comb_s, 'combinada') };
}

/** régua de segmentos: 3 faixas horizontais (funcional, estrutural, resultado) coloridas pela classe */
export function grafRegua(el, a, r, limites, { titulo = '' } = {}) {
  const c = tema();
  const t = tabelaRegua(a, r, limites);
  const cfg = r.cfg;
  const rotF = `Funcional (${SINAIS_FUNC[cfg.func]})`, rotE = 'Estrutural (classe pelo D0)', rotC = 'Funcional + estrutural';
  const traco = (lst, rot, campo) => ({
    type: 'bar', orientation: 'h', y: lst.map(() => rot), x: lst.map((s) => s.ext), base: lst.map((s) => s.k0),
    marker: { color: lst.map((s) => s[campo].cor), line: { color: c.sup, width: 2 } },
    text: lst.map((s) => (s.ext > 0.9 ? String(s.seg) : '')), textposition: 'inside', insidetextanchor: 'middle', textfont: { color: '#fff', size: 11 },
    customdata: lst.map((s) => [s.seg, km(s.k0), km(s.k1), num(s.ext, 2), num(s.mf, cfg.func === 'iri' ? 2 : 1), num(s.md0, 1), s[campo].classe, s.mr === null ? '—' : num(s.mr, 0)]),
    hovertemplate: `<b>${rot} · segmento %{customdata[0]}</b><br>km %{customdata[1]} – %{customdata[2]} (%{customdata[3]} km)<br>${SINAIS_FUNC[cfg.func]} %{customdata[4]} · D0 %{customdata[5]} · raio %{customdata[7]} m<br>classe: %{customdata[6]}<extra></extra>`,
    showlegend: false,
  });
  return Plotly.react(typeof el === 'string' ? document.getElementById(el) : el, [
    traco(t.combinada, rotC, 'lim'), traco(t.estrutural, rotE, 'cd'), traco(t.funcional, rotF, 'cf'),
  ], {
    height: 190, barmode: 'overlay', bargap: 0.35, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', separators: ',.',
    font: { family: fonte, color: c.texto, size: 12 },
    title: titulo ? { text: titulo, x: 0, xanchor: 'left', font: { size: 14 } } : undefined,
    margin: { l: 150, r: 12, t: titulo ? 36 : 8, b: 30 },
    xaxis: { range: [a.ini[0], a.fim[a.fim.length - 1]], gridcolor: c.grade, tickfont: { family: FONTE_MONO, color: c.mudo, size: 11 }, title: { text: 'km', font: { size: 11, color: c.mudo } } },
    yaxis: { tickfont: { color: c.texto2, size: 12 }, categoryorder: 'array', categoryarray: [rotC, rotE, rotF], fixedrange: true },
  }, CONFIG);
}

/** insights do passo: frase-resumo, coincidência e trechos críticos (HTML) */
export function insights(a, r, limites, { robE = null, robF = null, sre = '' } = {}) {
  const t = tabelaRegua(a, r, limites);
  const cfg = r.cfg;
  const qe = r.estrut_km, qf = r.func_km;
  const coinc = qe.length ? qe.filter((k) => qf.some((f) => Math.abs(f - k) <= 0.4)).length / qe.length : null;
  const frases = [];
  frases.push(`<strong>${t.combinada.length} segmentos</strong> em funcional + estrutural (${t.funcional.length} funcionais por ${SINAIS_FUNC[cfg.func]}, ${t.estrutural.length} estruturais por ${SINAIS_ESTRUT[cfg.estrut]}).`);
  if (robE && qe.length) {
    let j = 0; robE.forEach((v, i) => { if ((v ?? -1) > (robE[j] ?? -1)) j = i; });
    let w = 0; robE.forEach((v, i) => { if ((v ?? 2) < (robE[w] ?? 2)) w = i; });
    frases.push(`A quebra estrutural mais firme é a do <strong>km ${num(qe[j], 1)}</strong> (aparece em ${Math.round(100 * robE[j])}% das penalidades)`
      + (qe.length > 1 && robE[w] < 0.5 ? `; a do km ${num(qe[w], 1)} é frágil (${Math.round(100 * robE[w])}%) e depende da penalidade escolhida.` : '.'));
  }
  if (coinc !== null) frases.push(`${Math.round(100 * coinc)}% das quebras estruturais ficam a até 0,4 km de uma funcional: ${coinc >= 0.5 ? 'superfície e estrutura mudam juntas na maior parte do trecho' : 'estrutura e superfície mudam em lugares diferentes'}.`);
  const ord = ['Ótimo', 'Bom', 'Regular', 'Ruim', 'Péssimo'];
  const criticos = [...t.combinada].filter((s) => s.lim.classe !== 'Sem dado').sort((x, y) => ord.indexOf(y.lim.classe) - ord.indexOf(x.lim.classe) || (y.md0 ?? 0) - (x.md0 ?? 0)).slice(0, 3);
  const cartoes = criticos.map((s) => `<li class="critico"><span class="selo" style="background:${s.lim.cor}">${esc(s.lim.classe)}</span>
    <strong>km ${km(s.k0)} – ${km(s.k1)}</strong> <span>${num(s.ext, 2)} km · ${SINAIS_FUNC[cfg.func]} ${num(s.mf, cfg.func === 'iri' ? 2 : 1)} (${esc(s.cf.classe)}) · D0 ${num(s.md0, 1)} (${esc(s.cd.classe)})${s.mr !== null ? ` · raio ${num(s.mr, 0)} m` : ''}</span></li>`).join('');
  return `<div class="insights"><p>${frases.join(' ')}</p>${cartoes ? `<h4>Trechos críticos (pior classe limitante)</h4><ul class="criticos">${cartoes}</ul>` : ''}</div>`;
}
