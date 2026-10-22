// Saídas padrão do modelo (as mesmas do notebook v8): planilha Excel com as abas FUNCIONAL, ESTRUTURAL,
// COMBINADA, AUDITORIA, CENARIOS_SRE e PARAMETROS, e os gráficos em PNG.
import { baixarCsv } from './util.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
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

/** gráfico Plotly → PNG em alta resolução */
export function baixarPng(el, nome, { largura = 1600, altura = null } = {}) {
  const alvo = typeof el === 'string' ? document.getElementById(el) : el;
  if (!alvo || !alvo.data) return Promise.reject(new Error('Gráfico ainda não desenhado.'));
  const h = altura || Math.max(420, Math.round(alvo.getBoundingClientRect().height * (largura / Math.max(alvo.getBoundingClientRect().width, 1))));
  return Plotly.downloadImage(alvo, { format: 'png', filename: nome, width: largura, height: h, scale: 2 });
}

const lim = (v) => (v === undefined ? null : v);

/** pacote do SRE (dados_sre) → abas no formato do notebook */
export function abasDoSre(pac, parametros = []) {
  const linhasSeg = (tipo) => pac.segmentos.filter((g) => g.tipo === tipo && g.fator === 1).sort((a, b) => a.seg_id - b.seg_id)
    .map(({ fator, tipo: t, ...g }) => ({ sre: pac.sre.sre, ...g }));
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
      km_inicial: g.km_inicial, km_final: g.km_final, comprimento_km: +(g.km_final - g.km_inicial).toFixed(3),
      d0_medio: lim(g.d0_medio), igg_medio: lim(g.igg_medio), iri_medio: lim(g.iri_medio) };
  });
}

export { baixarCsv };
