// Página "Metodologia e guia": atalhos para as funções, simulador da penalidade, verificação de
// paridade Python ↔ JS (modelo.js × segmentações gravadas pelo notebook), glossário e dicionário de dados.
import { pelt, prefixos, arraysDoBanco, temD0, caminhoSre, segmentarSre, f1Quebras } from './modelo.js';
import { carregarSre } from './dados.js';
import { media } from './estatistica.js';
import { cssVar, esc, num, FONTE_UI, FONTE_MONO } from './util.js';

const $ = (id) => document.getElementById(id);

const GLOSSARIO = [
  ['SRE', 'Seção Rodoviária de Estudo: o trecho de rodovia que é a unidade básica de gerência. Cada SRE é segmentado de forma independente.'],
  ['Situação (PAV, DUP, EOD)', 'Condição do trecho no cadastro: pavimentada, duplicada ou em obras de duplicação. Só essas três entram no modelo e no site.'],
  ['Intervalo de 200 m', 'Um registro do dataset: d0, IGG e IRI médios de um trecho de cerca de 200 m. Onde não houve medição, o valor é interpolado entre os vizinhos.'],
  ['Segmento homogêneo', 'Conjunto de intervalos contíguos com comportamento parecido, que pode receber uma única decisão de manutenção.'],
  ['Quebra (fronteira)', 'Ponto, em km, onde um segmento termina e o próximo começa.'],
  ['d0 (deflexão)', 'Deflexão máxima medida pelo FWD, em 0,01 mm. Indica a capacidade estrutural: quanto maior, mais o pavimento cede.'],
  ['IGG', 'Índice de Gravidade Global (DNIT 006/2003): resume os defeitos de superfície. Resposta funcional.'],
  ['IRI', 'Índice de Irregularidade Internacional, em m/km: conforto ao rolamento. Resposta funcional.'],
  ['ACA / CDA', 'Diferença acumulada de d0 (método CDA da AASHTO). Mudanças de inclinação indicam pontos de mudança no pavimento.'],
  ['Raio de curvatura', 'Raio da bacia de deflexão perto da carga: R = 6250 / (2·(D0 − D20)), em m (DNER-ME 024). Raio pequeno = bacia “pontuda” = camadas superiores mais fracas.'],
  ['Segmentação funcional', 'Divide o SRE pelas mudanças de nível do parâmetro funcional escolhido, IGG ou IRI (PELT com custo l2). É a primeira etapa.'],
  ['Segmentação estrutural', 'Divide o SRE pelo parâmetro estrutural escolhido: D0, raio de curvatura ou diferença acumulada (ACA). É a segunda etapa.'],
  ['Modelo normal', 'Custo do PELT que separa trechos quando muda a média ou a variabilidade do sinal. Padrão para D0 e raio.'],
  ['Modelo l2', 'Custo do PELT que separa trechos só quando muda a média. Mais simples, ignora mudanças de dispersão.'],
  ['Modelo linear', 'Custo do PELT que separa trechos quando muda a inclinação do sinal. Padrão para a ACA: mudar a inclinação da acumulada é mudar a média do D0, como no método CDA.'],
  ['Robustez da quebra', '% das penalidades testadas em que a quebra aparece (a até 0,4 km). Quebra robusta (perto de 100%) é uma fronteira confiável; frágil depende da penalidade escolhida.'],
  ['Classe limitante', 'No resultado, a pior classe entre a condição funcional (IGG ou IRI) e a estrutural (D0) do segmento: é a que comanda a intervenção.'],
  ['Funcional + estrutural', 'Resultado final: todas as fronteiras funcionais e estruturais juntas; quando as duas caem a até 0,4 km, contam como uma só. Cada segmento tem no mínimo 1 km e no máximo 20 km (SRE com menos de 1 km fica com 1 segmento).'],
  ['PELT', 'Algoritmo exato que encontra as quebras que minimizam “custo do ajuste + penalidade × nº de quebras” (Killick et al., 2012).'],
  ['Penalidade', 'Quanto custa cada quebra. Penalidade baixa gera muitos segmentos curtos; alta, poucos e longos.'],
  ['α_km', 'Quociente de penalidade funcional: penalidade por km de SRE, para SREs curtos e longos terem densidade de quebras parecida.'],
  ['Caminho CROPS', 'Lista de todas as segmentações ótimas do PELT conforme a penalidade cresce. É o que a sensibilidade usa no modo “caminho exato”.'],
  ['Cotovelo', 'Ponto da curva quebras × penalidade a partir do qual aumentar a penalidade quase não remove mais quebras. Define a penalidade da malha.'],
  ['Análise de sensibilidade', 'Refazer a segmentação com várias penalidades para ver se as quebras mudam muito (instável) ou pouco (robusta).'],
  ['Fusão (Welch, Brown-Forsythe)', 'Testes estatísticos que juntam dois segmentos vizinhos quando não há diferença significativa de média (Welch) ou de variação (Brown-Forsythe).'],
  ['F1', 'Concordância entre dois conjuntos de quebras, de 0 a 1, aceitando uma pequena distância em km. 1 = mesmas quebras.'],
  ['Coerente', 'Segmento cujo coeficiente de variação de d0, IGG e IRI fica abaixo do limite (CV ≤ 1).'],
  ['Resíduo', 'Diferença entre o d0 medido e a média do seu segmento. A auditoria verifica se os resíduos são normais e independentes.'],
];

