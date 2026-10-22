// Gráficos (Plotly). Cores e tinta vêm dos tokens CSS, então seguem o tema claro/escuro.
import { cssVar, num, km, fatorTxt, qnorm, TIPOS, NOMES_PARAM, UNIDADES, classesDe } from './util.js';

const CONFIG_PLOTLY = {
  displaylogo: false, responsive: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines'],
  locale: 'pt-BR',
};
const RAMPA_FATOR = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#104281', '#0d366b'];
const ORDEM_CLASSES = ['Ótimo', 'Bom', 'Regular', 'Ruim', 'Péssimo', 'Sem dado'];

function cores() {
  return {
    texto: cssVar('--texto'), texto2: cssVar('--texto-2'), mudo: cssVar('--texto-mudo'), grade: cssVar('--grade'),
    eixo: cssVar('--eixo'), sup: cssVar('--superficie'), destaque: cssVar('--destaque'),
    func: cssVar('--s-func'), estrut: cssVar('--s-estrut'), comb: cssVar('--s-comb'), d0: cssVar('--s-d0'),
  };
}
const corTipo = (c, t) => ({ funcional: c.func, estrutural: c.estrut, combinada: c.comb }[t]);
const tracoTipo = { funcional: 'dash', estrutural: 'dot', combinada: 'solid' };

export function corFator(fatores, i, iRef) {
  if (i === iRef) return cssVar('--destaque');
  const n = fatores.length;
  return RAMPA_FATOR[Math.round((i / Math.max(n - 1, 1)) * (RAMPA_FATOR.length - 1))];
}

function eixo(c, extra = {}) {
  return {
    gridcolor: c.grade, linecolor: c.eixo, zerolinecolor: c.eixo, tickfont: { color: c.mudo, size: 11 },
    title: { font: { color: c.texto2, size: 12 } }, automargin: true, ...extra,
    ...(extra.title && typeof extra.title === 'string' ? { title: { text: extra.title, font: { color: c.texto2, size: 12 } } } : {}),
  };
}

function base(c, extra = {}) {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: '"Schibsted Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: c.texto, size: 12 },
    margin: { l: 56, r: 16, t: 16, b: 44 },
    hoverlabel: { bgcolor: c.sup, bordercolor: c.eixo, font: { color: c.texto } },
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { color: c.texto2, size: 12 }, bgcolor: 'rgba(0,0,0,0)' },
    hovermode: 'closest', separators: ',.',
    ...extra,
  };
}

function desenhar(el, traces, layout) {
  const alvo = typeof el === 'string' ? document.getElementById(el) : el;
  return Plotly.react(alvo, traces, layout, CONFIG_PLOTLY);
}

// ── Painel: barras empilhadas de % da extensão por classe ─────────────────────
function barrasClasses(el, linhas, rotulos, limites, params, altura) {
  const c = cores();
  const corDe = {};
  limites.forEach((l) => { corDe[l.classe] = l.cor; });
  const tot = linhas.map((r) => Object.values(r).reduce((a, b) => a + b, 0) || 1);
  const traces = ORDEM_CLASSES.filter((k) => linhas.some((r) => r[k])).map((k) => ({
    type: 'bar', orientation: 'h', name: k, y: rotulos, x: linhas.map((r, i) => (100 * (r[k] || 0)) / tot[i]),
    customdata: linhas.map((r, i) => [r[k] || 0, params[i]]),
    marker: { color: corDe[k], line: { color: c.sup, width: 2 } },
    hovertemplate: `%{y} · ${k}: %{x:.1f}% (%{customdata[0]:,.0f} km)<extra></extra>`,
  }));
  return desenhar(el, traces, base(c, {
    barmode: 'stack', bargap: 0.45, showlegend: false, height: altura,
    margin: { l: 70, r: 12, t: 6, b: 30 },
    xaxis: eixo(c, { range: [0, 100], ticksuffix: '%', dtick: 20, fixedrange: true }),
    yaxis: eixo(c, { autorange: 'reversed', fixedrange: true, gridcolor: 'rgba(0,0,0,0)', tickfont: { color: c.texto, size: 12 } }),
  }));
}

