// Página "Rodar o modelo": o usuário escolhe o dataset (original da malha ou planilha própria), uma
// geometria opcional (shapefile/GeoJSON), ajusta os parâmetros e roda o modelo v8 do zero no navegador.
import * as M from './modelo.js';
import * as GP from './graficos_passos.js';
import { Sensibilidade } from './sensibilidade.js';
import { baixarPng } from './exportar.js';
import { carregarIntervalos } from './dados.js';
import { num, km, esc, baixarCsv, criarReferencia, TIPOS, SITUACOES as LISTA_SITUACOES } from './util.js';

const LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  shp: 'https://unpkg.com/shpjs@4.0.4/dist/shp.min.js',
};
const SITUACOES = new Set(LISTA_SITUACOES);
const carregadas = {};
function carregarLib(nome) {
  carregadas[nome] ||= new Promise((ok, falha) => {
    const s = Object.assign(document.createElement('script'), { src: LIBS[nome], onload: ok, onerror: () => falha(new Error(`Não foi possível carregar ${nome}`)) });
    document.head.appendChild(s);
  });
  return carregadas[nome];
}

// colunas do dataset e os nomes aceitos em cada uma
const COLUNAS = [
  ['sre', 'SRE', true, ['sre', 'cod_sre', 'codigo_sre', 'sre_codigo']],
  ['km_inicial', 'km inicial', true, ['km_inicial', 'km_ini', 'kminicial', 'inicio_km', 'km_inicio']],
  ['km_final', 'km final', true, ['km_final', 'km_fim', 'kmfinal', 'fim_km']],
  ['d0', 'd0 (deflexão)', false, ['d0', 'deflexao', 'deflexão', 'd0_medio', 'def']],
  ['igg', 'IGG', false, ['igg', 'igg_medio']],
  ['iri_medio', 'IRI', false, ['iri_medio', 'iri', 'irimedio']],
  ['sre_segmento', 'nº do intervalo (opcional)', false, ['sre_segmento', 'segmento_200', 'intervalo']],
  ['seg_usuario', 'sua segmentação (opcional)', false, ['seg_usuario', 'segmento_homogeneo', 'seg_id', 'segmento']],
];

// parâmetros editáveis, com a explicação de cada um
const PARAMS = [
  ['Segmentos', [
    ['MIN_SIZE', 'Mínimo de intervalos por segmento', 'int', 'O PELT não cria segmentos com menos intervalos que isso. 3 × 200 m = 600 m, o piso operacional.', 2, 20],
    ['MIN_COMP_COMB_KM', 'Comprimento mínimo da combinada (km)', 'num', 'Na combinada, uma fronteira só entra se deixar pelo menos este comprimento dos dois lados.', 0, 5],
    ['BUFFER_KM', 'Absorção de quebra funcional (km)', 'num', 'Uma quebra funcional a menos desta distância de uma estrutural é absorvida por ela, evitando segmentos minúsculos entre as duas.', 0, 3],
    ['SUBSEGMENTAR_COMB', 'Combinada em 2 etapas', 'bool', 'Liga: cada base funcional é subsegmentada pelo PELT estrutural com a mesma penalidade. Desliga: a combinada junta as quebras estruturais e funcionais.'],
  ]],
  ['Funcional (IGG)', [
    ['MARGEM_PEN', 'Margem da penalidade funcional', 'num', 'A penalidade do PELT l2 é α_km × extensão; o modelo testa a faixa ±margem em torno dela e fica com a de menor BIC.', 0, 0.95],
    ['N_CAND_PEN', 'Nº de penalidades candidatas', 'int', 'Quantas penalidades são testadas dentro da faixa (escolha pelo BIC).', 1, 41],
  ]],
  ['Estrutural (d0)', [
    ['VAR_FLOOR_FRAC', 'Piso de variância (fração do desvio)', 'num', 'Variância mínima de um segmento = (fração × desvio do d0 no SRE)². Evita que trechos de d0 repetido (preenchidos) virem quebras artificiais.', 0.001, 1],
  ]],
  ['Fusões e testes', [
    ['FUNDIR_FUNC', 'Fundir funcionais iguais (Welch)', 'bool', 'Remove a quebra funcional se a média do IGG dos dois lados não difere (teste de Welch).'],
    ['FUNDIR_ESTRUT', 'Fundir estruturais iguais', 'bool', 'Remove a quebra estrutural se nem a média (Welch) nem a variância (Brown-Forsythe) do d0 diferem. Desligado na v8, como em Biswas & Kuna.'],
    ['FUNDIR_COMB', 'Fundir combinados iguais', 'bool', 'Remove a quebra da combinada se não há diferença em d0 (média e variância) nem em IGG (média).'],
    ['ALPHA_TESTE', 'Nível de significância', 'num', 'Um par de segmentos só fica separado se algum teste der p ≤ este valor. Também é o nível da auditoria dos resíduos.', 0.001, 0.5],
    ['CV_LIMITE', 'CV máximo para “coerente”', 'num', 'Um segmento é marcado como coerente se o coeficiente de variação de d0, IGG e IRI não passa deste valor.', 0.05, 5],
  ]],
];