const DICIONARIO = [
  ['sre', 'texto', 'Código do SRE', 'entrada e saída'],
  ['situacao', 'texto', 'PAV, DUP ou EOD', 'cadastro'],
  ['km_inicial / km_final', 'número (km)', 'Início e fim do intervalo ou do segmento', 'entrada e saída'],
  ['d0', 'número (0,01 mm)', 'Deflexão máxima do intervalo', 'entrada'],
  ['igg', 'número', 'Índice de Gravidade Global do intervalo', 'entrada'],
  ['iri_medio', 'número (m/km)', 'IRI médio do intervalo', 'entrada'],
  ['d0_medido / igg_medido / iri_medido', 'sim / não', '“não” = valor interpolado', 'dados de 200 m'],
  ['aca', 'número', 'Diferença acumulada de d0 (CDA)', 'dados de 200 m'],
  ['seg_usuario', 'texto', 'Rótulo da sua própria segmentação (opcional), para comparar com o modelo', 'entrada'],
  ['tipo', 'texto', 'funcional, estrutural ou combinada (= funcional + estrutural)', 'saída'],
  ['seg_id', 'inteiro', 'Número do segmento dentro do SRE', 'saída'],
  ['comprimento_km', 'número (km)', 'Extensão do segmento', 'saída'],
  ['n_intervalos', 'inteiro', 'Quantidade de intervalos de 200 m no segmento', 'saída'],
  ['d0_medio / igg_medio / iri_medio', 'número', 'Médias do segmento', 'saída'],
  ['d0_desvio / d0_cv', 'número', 'Desvio padrão e coeficiente de variação do d0 no segmento', 'saída'],
  ['coerente', 'sim / não', 'Todos os CVs do segmento ≤ 1', 'saída'],
  ['penalidade', 'número', 'Penalidade usada no passo da sensibilidade', 'sensibilidade'],
  ['fator', 'número', 'Penalidade do passo ÷ penalidade do modelo atual', 'sensibilidade'],
  ['quebras_removidas_km / quebras_novas_km', 'lista de km', 'O que mudou em relação ao passo anterior', 'sensibilidade'],
];


export function montarMetodo(rede) {
  document.querySelectorAll('#pagina-metodo [data-ir]').forEach((b) => b.addEventListener('click', () => {
    document.querySelector(`.aba-topo[data-pagina="${b.dataset.ir}"]`).click();
    window.scrollTo({ top: 0 });
  }));
  glossario();
  dicionario();
  paridade(rede);
  simulador();
}

function glossario() {
  const desenhar = (filtro = '') => {
    const f = filtro.trim().toLowerCase();
    const itens = GLOSSARIO.filter(([t, d]) => !f || t.toLowerCase().includes(f) || d.toLowerCase().includes(f));
    $('glossario').innerHTML = itens.length ? itens.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('') : '<dd>Nenhum termo encontrado.</dd>';
  };
  $('glos-busca').addEventListener('input', (e) => desenhar(e.target.value));
  desenhar();
}

function dicionario() {
  $('dicionario').innerHTML = `<thead><tr><th class="txt">Coluna</th><th class="txt">Tipo</th><th class="txt">Significado</th><th class="txt">Onde aparece</th></tr></thead><tbody>${
    DICIONARIO.map(([c, t, s, o]) => `<tr><td class="txt"><code>${esc(c)}</code></td><td class="txt">${esc(t)}</td><td class="txt">${esc(s)}</td><td class="txt">${esc(o)}</td></tr>`).join('')}</tbody>`;
}