function porClasse(resumo, param, regional) {
  const r = {};
  resumo.filter((x) => x.parametro === param && x.regional === regional).forEach((x) => { r[x.classe] = x.km; });
  return r;
}

export function grafParametros(el, resumo, limites) {
  const params = ['iri', 'd0', 'igg'];
  const rot = { iri: 'IRI', d0: 'Deflexão', igg: 'IGG' };
  return barrasClasses(el, params.map((p) => porClasse(resumo, p, 0)), params.map((p) => rot[p]), limites, params, 190);
}

export function grafRegional(el, resumo, limites, param) {
  const regs = [...new Set(resumo.filter((x) => x.regional > 0).map((x) => x.regional))].sort((a, b) => a - b);
  return barrasClasses(el, regs.map((g) => porClasse(resumo, param, g)), regs.map((g) => `Regional ${g}`), limites,
    regs.map(() => param), Math.max(200, regs.length * 34 + 40));
}

export function legendaClasses(limites) {
  const vistos = new Map();
  limites.forEach((l) => { if (!vistos.has(l.classe)) vistos.set(l.classe, l.cor); });
  return ORDEM_CLASSES.filter((k) => vistos.has(k)).map((k) => `<span><i style="background:${vistos.get(k)}"></i>${k}</span>`).join('');
}