export class Rodar {
  constructor(raiz, ctx) {
    this.raiz = raiz;
    this.ctx = ctx;   // { rede, aoMostrarNoMapa(geojson, rotulo) }
    this.p = { ...M.PADRAO };
    this.linhas = null;
    this.geo = null;
    this.montar();
  }

  $(id) { return this.raiz.querySelector(`#${id}`); }

  montar() {
    const meta = this.ctx.rede.meta;
    this.betaMalha = meta.beta_rede;
    this.alphaMalha = meta.alpha_km_func;
    const regs = [...new Set(this.ctx.rede.sres.map((s) => s.regional).filter((r) => r !== null))].sort((a, b) => a - b);
    this.$('rd-regional').innerHTML = '<option value="">Escolha…</option><option value="todas">Malha inteira</option>' + regs.map((r) => `<option value="${r}">Regional ${r}</option>`).join('');
    this.$('rd-penalidade-malha').textContent = `A mesma da malha (${num(this.betaMalha, 2)})`;
    this.$('rd-alpha-malha').textContent = `O mesmo da malha (${num(this.alphaMalha, 4)})`;
    this.$('rd-beta-fixo').value = +this.betaMalha.toFixed(3);
    this.$('rd-alpha-fixo').value = +this.alphaMalha.toFixed(4);
    this.formParametros();

    this.raiz.querySelectorAll('#rd-fonte .chip').forEach((b) => b.addEventListener('click', () => {
      this.raiz.querySelectorAll('#rd-fonte .chip').forEach((x) => x.classList.toggle('ativo', x === b));
      this.$('rd-orig').hidden = b.dataset.v !== 'original';
      this.$('rd-up').hidden = b.dataset.v !== 'upload';
    }));
    this.$('rd-carregar-orig').addEventListener('click', () => this.carregarOriginal(false));
    this.$('rd-baixar-orig').addEventListener('click', () => this.carregarOriginal(true));
    this.$('rd-arquivo').addEventListener('change', (e) => this.lerPlanilha(e.target.files[0]));
    this.$('rd-aba').addEventListener('change', () => this.usarAba(this.$('rd-aba').value));
    this.$('rd-modelo-csv').addEventListener('click', () => baixarCsv('modelo_dataset_segmentacao.csv', [
      { sre: '320EGO0130', sre_segmento: 1, km_inicial: 0, km_final: 0.2, d0: 45.2, igg: 32, iri_medio: 2.4, seg_usuario: 1 },
      { sre: '320EGO0130', sre_segmento: 2, km_inicial: 0.2, km_final: 0.4, d0: 51.8, igg: 30, iri_medio: 2.6, seg_usuario: 1 },
    ]));
    this.$('rd-geo').addEventListener('change', (e) => this.lerGeometria(e.target.files[0]));
    this.$('rd-campo-sre').addEventListener('change', () => this.resumoGeo());
    this.$('rd-inverter').addEventListener('change', () => this.resumoGeo());
    this.$('rd-modo-beta').addEventListener('change', () => { this.$('rd-beta-fixo').disabled = this.$('rd-modo-beta').value !== 'fixo'; });
    this.$('rd-modo-alpha').addEventListener('change', () => { this.$('rd-alpha-fixo').disabled = this.$('rd-modo-alpha').value !== 'fixo'; });
    this.$('rd-restaurar').addEventListener('click', () => { this.p = { ...M.PADRAO }; this.formParametros(); });
    this.$('rd-rodar').addEventListener('click', () => this.rodar());
    this.$('rd-sre').addEventListener('change', () => this.mostrarSre(this.$('rd-sre').value));
    this.$('rd-tipo-mapa').addEventListener('change', () => this.desenharMapa());
    this.$('rd-csv').addEventListener('click', () => this.baixarResultado('csv'));
    this.$('rd-xlsx').addEventListener('click', () => this.baixarResultado('xlsx'));
    this.$('rd-png-sre').addEventListener('click', () => baixarPng(this.$('rd-graf-sre'), `${this.sreAtual || 'sre'}_segmentacao`, { largura: 1600, altura: 1100 }));
    this.raiz.querySelectorAll('#rd-abas .aba').forEach((b) => b.addEventListener('click', () => {
      this.raiz.querySelectorAll('#rd-abas .aba').forEach((x) => x.classList.toggle('ativa', x === b));
      this.raiz.querySelectorAll('.rd-painel').forEach((pn) => pn.classList.toggle('ativo', pn.id === `rd-aba-${b.dataset.aba}`));
      if (b.dataset.aba === 'sens' && this.sreAtual) this.abrirSensibilidade(this.sreAtual);
      window.dispatchEvent(new Event('resize'));
    }));
    this.raiz.querySelectorAll('.ajuda').forEach((b) => b.addEventListener('click', () => alert(b.title)));
  }

