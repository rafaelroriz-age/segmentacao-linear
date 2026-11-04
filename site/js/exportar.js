// Saídas padrão do modelo (as mesmas do notebook v8): planilha Excel com as abas FUNCIONAL, ESTRUTURAL,
// COMBINADA, AUDITORIA, CENARIOS_SRE e PARAMETROS, e os gráficos em PNG.
import { baixarCsv } from './util.js';

const XLSX_URL = new URL('../vendor/xlsx.full.min.js', import.meta.url).href;
let carga = null;
export function carregarXlsx() {
  if (window.XLSX) return Promise.resolve();
  carga ||= new Promise((ok, falha) => {
    const s = Object.assign(document.createElement('script'), { src: XLSX_URL, onload: ok, onerror: () => falha(new Error('Não foi possível carregar a biblioteca de Excel.')) });
    document.head.appendChild(s);
  });
  return carga;
}

/** abas = { NOME: [linhas] }; nomes de aba têm no máximo 31 caracteres */
export async function baixarExcel(arquivo, abas) {
  await carregarXlsx();
  const wb = XLSX.utils.book_new();
  for (const [nome, linhas] of Object.entries(abas)) {
    if (!linhas || !linhas.length) continue;
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = Object.keys(linhas[0]).map((k) => ({ wch: Math.min(28, Math.max(10, k.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, nome.slice(0, 31));
  }
  XLSX.writeFile(wb, arquivo.endsWith('.xlsx') ? arquivo : `${arquivo}.xlsx`);
}

// cores do tema claro (iguais às de css/estilo.css): o PNG sai sempre claro, como o gráfico é mostrado no tema padrão
const CLARO = { '--texto': '#141b26', '--texto-2': '#2d3748', '--texto-mudo': '#4a5568', '--grade': '#e4e8ee', '--eixo': '#c5cdd9', '--superficie': '#ffffff',
  '--destaque': '#1f5fd1', '--s-func': '#6b7280', '--s-estrut': '#1f5fd1', '--s-comb': '#c2410c', '--s-d0': '#3b4556' };
const rgb = (hex) => { const h = hex.replace('#', ''); return h.length === 6 ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) : null; };

/** troca as cores do tema atual (claro ou escuro) pelas do tema claro, no JSON do gráfico */
function paraClaro(json) {
  const css = getComputedStyle(document.documentElement);
  for (const [nome, claro] of Object.entries(CLARO)) {
    const atual = css.getPropertyValue(nome).trim().toLowerCase();
    if (!atual || atual === claro) continue;
    json = json.split(atual).join(claro).split(atual.toUpperCase()).join(claro);
    const a = rgb(atual), c = rgb(claro);
    if (a && c) json = json.split(`rgba(${a.join(',')},`).join(`rgba(${c.join(',')},`);
  }
  return json;
}

/** gráfico Plotly → PNG claro (fundo branco, texto escuro) em alta resolução */
export async function baixarPng(el, nome, { largura = 1600, altura = null } = {}) {
  const alvo = typeof el === 'string' ? document.getElementById(el) : el;
  if (!alvo || !alvo.data) throw new Error('Gráfico ainda não desenhado.');
  const r = alvo.getBoundingClientRect();
  const h = altura || Math.max(420, Math.round(r.height * (largura / Math.max(r.width, 1))));
  const copia = JSON.parse(paraClaro(JSON.stringify({ data: alvo.data, layout: alvo.layout })));
  copia.layout = { ...copia.layout, width: largura, height: h, autosize: false, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff' };
  delete copia.layout.template;
  const tmp = Object.assign(document.createElement('div'), {});
  tmp.style.cssText = `position:fixed;left:-99999px;top:0;width:${largura}px;height:${h}px`;
  document.body.appendChild(tmp);
  try {
    await Plotly.newPlot(tmp, copia.data, copia.layout, { staticPlot: true, displayModeBar: false });
    await Plotly.downloadImage(tmp, { format: 'png', filename: nome, width: largura, height: h, scale: 2 });
  } finally {
    Plotly.purge(tmp);
    tmp.remove();
  }
}

const lim = (v) => (v === undefined ? null : v);

/** pacote do SRE (dados_sre) → abas no formato do notebook */
export function abasDoSre(pac, parametros = [], segsCfg = null) {
  const base = segsCfg || pac.segmentos;
  const linhasSeg = (tipo) => base.filter((g) => g.tipo === tipo && (segsCfg || g.fator === 1)).sort((a, b) => a.seg_id - b.seg_id)
    .map(({ fator, tipo: t, ...g }) => ({ sre: pac.sre.sre, ...g }));
  if (segsCfg) {   // parâmetros fora do padrão: auditoria, cenários e CROPS do banco são do modelo padrão e ficam de fora
    return {
      FUNCIONAL: linhasSeg('funcional'), ESTRUTURAL: linhasSeg('estrutural'), COMBINADA: linhasSeg('combinada'),
      DADOS_200M: pac.intervalos.map((iv, i) => ({ sre: pac.sre.sre, intervalo: i + 1, ...iv })),
      PARAMETROS: parametros.map((p) => ({ parametro: p.parametro, valor: p.valor })),
    };
  }
  return {
    FUNCIONAL: linhasSeg('funcional'),
    ESTRUTURAL: linhasSeg('estrutural'),
    COMBINADA: linhasSeg('combinada'),
    AUDITORIA: pac.auditoria.map((a) => ({ sre: pac.sre.sre, ...a })),
    CENARIOS_SRE: pac.cenarios.map((c) => ({ sre: pac.sre.sre, ...c })),
    SENSIBILIDADE: pac.sens_fator.map((s) => ({ sre: pac.sre.sre, ...s, quebras_km: (s.quebras_km || []).join(', ') })),
    CAMINHO_CROPS: pac.crops.map((c) => ({ sre: pac.sre.sre, ...c })),
    DADOS_200M: pac.intervalos.map((iv, i) => ({ sre: pac.sre.sre, intervalo: i + 1, ...iv })),
    PARAMETROS: parametros.map((p) => ({ parametro: p.parametro, valor: p.valor })),
  };
}

/** segmentos de toda a malha (modelo atual) em linhas */
export function linhasSegmentosRede(segs, porSre, tipo) {
  return segs.map((g) => {
    const s = porSre.get(g.sre) || {};
    return { sre: g.sre, rodovia: s.rodovia ?? null, regional: s.regional ?? null, situacao: s.situacao ?? null, tipo, seg_id: g.seg_id,
      km_inicial: g.km_inicial, km_final: g.km_final, comprimento_km: lim(g.comprimento_km) ?? +(g.km_final - g.km_inicial).toFixed(3),
      n_intervalos: lim(g.n_intervalos),
      d0_medio: lim(g.d0_medio), d0_desvio: lim(g.d0_desvio), d0_erro_padrao: lim(g.d0_erro_padrao), d0_cv: lim(g.d0_cv), d0_frac_medido: lim(g.d0_frac_medido),
      igg_medio: lim(g.igg_medio), igg_desvio: lim(g.igg_desvio), igg_cv: lim(g.igg_cv),
      iri_medio: lim(g.iri_medio), iri_desvio: lim(g.iri_desvio), iri_cv: lim(g.iri_cv), coerente: lim(g.coerente) };
  });
}

export { baixarCsv };