// ── SRE: perfil longitudinal (d0 + médias por segmento estrutural, ACA, IGG, IRI) ──
export function grafPerfil(el, pac, fator) {
  const c = cores();
  const iv = pac.intervalos;
  const x = iv.map((i) => (i.km_inicial + i.km_final) / 2);
  const segs = pac.segmentos.filter((s) => s.fator === fator && s.tipo === 'estrutural');
  const quebras = {};
  TIPOS.forEach((t) => { quebras[t] = (pac.sens_fator.find((f) => f.fator === fator && f.tipo === t) || { quebras_km: [] }).quebras_km; });

  // média ± 1 desvio por segmento estrutural (Biswas & Kuna, Fig. 10)
  const mx = [], my = [], bx = [], by = [], mcd = [];
  segs.forEach((s) => {
    if (s.d0_medio === null) return;
    const sd = s.d0_desvio || 0;
    mx.push(s.km_inicial, s.km_final, null); my.push(s.d0_medio, s.d0_medio, null);
    mcd.push([s.seg_id, sd, s.comprimento_km], [s.seg_id, sd, s.comprimento_km], null);
    bx.push(s.km_inicial, s.km_final, s.km_final, s.km_inicial, s.km_inicial, null);
    by.push(s.d0_medio + sd, s.d0_medio + sd, s.d0_medio - sd, s.d0_medio - sd, s.d0_medio + sd, null);
  });
  const interp = iv.filter((i) => !i.d0_obs);
  const ud0 = UNIDADES.d0;
  const traces = [
    { x: bx, y: by, fill: 'toself', fillcolor: hexA(c.estrut, 0.15), line: { width: 0 }, mode: 'lines', hoverinfo: 'skip', showlegend: false, xaxis: 'x', yaxis: 'y' },
    { x, y: iv.map((i) => i.d0), mode: 'lines', name: 'd0', line: { color: c.d0, width: 1.4 }, xaxis: 'x', yaxis: 'y',
      hovertemplate: `km %{x:.3f}<br>d0 %{y:.1f} ${ud0}<extra></extra>` },
    { x: interp.map((i) => (i.km_inicial + i.km_final) / 2), y: interp.map((i) => i.d0), mode: 'markers', name: 'd0 interpolado',
      marker: { color: c.sup, size: 6, line: { color: c.mudo, width: 1.2 } }, xaxis: 'x', yaxis: 'y',
      hovertemplate: 'km %{x:.3f}<br>d0 interpolado %{y:.1f}<extra></extra>' },
    { x: mx, y: my, mode: 'lines', name: 'média ± desvio por segmento estrutural', line: { color: c.estrut, width: 2.5 }, customdata: mcd, xaxis: 'x', yaxis: 'y',
      hovertemplate: 'segmento %{customdata[0]}<br>média %{y:.1f} ± %{customdata[1]:.1f}<br>%{customdata[2]:.2f} km<extra></extra>' },
    { x, y: iv.map((i) => i.aca), mode: 'lines', name: 'ACA', showlegend: false, line: { color: '#b8860b', width: 1.4 }, xaxis: 'x', yaxis: 'y2',
      hovertemplate: 'km %{x:.3f}<br>ACA %{y:.1f}<extra></extra>' },
    { x, y: iv.map((i) => i.igg), mode: 'lines', name: 'IGG', showlegend: false, line: { color: '#6250d6', width: 1.3 }, xaxis: 'x', yaxis: 'y3',
      hovertemplate: 'km %{x:.3f}<br>IGG %{y:.1f}<extra></extra>' },
    { x, y: iv.map((i) => i.iri), mode: 'lines', name: 'IRI', showlegend: false, line: { color: '#2e7d32', width: 1.3 }, xaxis: 'x', yaxis: 'y4',
      hovertemplate: 'km %{x:.3f}<br>IRI %{y:.2f} m/km<extra></extra>' },
  ];
  // entradas de legenda para as quebras (as linhas são shapes)
  TIPOS.forEach((t) => traces.push({ x: [null], y: [null], mode: 'lines', name: `Quebras ${t} (${quebras[t].length})`,
    line: { color: corTipo(c, t), dash: tracoTipo[t], width: 2 }, xaxis: 'x', yaxis: 'y', hoverinfo: 'skip' }));

  const shapes = [];
  TIPOS.forEach((t) => quebras[t].forEach((k) => shapes.push({
    type: 'line', xref: 'x', yref: 'paper', x0: k, x1: k, y0: 0, y1: 1,
    line: { color: corTipo(c, t), dash: tracoTipo[t], width: t === 'combinada' ? 1.6 : 1.3 }, opacity: 0.85, layer: 'above',
  })));

  const dom = [[0.62, 1], [0.43, 0.58], [0.22, 0.39], [0, 0.18]];
  const layout = base(c, {
    margin: { l: 64, r: 16, t: 54, b: 44 }, shapes, hovermode: 'x unified',
    legend: { orientation: 'h', x: 0, y: 1.0, yanchor: 'bottom', font: { color: c.texto2, size: 12 }, bgcolor: 'rgba(0,0,0,0)' },
    xaxis: eixo(c, { title: 'Distância linear (km)', anchor: 'y4', showspikes: true, spikecolor: c.mudo, spikethickness: 1 }),
    yaxis: eixo(c, { domain: dom[0], title: `d0 (${ud0})` }),
    yaxis2: eixo(c, { domain: dom[1], title: 'ACA (ref. CDA)' }),
    yaxis3: eixo(c, { domain: dom[2], title: 'IGG', rangemode: 'tozero' }),
    yaxis4: eixo(c, { domain: dom[3], title: 'IRI (m/km)', rangemode: 'tozero' }),
  });
  return desenhar(el, traces, layout);
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// ── SRE: caminho CROPS (nº de quebras ótimo × penalidade) ────────────────────
export function grafCrops(el, crops, betaMin, marcas, faixa) {
  const c = cores();
  if (!crops.length || crops.length < 2) return vazio(el, 'Sem caminho CROPS (SRE sem d0 suficiente).');
  const ord = [...crops].sort((a, b) => a.beta_inf - b.beta_inf);
  const zero = ord.find((r) => r.k_quebras === 0);
  const bMax = Math.max(...[(zero ? zero.beta_inf : ord[ord.length - 1].beta_inf) * 1.15, betaMin + 1, ...marcas.map((m) => m.beta * 1.05)]);
  const xs = [], ys = [];
  ord.forEach((r) => { xs.push(Math.max(r.beta_inf, betaMin)); ys.push(r.k_quebras); });
  xs.push(bMax); ys.push(ys[ys.length - 1]);
  const traces = [
    { x: xs, y: ys, mode: 'lines', line: { shape: 'hv', color: c.estrut, width: 2 }, name: 'K ótimo', showlegend: false,
      hovertemplate: 'penalidade ≥ %{x:.2f}: %{y} quebras<extra></extra>' },
    { x: ord.filter((r) => r.k_quebras > 0).map((r) => r.beta_inf), y: ord.filter((r) => r.k_quebras > 0).map((r) => r.k_quebras), mode: 'markers',
      marker: { color: c.estrut, size: 8, line: { color: c.sup, width: 2 } }, showlegend: false,
      customdata: ord.filter((r) => r.k_quebras > 0).map((r) => [r.beta_sup]),
      hovertemplate: '%{y} quebras ótimas para penalidade entre %{x:.2f} e %{customdata[0]:.2f}<extra></extra>' },
  ];
  const shapes = [];
  if (faixa) {
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: faixa.inf, x1: faixa.sup ?? bMax, y0: 0, y1: 1, fillcolor: hexA(c.destaque, 0.13), line: { width: 0 }, layer: 'below' });
    traces.push({ x: [null], y: [null], mode: 'lines', line: { color: hexA(c.destaque, 0.35), width: 10 }, name: faixa.rotulo, hoverinfo: 'skip' });
  }
  marcas.forEach((m) => {
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: m.beta, x1: m.beta, y0: 0, y1: 1, line: { color: m.cor, width: m.largura || 1.5, dash: m.traco || 'solid' } });
    if (m.rotulo) traces.push({ x: [null], y: [null], mode: 'lines', line: { color: m.cor, width: m.largura || 1.5, dash: m.traco || 'solid' }, name: m.rotulo, hoverinfo: 'skip' });
  });
  return desenhar(el, traces, base(c, {
    shapes, margin: { l: 52, r: 12, t: 40, b: 44 },
    xaxis: eixo(c, { title: 'penalidade', range: [betaMin, bMax] }),
    yaxis: eixo(c, { title: 'nº de quebras', rangemode: 'tozero' }),
  }));
}

