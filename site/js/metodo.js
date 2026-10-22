// Página "Metodologia e guia": atalhos para as funções, simulador da penalidade, teste rápido,
// glossário com busca e dicionário de dados.
import { pelt, prefixos } from './modelo.js';
import { media } from './estatistica.js';
import { cssVar, esc, num } from './util.js';

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
  ['Segmentação funcional', 'Divide o SRE pelas mudanças de nível do IGG (PELT com custo l2).'],
  ['Segmentação estrutural', 'Divide o SRE pelas mudanças de média ou de variação do d0 (PELT com custo normal).'],
  ['Segmentação combinada', 'Junta as duas: cada trecho funcional é subdividido pela estrutural, com regras de comprimento mínimo e fusão.'],
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
  ['tipo', 'texto', 'funcional, estrutural ou combinada', 'saída'],
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

const QUIZ = [
  { p: 'Se a penalidade aumenta, o que acontece com o número de segmentos?',
    o: ['Aumenta', 'Diminui ou fica igual', 'Não muda nunca'], c: 1,
    e: 'Cada quebra passa a “custar” mais, então só ficam as quebras que melhoram muito o ajuste.' },
  { p: 'Qual parâmetro orienta a segmentação estrutural?', o: ['IGG', 'IRI', 'd0 (deflexão)'], c: 2,
    e: 'A estrutural usa o d0 do FWD; a funcional usa o IGG.' },
  { p: 'Na sensibilidade, uma segmentação “robusta” é aquela que…',
    o: ['muda de quebras a cada pequena mudança de penalidade', 'mantém as mesmas quebras numa faixa larga de penalidades', 'tem sempre um só segmento'], c: 1,
    e: 'Se as quebras se mantêm numa faixa larga, a escolha exata da penalidade pesa pouco no resultado.' },
  { p: 'O que aparece ao aproximar o mapa até o zoom 13?', o: ['Só os SREs inteiros', 'Os intervalos de 200 m', 'Nada muda'], c: 1,
    e: 'O mapa tem três níveis: SREs, segmentos homogêneos e, de perto, os intervalos de 200 m.' },
];

export function montarMetodo() {
  document.querySelectorAll('#pagina-metodo [data-ir]').forEach((b) => b.addEventListener('click', () => {
    document.querySelector(`.aba-topo[data-pagina="${b.dataset.ir}"]`).click();
    window.scrollTo({ top: 0 });
  }));
  glossario();
  dicionario();
  quiz();
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

function quiz() {
  let certas = 0, feitas = 0;
  $('quiz').innerHTML = QUIZ.map((q, i) => `<fieldset class="pergunta" data-i="${i}"><legend>${i + 1}. ${esc(q.p)}</legend>
    <div class="opcoes">${q.o.map((o, j) => `<button type="button" class="opcao" data-j="${j}">${esc(o)}</button>`).join('')}</div>
    <p class="resposta" hidden></p></fieldset>`).join('');
  $('quiz').querySelectorAll('.pergunta').forEach((fs) => fs.querySelectorAll('.opcao').forEach((b) => b.addEventListener('click', () => {
    const q = QUIZ[Number(fs.dataset.i)];
    if (fs.dataset.feita) return;
    fs.dataset.feita = '1';
    feitas++;
    const ok = Number(b.dataset.j) === q.c;
    if (ok) certas++;
    fs.querySelectorAll('.opcao').forEach((x) => { x.disabled = true; if (Number(x.dataset.j) === q.c) x.classList.add('certa'); });
    if (!ok) b.classList.add('errada');
    const r = fs.querySelector('.resposta');
    r.hidden = false;
    r.textContent = `${ok ? 'Certo.' : 'Não exatamente.'} ${q.e}`;
    $('quiz-placar').textContent = `${certas} de ${feitas} certas${feitas === QUIZ.length ? ' — teste concluído.' : ''}`;
  })));
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
      font: { family: '"Sofia Sans Semi Condensed", system-ui, sans-serif', color: cssVar('--texto'), size: 12 },
      shapes: bk.slice(0, -1).map((b) => ({ type: 'line', x0: b * 0.2, x1: b * 0.2, yref: 'paper', y0: 0, y1: 1, line: { color: cssVar('--s-comb'), width: 2, dash: 'dash' } })),
      xaxis: { title: { text: 'km' }, gridcolor: grade, tickfont: { color: mudo } }, yaxis: { title: { text: 'd0' }, gridcolor: grade, tickfont: { color: mudo } },
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