  formParametros() {
    this.$('rd-params').innerHTML = PARAMS.map(([grupo, itens]) => `<fieldset class="grupo-params"><legend>${grupo}</legend>${itens.map(([k, rot, tipo, ajuda, min, max]) => {
      const v = this.p[k];
      const campo = tipo === 'bool'
        ? `<input type="checkbox" data-p="${k}" ${v ? 'checked' : ''}>`
        : `<input type="number" data-p="${k}" value="${v}" step="${tipo === 'int' ? 1 : 'any'}" min="${min}" max="${max}">`;
      return `<label class="param ${tipo === 'bool' ? 'param-bool' : ''}"><span>${rot} <button class="ajuda" type="button" title="${esc(ajuda)}">?</button></span>${campo}<small>${esc(ajuda)}</small></label>`;
    }).join('')}</fieldset>`).join('');
    this.$('rd-params').querySelectorAll('.ajuda').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); alert(b.title); }));
  }

  lerParametros() {
    const p = { ...this.p };
    this.$('rd-params').querySelectorAll('[data-p]').forEach((el) => {
      const k = el.dataset.p;
      if (el.type === 'checkbox') p[k] = el.checked;
      else if (el.value !== '' && Number.isFinite(Number(el.value))) p[k] = Number(el.value);
    });
    p.MIN_SIZE = Math.max(2, Math.round(p.MIN_SIZE));
    p.N_CAND_PEN = Math.max(1, Math.round(p.N_CAND_PEN));
    this.p = p;
    return p;
  }

  status(id, html, erro = false) {
    const el = this.$(id);
    el.innerHTML = html;
    el.classList.toggle('erro', erro);
  }

  // ── fonte 1: dataset original da malha ──
  sresSelecionados() {
    const reg = this.$('rd-regional').value;
    const lista = this.$('rd-lista').value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    // dataset original: só trechos DUP, PAV e EOD (os demais são leito natural, planejada, em obras etc.)
    const todos = this.ctx.rede.sres.filter((s) => s.tem_dados && SITUACOES.has(s.situacao));
    let sel = [];
    if (reg === 'todas') sel = todos.map((s) => s.sre);
    else if (reg) sel = todos.filter((s) => String(s.regional) === reg).map((s) => s.sre);
    const validos = new Set(todos.map((s) => s.sre));
    lista.forEach((s) => { if (validos.has(s) && !sel.includes(s)) sel.push(s); });
    return { sel, invalidos: lista.filter((s) => !validos.has(s)) };
  }

  async carregarOriginal(baixar) {
    const { sel, invalidos } = this.sresSelecionados();
    if (!sel.length) return this.status('rd-status-orig', 'Escolha uma regional ou informe códigos de SRE com dados.', true);
    this.status('rd-status-orig', `<span class="spinner"></span> Lendo ${sel.length} SREs do banco…`);
    try {
      const r = await carregarIntervalos(sel, false);
      const linhas = [];
      sel.forEach((s) => (r.intervalos[s] || []).forEach((iv, i) => linhas.push({
        sre: s, sre_segmento: i + 1, km_inicial: iv.km_inicial, km_final: iv.km_final,
        d0: iv.d0, igg: iv.igg, iri_medio: iv.iri, aca: iv.aca, d0_medido: iv.d0_obs, igg_medido: iv.igg_obs, iri_medido: iv.iri_obs,
      })));
      if (baixar) {
        baixarCsv(`dataset_original_${sel.length}_sres.csv`, linhas);
        this.status('rd-status-orig', `${linhas.length.toLocaleString('pt-BR')} intervalos de ${sel.length} SREs baixados. Valores sem medição foram interpolados pelo modelo (colunas *_medido = falso).`);
        return;
      }
      // o dataset original já vem agregado e interpolado: usa direto, mantendo as marcas de medido
      const grupos = {};
      sel.forEach((s) => { if (r.intervalos[s]?.length) grupos[s] = M.arraysDoBanco(r.intervalos[s]); });
      this.definirDataset(grupos, {}, `dataset original da malha · ${Object.keys(grupos).length} SREs`);
      this.status('rd-status-orig', `${linhas.length.toLocaleString('pt-BR')} intervalos de ${Object.keys(grupos).length} SREs prontos para rodar.`
        + (invalidos.length ? ` Ignorados (sem dados, situação diferente de DUP/PAV/EOD ou inexistentes): ${esc(invalidos.join(', '))}.` : ''));
    } catch (err) {
      this.status('rd-status-orig', `Erro ao ler o banco: ${esc(err.message)}`, true);
    }
  }

  // ── fonte 2: planilha do usuário ──
  async lerPlanilha(arq) {
    if (!arq) return;
    this.status('rd-status-up', '<span class="spinner"></span> Lendo arquivo…');
    try {
      const buf = await arq.arrayBuffer();
      this.nomeArquivo = arq.name;
      if (/\.(csv|txt)$/i.test(arq.name)) {
        this.$('rd-caixa-aba').hidden = true;
        return this.usarLinhas(lerCsv(new TextDecoder('utf-8').decode(buf)));
      }
      await carregarLib('xlsx');
      this.livro = XLSX.read(buf, { type: 'array' });
      this.$('rd-aba').innerHTML = this.livro.SheetNames.map((n) => `<option>${esc(n)}</option>`).join('');
      this.$('rd-caixa-aba').hidden = this.livro.SheetNames.length < 2;
      this.usarAba(this.livro.SheetNames[0]);
    } catch (err) {
      this.status('rd-status-up', `Não foi possível ler o arquivo: ${esc(err.message)}`, true);
    }
  }

  usarAba(nome) {
    this.usarLinhas(XLSX.utils.sheet_to_json(this.livro.Sheets[nome], { defval: null, raw: true }));
  }

  usarLinhas(linhas) {
    if (!linhas.length) return this.status('rd-status-up', 'A aba está vazia.', true);
    this.linhasBrutas = linhas;
    const cols = Object.keys(linhas[0]);
    const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
    this.$('rd-mapeamento').innerHTML = COLUNAS.map(([k, rot, obrig, nomes]) => {
      const achada = cols.find((c) => nomes.includes(norm(c)));
      return `<label class="param"><span>${rot}${obrig ? ' *' : ''}</span><select data-col="${k}"><option value="">—</option>${cols.map((c) => `<option ${c === achada ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`;
    }).join('');
    this.$('rd-mapeamento').querySelectorAll('select').forEach((s) => s.addEventListener('change', () => this.aplicarMapeamento()));
    const amostra = linhas.slice(0, 6);
    this.$('rd-previa').innerHTML = `<table><thead><tr>${cols.map((c) => `<th class="txt">${esc(c)}</th>`).join('')}</tr></thead><tbody>${amostra.map((l) => `<tr>${cols.map((c) => `<td class="txt">${esc(l[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    this.$('rd-caixa-map').hidden = false;
    this.aplicarMapeamento();
  }

  aplicarMapeamento() {
    const m = {};
    this.$('rd-mapeamento').querySelectorAll('select').forEach((s) => { m[s.dataset.col] = s.value; });
    const faltam = COLUNAS.filter(([k, , obrig]) => obrig && !m[k]).map(([, r]) => r);
    if (faltam.length) return this.status('rd-status-up', `Indique as colunas: ${faltam.join(', ')}.`, true);
    if (!m.d0 && !m.igg) return this.status('rd-status-up', 'Indique pelo menos a coluna de d0 ou a de IGG.', true);
    const linhas = this.linhasBrutas.map((l) => Object.fromEntries(COLUNAS.map(([k]) => [k, m[k] ? l[m[k]] : null])));
    const grupos = M.prepararDataset(linhas);
    // segmentação do próprio usuário (fronteiras onde o rótulo muda), para comparar com o modelo
    const usuario = {};
    if (m.seg_usuario) {
      const porSre = {};
      linhas.forEach((l) => { const s = String(l.sre ?? '').trim(); if (s) (porSre[s] ||= []).push(l); });
      for (const [s, ls] of Object.entries(porSre)) {
        ls.sort((x, y) => Number(String(x.km_inicial).replace(',', '.')) - Number(String(y.km_inicial).replace(',', '.')));
        const q = [];
        for (let i = 1; i < ls.length; i++) if (String(ls[i].seg_usuario) !== String(ls[i - 1].seg_usuario)) q.push(Number(String(ls[i].km_inicial).replace(',', '.')));
        usuario[s] = [...new Set(q)].filter(Number.isFinite);
      }
    }
    const n = Object.keys(grupos).length;
    const nInt = Object.values(grupos).reduce((s, a) => s + a.ini.length, 0);
    const pd0 = Object.values(grupos).reduce((s, a) => s + a.d0_obs.filter(Boolean).length, 0) / Math.max(nInt, 1);
    this.definirDataset(grupos, usuario, `${this.nomeArquivo} · ${n} SREs`);
    this.status('rd-status-up', `${n} SREs, ${nInt.toLocaleString('pt-BR')} intervalos; d0 medido em ${num(100 * pd0, 0)}% (o resto é interpolado como no notebook).`
      + (m.seg_usuario ? ` Sua segmentação foi lida e será comparada com a do modelo.` : ''));
  }

  definirDataset(grupos, usuario, rotulo) {
    this.grupos = grupos;
    this.usuario = usuario;
    this.$('rd-rotulo-dataset').textContent = rotulo;
    this.$('rd-rodar').disabled = !Object.keys(grupos).length;
    this.resumoGeo();
  }

  // ── geometria ──
  async lerGeometria(arq) {
    if (!arq) return;
    this.status('rd-status-geo', '<span class="spinner"></span> Lendo geometria…');
    try {
      let gj;
      if (/\.(geo)?json$/i.test(arq.name)) gj = JSON.parse(await arq.text());
      else {
        await carregarLib('shp');
        const buf = await arq.arrayBuffer();
        gj = /\.zip$/i.test(arq.name) ? await shp(buf) : { type: 'FeatureCollection', features: shp.parseShp(buf).map((g) => ({ type: 'Feature', geometry: g, properties: {} })) };
      }
      if (Array.isArray(gj)) gj = { type: 'FeatureCollection', features: gj.flatMap((c) => c.features) };
      if (gj.type === 'Feature') gj = { type: 'FeatureCollection', features: [gj] };
      const feats = gj.features.filter((f) => f.geometry && /LineString/.test(f.geometry.type));
      if (!feats.length) throw new Error('nenhuma linha (LineString) encontrada');
      this.geo = { type: 'FeatureCollection', features: feats };
      const campos = Object.keys(feats[0].properties || {});
      const sugerido = campos.find((c) => c.toLowerCase() === 'sre') || '';
      this.$('rd-campo-sre').innerHTML = `<option value="">(usar a ordem dos SREs do dataset)</option>` + campos.map((c) => `<option ${c === sugerido ? 'selected' : ''}>${esc(c)}</option>`).join('');
      this.$('rd-caixa-geo').hidden = false;
      this.resumoGeo();
      this.ctx.aoMostrarNoMapa(this.geo, `${arq.name} (${feats.length} linhas)`);
    } catch (err) {
      this.status('rd-status-geo', `Não foi possível ler a geometria: ${esc(err.message)}. Envie um .zip com .shp, .shx, .dbf e .prj, ou um .geojson.`, true);
    }
  }

  /** coordenadas [lon, lat] de cada SRE: do arquivo enviado ou, se o código existir na malha, a geometria cadastrada */
  geometrias() {
    const out = {};
    const malha = new Map(this.ctx.rede.sres.map((s) => [s.sre, s]));
    const sres = Object.keys(this.grupos || {});
    sres.forEach((s) => { if (malha.has(s)) out[s] = { coords: malha.get(s).geom_mapa, origem: 'malha' }; });
    if (this.geo) {
      const campo = this.$('rd-campo-sre').value;
      const inverter = this.$('rd-inverter').checked;
      const linhaDe = (f) => {
        const g = f.geometry;
        let c = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
        c = c.map((p) => [p[0], p[1]]);
        return inverter ? c.reverse() : c;
      };
      if (campo) this.geo.features.forEach((f) => { const s = String(f.properties[campo] ?? '').trim(); if (s && sres.includes(s)) out[s] = { coords: linhaDe(f), origem: 'arquivo' }; });
      else this.geo.features.slice(0, sres.length).forEach((f, i) => { out[sres[i]] = { coords: linhaDe(f), origem: 'arquivo' }; });
    }
    return out;
  }

  resumoGeo() {
    if (!this.grupos) return;
    const g = this.geometrias();
    const n = Object.keys(this.grupos).length;
    const doArq = Object.values(g).filter((x) => x.origem === 'arquivo').length;
    const daMalha = Object.values(g).filter((x) => x.origem === 'malha').length;
    this.status('rd-status-geo', `${Object.keys(g).length} de ${n} SREs com geometria (${doArq} do arquivo, ${daMalha} da malha cadastrada). `
      + (Object.keys(g).length < n ? 'Os demais aparecem só nos gráficos.' : ''));
  }

  // ── rodar ──
  rodar() {
    if (!this.grupos) return;
    const p = this.lerParametros();
    const cfg = {
      p, modoBeta: this.$('rd-modo-beta').value, betaFixo: Number(this.$('rd-beta-fixo').value), betaMalha: this.betaMalha,
      modoAlpha: this.$('rd-modo-alpha').value, alphaFixo: Number(this.$('rd-alpha-fixo').value), alphaMalha: this.alphaMalha,
    };
    this.trab?.terminate();
    this.trab = new Worker(new URL('./trabalhador.js', import.meta.url), { type: 'module' });
    this.$('rd-rodar').disabled = true;
    this.$('rd-progresso').hidden = false;
    this.trab.onmessage = (ev) => {
      const m = ev.data;
      if (m.tipo === 'progresso') {
        this.$('rd-barra').value = m.total ? m.feito / m.total : 0;
        this.$('rd-etapa').textContent = `${m.etapa}${m.total > 1 ? ` (${m.feito}/${m.total})` : ''}`;
      } else if (m.tipo === 'erro') {
        this.$('rd-rodar').disabled = false;
        this.$('rd-etapa').textContent = `Erro: ${m.mensagem}`;
      } else {
        this.$('rd-rodar').disabled = false;
        this.$('rd-progresso').hidden = true;
        this.cfg = cfg;
        this.mostrarResultado(m.resultado);
      }
    };
    this.trab.onerror = (e) => { this.$('rd-rodar').disabled = false; this.$('rd-etapa').textContent = `Erro: ${e.message}`; };
    this.trab.postMessage({ grupos: this.grupos, cfg });
  }

  mostrarResultado(res) {
    this.res = res;
    this.enquadrado = false;
    this.sensSre = null;
    const sres = Object.keys(res.porSre);
    const tot = (t) => sres.reduce((s, k) => s + res.porSre[k].segmentos.filter((g) => g.tipo === t).length, 0);
    const ext = sres.reduce((s, k) => s + (res.porSre[k].r.km_max - res.porSre[k].r.km_min), 0);
    const nomesBeta = { rede: 'cotovelo do seu dataset', malha: 'mesma da malha', sre: 'cotovelo de cada SRE', fixo: 'valor fixo' };
    const nomesAlpha = { malha: 'mesmo da malha', calibrar: 'calibrado no seu dataset (BIC)', fixo: 'valor fixo' };
    const kpi = (r, v, d) => `<div class="kpi"><div class="rot">${r}</div><div class="val">${v}</div><div class="det">${d}</div></div>`;
    this.$('rd-kpis').innerHTML = [
      kpi('SREs', sres.length, `${num(ext, 1)} km · ${num(res.segundos, 1)} s no navegador`),
      kpi('Segmentos combinados', tot('combinada'), `mediana ${num(medianaComp(res, 'combinada'), 2)} km`),
      kpi('Segmentos estruturais', tot('estrutural'), `mediana ${num(medianaComp(res, 'estrutural'), 2)} km`),
      kpi('Segmentos funcionais', tot('funcional'), `mediana ${num(medianaComp(res, 'funcional'), 2)} km`),
      kpi('Penalidade estrutural', this.cfg.modoBeta === 'sre' ? 'por SRE' : num(res.betaBase, 2), nomesBeta[this.cfg.modoBeta]),
      kpi('α_km funcional', num(res.alpha, 4), nomesAlpha[this.cfg.modoAlpha]),
    ].join('');
    const nota = [];
    if (res.betaRede !== null) nota.push(`Cotovelo do seu dataset: penalidade ${num(res.betaRede, 2)} (malha: ${num(this.betaMalha, 2)}). Varredura a partir de ln(N mediano) = ${num(res.betaMin, 2)}.`);
    if (res.calib) nota.push(`α_km pelo mínimo do BIC em ${res.calib.sres.length} SREs: ${num(res.calib.alpha, 4)} (malha: ${num(this.alphaMalha, 4)}).`);
    const usuarioN = Object.keys(this.usuario || {}).length;
    if (usuarioN) {
      const f1 = sres.filter((s) => this.usuario[s]).map((s) => M.f1Quebras(this.usuario[s], res.porSre[s].r.comb_km, res.p.BUFFER_KM).f1);
      nota.push(`Sua segmentação × combinada do modelo: F1 médio ${num(f1.reduce((a, b) => a + b, 0) / Math.max(f1.length, 1), 2)} (tolerância ${num(res.p.BUFFER_KM, 1)} km) em ${f1.length} SREs.`);
    }
    this.$('rd-nota-res').textContent = nota.join(' ');
    if (res.diag) {
      GP.grafCurva(this.$('rd-graf-diag'), res.diag.grid, res.diag.K, 'penalidade estrutural', 'quebras no dataset', {
        degrau: true, marcas: [{ x: res.diag.betaRede, cor: getComputedStyle(document.documentElement).getPropertyValue('--destaque').trim(), rotulo: `cotovelo: ${num(res.diag.betaRede, 2)}` },
          { x: this.betaMalha, cor: '#898781', traco: 'dash', rotulo: `malha: ${num(this.betaMalha, 2)}` }],
      });
    } else this.$('rd-graf-diag').innerHTML = '<p class="sub vazio">Sem d0 no dataset: não há segmentação estrutural.</p>';
    if (res.calib) {
      GP.grafCurva(this.$('rd-graf-calib'), res.calib.grade, res.calib.somaBic, 'α_km', 'soma do BIC', { marcas: [{ x: res.calib.alpha, cor: getComputedStyle(document.documentElement).getPropertyValue('--destaque').trim(), rotulo: `mínimo: ${num(res.calib.alpha, 4)}` }] });
      this.$('rd-caixa-calib').hidden = false;
    } else this.$('rd-caixa-calib').hidden = true;

    this.$('rd-sre').innerHTML = sres.map((s) => {
      const q = res.porSre[s];
      return `<option value="${esc(s)}">${esc(s)} · ${q.segmentos.filter((g) => g.tipo === 'combinada').length} seg. combinados · ${num(q.r.km_max - q.r.km_min, 1)} km</option>`;
    }).join('');
    this.$('rd-resultado').hidden = false;
    this.desenharTabelaGeral();
    this.mostrarSre(sres[0]);
    this.desenharMapa();
    this.$('rd-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  desenharTabelaGeral() {
    const res = this.res;
    const linhas = Object.entries(res.porSre).map(([s, q]) => ({
      s, ext: q.r.km_max - q.r.km_min, n: this.grupos[s].ini.length, f: q.r.func_s.length + 1, e: q.cam ? q.r.estrut_s.length + 1 : null, c: q.r.comb_s.length + 1,
      beta: q.beta, origem: q.origem, sw: q.r.aud.shapiro_p, lb: q.r.aud.ljung_box_p,
      f1: this.usuario?.[s] ? M.f1Quebras(this.usuario[s], q.r.comb_km, res.p.BUFFER_KM).f1 : null,
    }));
    const cel = (v, c = 2) => (v === null || v === undefined ? '—' : typeof v === 'number' ? num(v, c) : esc(v));
    this.$('rd-tabela-geral').innerHTML = `<table><thead><tr><th>SRE</th><th>Extensão (km)</th><th>Intervalos</th><th>Seg. func.</th><th>Seg. estrut.</th><th>Seg. comb.</th><th>Penalidade estrut.</th><th class="txt">Origem</th><th>Shapiro p</th><th>Ljung-Box p</th><th>F1 vs. sua seg.</th></tr></thead><tbody>${
      linhas.map((l) => `<tr class="clicavel" data-s="${esc(l.s)}"><td>${esc(l.s)}</td><td>${cel(l.ext)}</td><td>${l.n}</td><td>${l.f}</td><td>${cel(l.e, 0)}</td><td>${l.c}</td><td>${cel(l.beta)}</td><td class="txt">${esc(l.origem)}</td><td>${cel(l.sw, 3)}</td><td>${cel(l.lb, 3)}</td><td>${cel(l.f1)}</td></tr>`).join('')}</tbody></table>`;
    this.$('rd-tabela-geral').querySelectorAll('tr.clicavel').forEach((tr) => tr.addEventListener('click', () => { this.$('rd-sre').value = tr.dataset.s; this.mostrarSre(tr.dataset.s); }));
  }

  mostrarSre(s) {
    if (!s || !this.res) return;
    this.sreAtual = s;
    const q = this.res.porSre[s];
    const a = this.grupos[s];
    const r = q.r;
    GP.grafPasso(this.$('rd-graf-sre'), a, r, { alvo: q.cam ? 'estrutural' : 'funcional', titulo: `SRE ${esc(s)} · penalidade estrutural ${q.beta === null ? '—' : num(q.beta, 2)} · α_km ${num(this.res.alpha, 4)}`, comparar: this.usuario?.[s] });
    const linhas = M.explicarPasso(a, { ...r, penalidade: q.beta ?? this.res.alpha }, null, q.cam, q.cam ? 'estrutural' : 'funcional', this.res.p).filter((l) => !l.startsWith('Primeiro passo'));
    const fus = TIPOS.map((t) => (r.fusoes[t].length ? `${t}: ${r.fusoes[t].length} quebra(s) fundida(s) (${r.fusoes[t].map((x) => `km ${num(a.ini[x.quebra], 1)}, p = ${num(x.p, 3)}`).join('; ')})` : null)).filter(Boolean);
    const cot = q.cotovelo ? `Cotovelo próprio do SRE: K = ${q.cotovelo[0]} quebras com penalidade ${num(q.cotovelo[1], 2)}.` : 'O SRE tem poucas soluções no caminho para um cotovelo próprio.';
    this.$('rd-explicacao').innerHTML = `<h3>Por que esta segmentação</h3><ul>${[...linhas, q.cam ? cot : 'Sem d0 suficiente: só a segmentação funcional existe.', ...fus.map((f) => `Fusões — ${f}`),
      `PELT bruto antes das fusões: funcional ${r.bruto.funcional}, estrutural ${r.bruto.estrutural}, combinada ${r.bruto.combinada} quebras.`].map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
    const cols = [['tipo', 'Tipo'], ['seg_id', 'Seg.'], ['km_inicial', 'km inicial'], ['km_final', 'km final'], ['comprimento_km', 'Comprimento'], ['n_intervalos', 'Intervalos'],
      ['d0_medio', 'd0 médio'], ['d0_desvio', 'd0 desvio'], ['d0_cv', 'd0 CV'], ['igg_medio', 'IGG médio'], ['igg_cv', 'IGG CV'], ['iri_medio', 'IRI médio'], ['iri_cv', 'IRI CV'], ['coerente', 'Coerente']];
    const cel = (v) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : esc(v));
    this.$('rd-tabela-sre').innerHTML = `<table><thead><tr>${cols.map(([, rr]) => `<th>${rr}</th>`).join('')}</tr></thead><tbody>${q.segmentos.map((g) => `<tr>${cols.map(([k]) => `<td class="${k === 'tipo' ? 'txt' : ''}">${cel(g[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (this.raiz.querySelector('#rd-abas .aba.ativa')?.dataset.aba === 'sens') this.abrirSensibilidade(s);
    this.destacarNoMapa(s);
  }

  abrirSensibilidade(s) {
    const q = this.res.porSre[s];
    this.sens ||= new Sensibilidade(this.$('rd-sens'), { aoMudarPasso: (passo, i, rotulo) => this.desenharMapa(s, passo, rotulo) });
    if (this.sensSre === s) return;
    this.sensSre = s;
    this.sens.definir({ a: this.grupos[s], cam: q.cam, alphaRef: this.res.alpha, betaRef: q.beta ?? this.res.betaBase, betaMin: this.res.betaMin, sre: s, p: this.res.p });
  }

  // ── mapa dos resultados ──
  desenharMapa(sreSens = null, passo = null, rotulo = '') {
    if (!this.res) return;
    const geo = this.geometrias();
    if (!this.mapa) {
      this.mapa = L.map(this.$('rd-mapa'), { preferCanvas: true, zoomSnap: 0.25 });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(this.mapa);
      this.camada = L.layerGroup().addTo(this.mapa);
      this.render = L.canvas({ padding: 0.5, tolerance: 6 });
    }
    this.camada.clearLayers();
    const tipo = this.$('rd-tipo-mapa').value;
    const cores = ['#e8890c', '#2a78d6'];
    const limites = [];
    for (const [s, g] of Object.entries(geo)) {
      const q = this.res.porSre[s];
      if (!q || g.coords.length < 2) continue;
      const kmIni = q.r.km_min, kmFim = q.r.km_max;
      const ref = criarReferencia(g.coords, kmIni, kmFim);
      const src = s === sreSens && passo ? passo : q.r;
      const quebras = src[{ funcional: 'func_km', estrutural: 'estrut_km', combinada: 'comb_km' }[tipo]];
      const lim = [kmIni, ...quebras, kmFim];
      for (let i = 0; i < lim.length - 1; i++) {
        const p = L.polyline(ref.trecho(lim[i], lim[i + 1]), { renderer: this.render, color: cores[i % 2], weight: s === this.sreAtual ? 8 : 5, opacity: 0.95 });
        p.bindTooltip(`<strong>${esc(s)} · segmento ${i + 1}</strong> (${tipo})<br>km ${km(lim[i])} – ${km(lim[i + 1])} (${num(lim[i + 1] - lim[i], 2)} km)`
          + (s === sreSens && passo ? `<br>${esc(rotulo)}` : '') + `<br>geometria: ${g.origem === 'malha' ? 'malha cadastrada' : 'arquivo enviado'}`, { sticky: true, className: 'dica-sre' });
        p.on('click', () => { this.$('rd-sre').value = s; this.mostrarSre(s); });
        p.addTo(this.camada);
        limites.push(p);
      }
      quebras.forEach((k) => L.circleMarker(ref.ponto(k), { renderer: this.render, radius: 4.5, color: '#1d1d1f', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(this.camada));
    }
    this.$('rd-sem-geo').hidden = limites.length > 0;
    // enquadra depois que o cartão fica visível (o Leaflet mede o tamanho do mapa)
    setTimeout(() => {
      this.mapa.invalidateSize();
      if (limites.length && !this.enquadrado) { this.mapa.fitBounds(L.featureGroup(limites).getBounds(), { padding: [20, 20] }); this.enquadrado = true; }
    }, 80);
  }

  destacarNoMapa(s) {
    if (!this.mapa) return;
    this.desenharMapa();
    const g = this.geometrias()[s];
    if (g && this.enquadrado) this.mapa.fitBounds(L.polyline(g.coords.map(([x, y]) => [y, x])).getBounds(), { padding: [30, 30], maxZoom: 14 });
  }

  // ── downloads ──
  async baixarResultado(formato) {
    const res = this.res;
    const segs = Object.entries(res.porSre).flatMap(([s, q]) => q.segmentos.map((g) => ({ sre: s, ...g })));
    if (formato === 'csv') return baixarCsv('segmentacao_resultado.csv', segs);
    await carregarLib('xlsx');
    const wb = XLSX.utils.book_new();
    TIPOS.forEach((t) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(segs.filter((g) => g.tipo === t).map(({ tipo, ...g }) => g)), t.toUpperCase()));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(res.porSre).map(([s, q]) => ({
      sre: s, extensao_km: +(q.r.km_max - q.r.km_min).toFixed(3), n_intervalos: this.grupos[s].ini.length, penalidade_estrutural: q.beta, origem_penalidade: q.origem,
      alpha_km_funcional: res.alpha, penalidade_funcional_l2: q.r.pen_func, quebras_func_pelt: q.r.bruto.funcional, quebras_func: q.r.func_s.length,
      quebras_estrut: q.r.estrut_s.length, quebras_comb_pelt: q.r.bruto.combinada, quebras_comb: q.r.comb_s.length,
      cotovelo_k: q.cotovelo?.[0] ?? null, cotovelo_penalidade: q.cotovelo?.[1] ?? null, ...q.r.aud,
    }))), 'CENARIOS_SRE');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      ...Object.entries(res.p).map(([k, v]) => ({ parametro: k, valor: String(v) })),
      { parametro: 'modo da penalidade estrutural', valor: this.cfg.modoBeta }, { parametro: 'penalidade estrutural base', valor: res.betaBase },
      { parametro: 'penalidade minima da varredura', valor: res.betaMin }, { parametro: 'cotovelo do dataset', valor: res.betaRede },
      { parametro: 'modo do alpha_km', valor: this.cfg.modoAlpha }, { parametro: 'alpha_km funcional', valor: res.alpha },
    ]), 'PARAMETROS');
    XLSX.writeFile(wb, 'segmentacao_resultado.xlsx');
  }
}

function medianaComp(res, tipo) {
  const v = Object.values(res.porSre).flatMap((q) => q.segmentos.filter((g) => g.tipo === tipo).map((g) => g.comprimento_km)).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
}

// CSV com separador ; ou , (detectado na 1ª linha) e aspas duplas; decimal com vírgula é tratado em prepararDataset
function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const cab = texto.split(/\r?\n/, 1)[0] || '';
  const sep = (cab.match(/;/g) || []).length >= (cab.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  const fechar = () => { linha.push(campo); campo = ''; if (linha.some((c) => c !== '')) linhas.push(linha); linha = []; };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') aspas = false; else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; fechar(); }
    else campo += ch;
  }
  if (campo !== '' || linha.length) fechar();
  const [nomes = [], ...dados] = linhas;
  return dados.map((l) => Object.fromEntries(nomes.map((n, i) => [n.trim(), l[i] === undefined || l[i] === '' ? null : l[i]])));
}