export function grafQQ(el, z) {
  const c = cores();
  if (z.length < 3) return vazio(el, 'Resíduos insuficientes para o Q-Q.');
  const ord = [...z].sort((a, b) => a - b);
  const n = ord.length;
  const teor = ord.map((_, i) => qnorm((i + 1 - 0.5) / n));
  const lim = Math.max(3, Math.ceil(Math.max(...teor.map(Math.abs), ...ord.map(Math.abs))));
  return desenhar(el, [
    { x: [-lim, lim], y: [-lim, lim], mode: 'lines', line: { color: c.comb, width: 1.5, dash: 'dash' }, name: 'N(0,1)', hoverinfo: 'skip' },
    { x: teor, y: ord, mode: 'markers', marker: { color: c.estrut, size: 7, opacity: 0.8, line: { color: c.sup, width: 1 } }, name: 'resíduos z',
      hovertemplate: 'teórico %{x:.2f}<br>observado %{y:.2f}<extra></extra>' },
  ], base(c, {
    margin: { l: 52, r: 12, t: 40, b: 44 },
    xaxis: eixo(c, { title: 'quantis teóricos N(0,1)', range: [-lim, lim] }),
    yaxis: eixo(c, { title: 'resíduo padronizado z', range: [-lim, lim] }),
  }));
}