// ── simulador: PELT l2 num sinal de exemplo com três níveis ──
function simulador() {
  let semente = 7;
  const aleatorio = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(aleatorio() + 1e-12)) * Math.cos(2 * Math.PI * aleatorio());
  let y = [];
  const novo = () => {
    const niveis = [45 + 10 * aleatorio(), 70 + 15 * aleatorio(), 50 + 10 * aleatorio()];
    const cortes = [20 + Math.floor(10 * aleatorio()), 50 + Math.floor(10 * aleatorio())];
    y = Array.from({ length: 80 }, (_, i) => niveis[i < cortes[0] ? 0 : i < cortes[1] ? 1 : 2] + 8 * gauss());
    desenhar();
  };
  const desenhar = () => {
    const pen = Number($('sim-pen').value);
    $('sim-valor').textContent = num(pen, 1);
    // custo l2 em unidades de variância do ruído (8²), para a penalidade ficar numa escala legível
    const z = y.map((v) => v / 8);
    const bk = pelt(z, 'l2', 3, 1, pen, prefixos(z));
    const lim = [0, ...bk];
    const mx = [], my = [];
    for (let i = 0; i < lim.length - 1; i++) {
      const m = media(y.slice(lim[i], lim[i + 1]));
      mx.push(lim[i] * 0.2, lim[i + 1] * 0.2, null); my.push(m, m, null);
    }
    const k = bk.length - 1;
    const cor = cssVar('--destaque'), tinta = cssVar('--s-d0'), grade = cssVar('--grade'), mudo = cssVar('--texto-mudo');
    Plotly.react($('sim-graf'), [
      { x: y.map((_, i) => (i + 0.5) * 0.2), y, mode: 'lines', line: { color: tinta, width: 1.4 }, name: 'd0 de exemplo', hovertemplate: 'km %{x:.1f}: %{y:.0f}<extra></extra>' },
      { x: mx, y: my, mode: 'lines', line: { color: cor, width: 3 }, name: 'média do segmento', hoverinfo: 'skip' },
    ], {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', margin: { l: 44, r: 10, t: 10, b: 36 }, showlegend: false, separators: ',.',
      font: { family: FONTE_UI, color: cssVar('--texto'), size: 12 },
      shapes: bk.slice(0, -1).map((b) => ({ type: 'line', x0: b * 0.2, x1: b * 0.2, yref: 'paper', y0: 0, y1: 1, line: { color: cssVar('--s-comb'), width: 2, dash: 'dash' } })),
      xaxis: { title: { text: 'km' }, gridcolor: grade, tickfont: { family: FONTE_MONO, color: mudo } }, yaxis: { title: { text: 'd0' }, gridcolor: grade, tickfont: { family: FONTE_MONO, color: mudo } },
    }, { displayModeBar: false, responsive: true });
    const dica = k === 0 ? 'A penalidade está tão alta que nenhuma quebra compensa: o trecho vira um único segmento.'
      : k <= 2 ? 'Faixa boa: o modelo encontra as mudanças reais de nível do exemplo (ele foi gerado com 3 níveis, ou seja, 2 quebras).'
        : 'Penalidade baixa: o modelo começa a cortar também o ruído, criando segmentos curtos sem mudança real.';
    $('sim-texto').innerHTML = `<strong>${k} quebra${k === 1 ? '' : 's'} · ${k + 1} segmento${k ? 's' : ''}.</strong> ${dica}`;
  };
  $('sim-pen').addEventListener('input', desenhar);
  $('sim-novo').addEventListener('click', novo);
  novo();
}

// ── paridade: mesma conferência de tools/validar_modelo_js.mjs, numa amostra de SREs do banco ──
const r3 = (v) => Math.round(v * 1000) / 1000;
const TIPOS_PAR = ['funcional', 'estrutural', 'combinada'];

function amostra(sres, n) {
  const lst = sres.filter((s) => s.n_intervalos > 0).map((s) => s.sre).sort();
  if (lst.length <= n) return lst;
  return Array.from({ length: n }, (_, i) => lst[Math.floor((i + 0.5) * lst.length / n)]);
}

function verificarSre(pac, meta) {
  const a = arraysDoBanco(pac.intervalos);
  const cam = temD0(a) ? caminhoSre(a, meta.beta_min) : null;
  const tol = meta.sens_tol_km ?? 0.4;
  const out = { ok: {}, tot: {}, f1: [], dp: null };
  for (const c of pac.cenarios) {
    const r = segmentarSre(a, { alphaFunc: meta.alpha_km_func, beta: c.beta_estrut ?? 0, cam, auditar: c.fator === 1 });
    const meu = { funcional: r.func_km, estrutural: r.estrut_km, combinada: r.comb_km };
    for (const t of TIPOS_PAR) {
      const esperado = pac.sens_fator.find((x) => x.fator === c.fator && x.tipo === t)?.quebras_km;
      if (!esperado) continue;
      out.tot[t] = (out.tot[t] || 0) + 1;
      if (JSON.stringify(meu[t].map(r3)) === JSON.stringify(esperado)) out.ok[t] = (out.ok[t] || 0) + 1;
      else out.f1.push(f1Quebras(esperado, meu[t], tol).f1);
    }
    const au = c.fator === 1 && pac.auditoria.find((x) => x.fator === 1);
    if (au && au.shapiro_p !== null && r.aud?.shapiro_p !== undefined) {
      out.dp = Math.max(...['shapiro_p', 'ks_p', 'ljung_box_p'].map((k) => Math.abs(au[k] - r.aud[k])));
    }
  }
  return out;
}