// ── SRE: sensibilidade ───────────────────────────────────────────────────────
export function grafFaixas(el, pac, fatores, iRef) {
  const c = cores();
  const traces = [];
  const linhas = [['estrutural', 'y'], ['combinada', 'y2']];
  linhas.forEach(([tipo, yax]) => {
    fatores.forEach((f, i) => {
      const r = pac.sens_fator.find((s) => s.fator === f && s.tipo === tipo);
      if (!r) return;
      traces.push({
        x: r.quebras_km, y: r.quebras_km.map(() => i), mode: 'markers', yaxis: yax, showlegend: false,
        marker: { symbol: 'line-ns-open', size: i === iRef ? 20 : 15, color: corFator(fatores, i, iRef), line: { width: i === iRef ? 3 : 2, color: corFator(fatores, i, iRef) } },
        hovertemplate: `${tipo} · ${fatorTxt(f)}<br>quebra no km %{x:.3f}<extra></extra>`,
      });
    });
  });
  const ticks = (tipo) => fatores.map((f, i) => {
    const r = pac.sens_fator.find((s) => s.fator === f && s.tipo === tipo);
    const t = `${fatorTxt(f)} (${r ? r.n_segmentos : '—'} seg)`;
    return i === iRef ? `<b>${t}</b>` : t;
  });
  const kmIni = pac.sre.km_inicial, kmFim = pac.sre.km_final;
  return desenhar(el, traces, base(c, {
    margin: { l: 110, r: 16, t: 16, b: 44 },
    xaxis: eixo(c, { title: 'Distância linear (km)', range: [kmIni, kmFim], anchor: 'y2' }),
    yaxis: eixo(c, { domain: [0.54, 1], tickvals: fatores.map((_, i) => i), ticktext: ticks('estrutural'), range: [-0.6, fatores.length - 0.4],
      title: 'estrutural', gridcolor: c.grade }),
    yaxis2: eixo(c, { domain: [0, 0.46], tickvals: fatores.map((_, i) => i), ticktext: ticks('combinada'), range: [-0.6, fatores.length - 0.4],
      title: 'combinada', gridcolor: c.grade }),
  }));
}

function eixoFator(c, fatores, titulo) {
  return eixo(c, { type: 'log', tickvals: fatores, ticktext: fatores.map(fatorTxt), title: titulo });
}

export function grafPorTipo(el, linhasPorTipo, fatores, tituloY, opcoes = {}) {
  const c = cores();
  const traces = Object.entries(linhasPorTipo).map(([t, ys]) => ({
    x: fatores, y: ys, mode: 'lines+markers', name: opcoes.nomes?.[t] || t,
    line: { color: opcoes.cores?.[t] || corTipo(c, t), dash: tracoTipo[t] || 'solid', width: 2 },
    marker: { size: 8, line: { color: c.sup, width: 2 } },
    hovertemplate: `%{x}x · ${opcoes.nomes?.[t] || t}: %{y${opcoes.formato || ''}}${opcoes.sufixo || ''}<extra></extra>`,
  }));
  const ref = fatores.includes(1) ? [{ type: 'line', xref: 'x', yref: 'paper', x0: 1, x1: 1, y0: 0, y1: 1, line: { color: c.destaque, width: 1.5, dash: 'dot' } }] : [];
  return desenhar(el, traces, base(c, {
    shapes: ref, margin: { l: 56, r: 12, t: 40, b: 44 }, hovermode: 'x unified',
    xaxis: eixoFator(c, fatores, opcoes.tituloX || 'fator sobre a penalidade de referência'),
    yaxis: eixo(c, { title: tituloY, rangemode: 'tozero', ...(opcoes.yRange ? { range: opcoes.yRange } : {}), ...(opcoes.sufixoEixo ? { ticksuffix: opcoes.sufixoEixo } : {}) }),
  }));
}

// ── Rede ─────────────────────────────────────────────────────────────────────
export function grafDiagRede(el, diag, fatores, betaRef, iRef, betaBic) {
  const c = cores();
  const traces = [{ x: diag.map((d) => d.beta), y: diag.map((d) => d.quebras_rede), mode: 'lines', line: { shape: 'hv', color: c.estrut, width: 2 },
    name: 'quebras na malha', showlegend: false, hovertemplate: 'penalidade %{x:.2f}: %{y:,} quebras<extra></extra>' }];
  const shapes = fatores.map((f, i) => ({ type: 'line', xref: 'x', yref: 'paper', x0: betaRef * f, x1: betaRef * f, y0: 0, y1: 1,
    line: { color: corFator(fatores, i, iRef), width: i === iRef ? 2.5 : 1.4 } }));
  fatores.forEach((f, i) => traces.push({ x: [null], y: [null], mode: 'lines', line: { color: corFator(fatores, i, iRef), width: i === iRef ? 3 : 2 },
    name: `${fatorTxt(f)} = ${num(betaRef * f, 1)}`, hoverinfo: 'skip' }));
  if (betaBic) {
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: betaBic, x1: betaBic, y0: 0, y1: 1, line: { color: c.mudo, width: 1.4, dash: 'dash' } });
    traces.push({ x: [null], y: [null], mode: 'lines', line: { color: c.mudo, dash: 'dash', width: 1.5 }, name: `BIC 3 ln N = ${num(betaBic, 1)}`, hoverinfo: 'skip' });
  }
  return desenhar(el, traces, base(c, {
    shapes, margin: { l: 60, r: 12, t: 70, b: 44 },
    xaxis: eixo(c, { title: 'penalidade' }), yaxis: eixo(c, { title: 'quebras na malha', rangemode: 'tozero' }),
  }));
}