function paridade(rede) {
  const pct = (o, t) => (t ? `${num(100 * o / t, 1)}%` : '—');
  const kpi = (rot, val, det = '') => `<div class="kpi"><div class="rot">${rot}</div><div class="val">${val}</div>${det ? `<div class="det">${det}</div>` : ''}</div>`;
  $('par-rodar').addEventListener('click', async () => {
    const pedidos = $('par-lista').value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    const conhecidos = new Set(rede.sres.map((s) => s.sre));
    const lista = pedidos.length ? pedidos.filter((s) => conhecidos.has(s)) : amostra(rede.sres, Number($('par-n').value));
    if (!lista.length) { $('par-saida').hidden = false; $('par-status').textContent = 'Nenhum dos SREs informados existe na malha.'; return; }
    $('par-rodar').disabled = true;
    $('par-saida').hidden = false;
    const linhas = [], tot = {}, ok = {}, f1 = [];
    let audOk = 0, audTot = 0;
    const t0 = performance.now();
    for (const [i, sre] of lista.entries()) {
      $('par-status').textContent = `Verificando ${i + 1} de ${lista.length}: ${sre}…`;
      let r = null, erro = '';
      try {
        const pac = await carregarSre(sre);
        if (pac.intervalos.length) r = verificarSre(pac, rede.meta);
      } catch (e) { erro = e.message; }
      if (r) {
        TIPOS_PAR.forEach((t) => { tot[t] = (tot[t] || 0) + (r.tot[t] || 0); ok[t] = (ok[t] || 0) + (r.ok[t] || 0); });
        f1.push(...r.f1);
        if (r.dp !== null) { audTot++; if (r.dp < 2e-3) audOk++; }
      }
      linhas.push({ sre, r, erro });
      await new Promise((ok) => setTimeout(ok));
    }
    const seg = (performance.now() - t0) / 1000;
    const f1m = f1.length ? f1.reduce((x, y) => x + y, 0) / f1.length : null;
    $('par-kpis').innerHTML = [
      kpi('SREs verificados', num(lista.length, 0), `${num(seg, 1)} s no navegador`),
      ...TIPOS_PAR.map((t) => kpi(`Idênticas · ${t}`, pct(ok[t] || 0, tot[t]), `${num(ok[t] || 0, 0)} / ${num(tot[t] || 0, 0)} cenários`)),
      kpi('F1 das divergentes', f1m === null ? '—' : num(f1m, 3), `${num(f1.length, 0)} segmentações`),
      kpi('Auditoria', `${num(audOk, 0)} / ${num(audTot, 0)}`, '|Δp| < 0,002'),
    ].join('');
    $('par-status').textContent = 'Comparação exata das quebras em km (3 casas) por cenário de penalidade; F1 com a tolerância da sensibilidade. A auditoria compara os p-valores de Shapiro-Wilk, KS e Ljung-Box do cenário de referência.';
    const cel = (r, t) => {
      if (!r?.tot[t]) return '<td>—</td>';
      const o = r.ok[t] || 0;
      return `<td class="${o === r.tot[t] ? 'ok' : 'difere'}">${o}/${r.tot[t]}</td>`;
    };
    $('par-tabela').innerHTML = `<table><thead><tr><th>SRE</th>${TIPOS_PAR.map((t) => `<th>${t}</th>`).join('')}<th>F1 mín.</th><th>máx. |Δp| auditoria</th><th class="txt">Situação</th></tr></thead><tbody>${
      linhas.map(({ sre, r, erro }) => {
        if (!r) return `<tr><td>${esc(sre)}</td><td colspan="5"></td><td class="txt">${esc(erro || 'sem intervalos')}</td></tr>`;
        const ident = TIPOS_PAR.every((t) => (r.ok[t] || 0) === (r.tot[t] || 0));
        return `<tr><td>${esc(sre)}</td>${TIPOS_PAR.map((t) => cel(r, t)).join('')}<td>${r.f1.length ? num(Math.min(...r.f1), 3) : '—'}</td>`
          + `<td>${r.dp === null ? '—' : num(r.dp, 4)}</td><td class="txt ${ident ? 'ok' : 'difere'}">${ident ? '✓ idêntico' : '≠ difere'}</td></tr>`;
      }).join('')}</tbody></table>`;
    $('par-rodar').disabled = false;
  });
}