export function grafComprimento(el, sensRede, fatores) {
  const c = cores();
  const traces = ['estrutural', 'combinada'].map((t) => {
    const ab = t === 'estrutural' ? 'estrut' : 'comb';
    const med = sensRede.map((r) => r.metricas[`${ab}_comp_mediano_km`]);
    return {
      x: fatores, y: med, mode: 'lines+markers', name: t, line: { color: corTipo(c, t), dash: tracoTipo[t], width: 2 },
      marker: { size: 8, line: { color: c.sup, width: 2 } },
      error_y: { type: 'data', symmetric: false, array: sensRede.map((r, i) => r.metricas[`${ab}_comp_p90_km`] - med[i]),
        arrayminus: sensRede.map((r, i) => med[i] - r.metricas[`${ab}_comp_p10_km`]), color: corTipo(c, t), thickness: 1.2, width: 4 },
      hovertemplate: `%{x}x · ${t}: mediana %{y:.2f} km<extra></extra>`,
    };
  });
  return desenhar(el, traces, base(c, {
    margin: { l: 56, r: 12, t: 40, b: 44 },
    shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: 1, x1: 1, y0: 0, y1: 1, line: { color: c.destaque, width: 1.5, dash: 'dot' } }],
    xaxis: eixoFator(c, fatores, 'fator sobre a penalidade de referência'), yaxis: eixo(c, { title: 'comprimento do segmento (km)', rangemode: 'tozero' }),
  }));
}

export function grafLinha(el, x, y, tituloX, tituloY, opcoes = {}) {
  const c = cores();
  const shapes = (opcoes.marcas || []).map((m) => ({ type: 'line', xref: 'x', yref: 'paper', x0: m.x, x1: m.x, y0: 0, y1: 1, line: { color: m.cor, width: 1.5, dash: m.traco || 'solid' } }));
  const traces = [{ x, y, mode: 'lines+markers', line: { color: c.estrut, width: 2 }, marker: { size: 5 }, showlegend: false,
    hovertemplate: `${tituloX} %{x:.4f}<br>${tituloY} %{y:.4g}<extra></extra>` }];
  (opcoes.marcas || []).forEach((m) => traces.push({ x: [null], y: [null], mode: 'lines', line: { color: m.cor, width: 2, dash: m.traco || 'solid' }, name: m.rotulo, hoverinfo: 'skip' }));
  return desenhar(el, traces, base(c, {
    shapes, margin: { l: 64, r: 12, t: 40, b: 44 }, xaxis: eixo(c, { title: tituloX }), yaxis: eixo(c, { title: tituloY }),
  }));
}

export function vazio(el, msg) {
  const c = cores();
  return desenhar(el, [], base(c, {
    xaxis: { visible: false }, yaxis: { visible: false },
    annotations: [{ text: msg, showarrow: false, font: { color: c.mudo, size: 13 }, xref: 'paper', yref: 'paper', x: 0.5, y: 0.5 }],
  }));
}

export function redimensionar(container) {
  container.querySelectorAll('.js-plotly-plot').forEach((g) => Plotly.Plots.resize(g));
}

export { NOMES_PARAM, classesDe, hexA };
