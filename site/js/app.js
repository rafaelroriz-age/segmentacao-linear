import { modoLocal, carregarRede, carregarSre, carregarSegmentosRede, carregarIntervalos } from './dados.js';
import { Mapa } from './mapa.js';
import * as G from './graficos.js';
import * as M from './modelo.js';
import { Sensibilidade } from './sensibilidade.js';
import { num, km, fatorTxt, esc, TIPOS, residuosPadronizados, baixarCsv, SITUACOES, NOMES_SITUACAO, CORES_SITUACAO } from './util.js';
import { baixarExcel, baixarPng, abasDoSre, linhasSegmentosRede } from './exportar.js';

const $ = (id) => document.getElementById(id);
const estado = { rede: null, mapa: null, pac: null, sre: null, tipoTabela: 'combinada', fatorTabela: 1, paramRegional: 'iri', redeDesenhada: false, rodar: null, sens: null, sensSre: null };
const CHAVE_KM = { funcional: 'func_km', estrutural: 'estrut_km', combinada: 'comb_km' };

// ── carregamento ──────────────────────────────────────────────────────────────
function carregando(txt) {
  $('carregando').hidden = !txt;
  if (txt) $('carregando-txt').textContent = txt;
}

function erro(msg) {
  carregando(null);
  alert(msg);
}

async function iniciar() {
  if (modoLocal) $('aviso-local').hidden = false;
  carregando('Carregando a malha…');
  try {
    estado.rede = await carregarRede();
    // requisito: só SREs pavimentados (PAV, DUP, EOD) aparecem, mesmo que o banco traga outros
    estado.rede.sres = estado.rede.sres.filter((s) => SITUACOES.includes(s.situacao));
  } catch (err) {
    return erro(err.message);
  }
  carregando(null);
  montarPainel();
  ligarNavegacao();
  const doHash = () => new URLSearchParams(location.hash.slice(1)).get('sre');
  window.addEventListener('hashchange', () => { const s = doHash(); if (s && s !== estado.sre) selecionarSre(s); });
  if (doHash()) selecionarSre(doHash());
}

// ── navegação ────────────────────────────────────────────────────────────────
function ligarNavegacao() {
  document.querySelectorAll('.aba-topo').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.aba-topo').forEach((x) => x.classList.toggle('ativa', x === b));
    document.querySelectorAll('.pagina').forEach((p) => p.classList.toggle('ativa', p.id === `pagina-${b.dataset.pagina}`));
    if (b.dataset.pagina === 'rede' && !estado.redeDesenhada) { montarRede(); estado.redeDesenhada = true; }
    if (b.dataset.pagina === 'metodo' && !estado.metodo) { estado.metodo = true; import('./metodo.js').then((m) => m.montarMetodo()); }
    if (b.dataset.pagina === 'rodar') abrirRodar();
    if (b.dataset.pagina === 'painel') { estado.mapa.invalidar(); G.redimensionar($('pagina-painel')); }
  }));
  document.querySelectorAll('#abas-sre .aba').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#abas-sre .aba').forEach((x) => x.classList.toggle('ativa', x === b));
    document.querySelectorAll('#detalhe .painel-aba').forEach((p) => p.classList.toggle('ativo', p.id === `aba-${b.dataset.aba}`));
    desenharAba(b.dataset.aba);
  }));
}

const abaAtiva = () => document.querySelector('#abas-sre .aba.ativa').dataset.aba;

async function abrirRodar() {
  if (estado.rodar) return;
  const { Rodar } = await import('./rodar.js');
  estado.rodar = new Rodar($('pagina-rodar'), {
    rede: estado.rede,
    aoMostrarNoMapa: (geojson, rotulo) => estado.mapa.mostrarExtra(geojson, rotulo),
  });
}

// ── painel: parâmetros, regionais e mapa ─────────────────────────────────────
function montarPainel() {
  const { resumo_classes: resumo, classe_limite: limites, sres, meta } = estado.rede;
  G.grafParametros('graf-parametros', resumo, limites);
  $('legenda-classes').innerHTML = G.legendaClasses(limites);
  G.grafRegional('graf-regional', resumo, limites, estado.paramRegional);
  document.querySelectorAll('#chips-regional .chip').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#chips-regional .chip').forEach((x) => x.classList.toggle('ativo', x === b));
    estado.paramRegional = b.dataset.param;
    G.grafRegional('graf-regional', resumo, limites, estado.paramRegional);
  }));

  const ext = sres.reduce((a, s) => a + (s.extensao_km || 0), 0);
  $('mapa-sub').textContent = `${num(sres.length, 0)} SREs · ${num(ext, 0)} km`;
  montarResumo(sres, ext, meta);
  $('lista-sres').innerHTML = sres.map((s) => `<option value="${esc(s.sre)}">${esc(s.rodovia || '')} · km ${km(s.km_inicial)}–${km(s.km_final)}</option>`).join('');
  $('busca-sre').addEventListener('change', (e) => {
    const v = e.target.value.trim().toUpperCase();
    if (sres.some((s) => s.sre === v)) selecionarSre(v);
  });

  estado.mapa = new Mapa('mapa', selecionarSre, {
    segmentos: carregarSegmentosRede,
    intervalos: (lista) => carregarIntervalos(lista, true),
  }, (info) => {
    $('nivel-texto').textContent = info.texto;
    document.querySelectorAll('#niveis-mapa .nivel').forEach((n) => n.classList.toggle('ativo', n.dataset.n === info.nivel));
    $('legenda-mapa').innerHTML = estado.mapa.legenda();
  });
  estado.mapa.carregarMalha(sres, limites);
  $('modo-mapa').addEventListener('change', (e) => estado.mapa.definirModo(e.target.value));
  $('camada-mapa').addEventListener('change', (e) => estado.mapa.definirCamada(e.target.value));
  $('tipo-mapa').addEventListener('change', (e) => { estado.mapa.definirTipo(e.target.value); redesenharDetalheMapa(); });
  document.querySelectorAll('#niveis-mapa .nivel').forEach((n) => n.addEventListener('click', () => {
    const zoom = { sre: 8, seg: 11, int: 14 }[n.dataset.n];
    $('camada-mapa').value = 'auto';
    estado.mapa.definirCamada('auto');
    // com um SRE selecionado, aproxima nele; senão, no centro atual
    const linha = estado.sre && estado.mapa.linhas.get(estado.sre);
    if (linha) estado.mapa.map.setView(linha.getBounds().getCenter(), zoom);
    else estado.mapa.map.setZoom(zoom);
  }));
  $('det-fechar').addEventListener('click', fecharDetalhe);
  $('metodo-meta').textContent = `Dados gerados em ${meta.gerado_em} a partir de ${meta.entrada} (${meta.notebook}). Penalidade estrutural da rede = ${num(meta.beta_rede, 2)}; α_km funcional = ${num(meta.alpha_km_func, 4)}.`;
}

function montarResumo(sres, ext, meta) {
  const comDados = sres.filter((s) => s.tem_dados).length;
  const nInt = sres.reduce((a, s) => a + (s.n_intervalos || 0), 0);
  $('res-extensao').textContent = `${num(ext, 0)} km`;
  $('res-extensao-det').textContent = `${num(sres.length, 0)} SREs (${num(comDados, 0)} com dados) em ${num(new Set(sres.map((s) => s.rodovia)).size, 0)} rodovias`;
  $('res-intervalos').textContent = num(nInt || meta.n_intervalos || 0, 0);
  $('res-regionais').textContent = num(new Set(sres.map((s) => s.regional).filter((r) => r !== null)).size, 0);
  const porSit = SITUACOES.map((k) => {
    const lst = sres.filter((s) => s.situacao === k);
    return { k, n: lst.length, km: lst.reduce((a, s) => a + (s.extensao_km || 0), 0) };
  });
  const pct = (v) => num((100 * v) / (ext || 1), v / (ext || 1) < 0.01 ? 1 : 0);
  $('barra-composicao').innerHTML = porSit.map((s) => `<div style="flex:${s.km} 1 0;background:${CORES_SITUACAO[s.k]}"></div>`).join('');
  $('barra-composicao').setAttribute('aria-label', porSit.map((s) => `${s.k} ${pct(s.km)}%`).join(', '));
  $('legenda-composicao').innerHTML = porSit.map((s) => `<li><i style="background:${CORES_SITUACAO[s.k]}"></i><strong>${s.k}</strong><em>${NOMES_SITUACAO[s.k]}</em><span>${num(s.km, 0)} km · ${pct(s.km)}% · ${num(s.n, 0)} SREs</span></li>`).join('');
  $('rodape-lat').textContent = `Modelo v8 · dados de ${String(meta.gerado_em || '').slice(0, 10).split('-').reverse().join('/')}`;
}

// segmentação do SRE selecionado no mapa: modelo atual do tipo escolhido, ou o passo da sensibilidade
function redesenharDetalheMapa() {
  const pac = estado.pac;
  if (!pac) return;
  const tipo = $('tipo-mapa').value;
  if (estado.passoMapa && abaAtiva() === 'sens') {
    const { passo, rotulo } = estado.passoMapa;
    estado.mapa.desenharDetalhe(pac, passo[CHAVE_KM[tipo]], rotulo.replace('combinada', tipo));
    return;
  }
  const segs = pac.segmentos.filter((g) => g.fator === 1 && g.tipo === tipo).sort((a, b) => a.seg_id - b.seg_id);
  estado.mapa.desenharDetalhe(pac, segs.slice(1).map((g) => g.km_inicial), `${tipo}, modelo atual`, segs);
}

// ── detalhe do SRE ───────────────────────────────────────────────────────────
async function selecionarSre(sre) {
  estado.sre = sre;
  estado.fatorTabela = 1;
  estado.passoMapa = null;
  history.replaceState(null, '', `#sre=${encodeURIComponent(sre)}`);
  estado.mapa.selecionar(sre);
  $('busca-sre').value = sre;
  carregando(`Carregando ${sre}…`);
  let pac;
  try {
    pac = await carregarSre(sre);
  } catch (err) {
    return erro(err.message);
  }
  if (estado.sre !== sre) return;   // outro SRE foi clicado enquanto carregava
  carregando(null);
  estado.pac = pac;
  estado.a = pac.intervalos.length ? M.arraysDoBanco(pac.intervalos) : null;
  estado.cam = null;
  $('detalhe').hidden = false;
  cabecalho(pac);
  redesenharDetalheMapa();
  montarSelFatorTabela();
  desenharAba(abaAtiva());
  $('detalhe').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fecharDetalhe() {
  $('detalhe').hidden = true;
  estado.sre = null; estado.pac = null; estado.passoMapa = null;
  estado.sens?.parar();
  estado.mapa.limparSelecao();
  history.replaceState(null, '', location.pathname + location.search);
}

const kpi = (rot, val, det = '') => `<div class="kpi"><div class="rot">${rot}</div><div class="val">${val}</div>${det ? `<div class="det">${det}</div>` : ''}</div>`;
const cenario = (pac, f) => pac.cenarios.find((c) => c.fator === f);

function cabecalho(pac) {
  const s = pac.sre;
  $('det-rodovia').textContent = `${s.rodovia || ''} · Regional ${s.regional ?? '—'} · ${s.situacao || ''} · ${s.jurisdicao || ''}`;
  $('det-titulo').textContent = `SRE ${s.sre}`;
  $('det-trecho').textContent = `${s.inicio || ''} → ${s.fim || ''} · km ${km(s.km_inicial)} a ${km(s.km_final)}`;
  const c = cenario(pac, 1);
  $('det-kpis').innerHTML = [
    kpi('Extensão', `${num(s.extensao_km, 2)} km`, `${s.n_intervalos} intervalos de 200 m`),
    kpi('Segmentos combinados', s.n_seg_combinada ?? '—', 'modelo atual'),
    kpi('Segmentos estruturais', s.n_seg_estrutural ?? '—', c && c.beta_estrut !== null ? `penalidade ${num(c.beta_estrut, 2)}` : 'sem d0'),
    kpi('Segmentos funcionais', s.n_seg_funcional ?? '—', c && c.pen_func !== null ? `penalidade ${num(c.pen_func, 2)}` : 'sem IGG'),
    kpi('d0 médio', num(s.d0_medio, 1), `${s.classe_d0} · 0,01 mm`),
    kpi('IGG médio', num(s.igg_medio, 1), s.classe_igg),
    kpi('IRI médio', num(s.iri_medio, 2), `${s.classe_iri} · m/km`),
  ].join('');
}

function desenharAba(aba) {
  const pac = estado.pac;
  if (!pac) return;
  if (aba !== 'sens' && estado.passoMapa) { estado.passoMapa = null; redesenharDetalheMapa(); }
  if (!pac.intervalos.length) {
    $('nota-modelo').textContent = 'Este SRE não tem intervalos com dados no dataset analítico.';
    $('sens-sre').innerHTML = '<p class="nota">Este SRE não tem intervalos com dados no dataset analítico.</p>';
    estado.sensSre = null;
    return;
  }
  if (aba === 'modelo') desenharModelo(pac);
  else if (aba === 'sens') desenharSens(pac);
  else if (aba === 'dados') desenharDados(pac);
  else desenharTabela(pac);
}

function desenharModelo(pac) {
  const meta = estado.rede.meta;
  const c = cenario(pac, 1) || {};
  const origem = { rede: 'penalidade da rede (cotovelo)', cotovelo_sre: 'cotovelo do próprio SRE', fallback_rede: 'penalidade da rede', sem_d0: 'sem d0' }[c.origem_beta] || c.origem_beta;
  $('nota-modelo').innerHTML = `Modelo atual: funcional <strong>${c.quebras_func + 1}</strong> · estrutural <strong>${c.quebras_estrut + 1}</strong> · combinada <strong>${c.quebras_comb + 1}</strong> segmentos. `
    + (c.beta_estrut !== null && c.beta_estrut !== undefined ? `Penalidade estrutural = ${num(c.beta_estrut, 2)} (${esc(origem)}). ` : 'Sem d0 suficiente para a segmentação estrutural. ')
    + `d0 medido em ${num(100 * (c.frac_d0_medido || 0), 0)}% dos intervalos.`;
  G.grafPerfil('graf-perfil', pac, 1);
  const marcas = [];
  if (c.beta_estrut !== null && c.beta_estrut !== undefined) marcas.push({ beta: c.beta_estrut, cor: G.corFator([1], 0, 0), largura: 2.2, rotulo: `penalidade usada: ${num(c.beta_estrut, 2)}` });
  if (c.beta_cotovelo_sre) marcas.push({ beta: c.beta_cotovelo_sre, cor: getComputedStyle(document.documentElement).getPropertyValue('--texto-mudo').trim(), traco: 'dash', rotulo: `cotovelo do SRE: ${num(c.beta_cotovelo_sre, 2)} (K=${c.k_cotovelo_sre})` });
  G.grafCrops('graf-crops', pac.crops, meta.beta_min, marcas, null);
  const z = residuosPadronizados(pac.intervalos, pac.segmentos.filter((s) => s.fator === 1 && s.tipo === 'estrutural'));
  const a = pac.auditoria.find((x) => x.fator === 1) || {};
  $('sub-qq').textContent = a.shapiro_p !== null && a.shapiro_p !== undefined
    ? `Shapiro-Wilk p = ${num(a.shapiro_p, 3)} · KS p = ${num(a.ks_p, 3)} · Ljung-Box p = ${num(a.ljung_box_p, 3)}`
    : 'Auditoria não aplicável (poucos d0 medidos).';
  G.grafQQ('graf-qq', z);
  tabelaAuditoria(pac);
}

function okFalha(v, inverso = false) {
  if (v === null || v === undefined) return '<td>—</td>';
  const bom = inverso ? !v : v;
  return `<td class="${bom ? 'ok' : 'falha'}">${v ? 'sim' : 'não'}</td>`;
}

function tabelaAuditoria(pac) {
  const cols = ['Cenário', 'Penalidade', 'Segmentos', 'Resíduos', 'Shapiro p', 'KS p', 'Normalidade', 'ACF lag 1', 'Ljung-Box p', 'Independência', 'Brown-Forsythe p', 'Heterocedástico', 'Erro padrão médio'];
  const linhas = pac.auditoria.map((a) => `<tr class="${a.fator === 1 ? 'ref' : ''}"><td>${fatorTxt(a.fator)}${a.fator === 1 ? ' (ref.)' : ''}</td><td>${num(a.beta, 2)}</td><td>${a.n_segmentos}</td><td>${a.n_residuos}</td>`
    + `<td>${num(a.shapiro_p, 3)}</td><td>${num(a.ks_p, 3)}</td>${okFalha(a.normalidade_ok)}<td>${num(a.acf_lag1, 3)}</td><td>${num(a.ljung_box_p, 3)}</td>${okFalha(a.independencia_ok)}`
    + `<td>${num(a.brown_forsythe_p, 3)}</td>${okFalha(a.heterocedastico, true)}<td>${num(a.erro_padrao_medio, 2)}</td></tr>`).join('');
  $('tab-auditoria').innerHTML = `<table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>`;
}

// ── sensibilidade do SRE: grade de penalidades calculada no navegador ────────
function desenharSens(pac) {
  if (!estado.sens) {
    estado.sens = new Sensibilidade($('sens-sre'), {
      aoMudarPasso: (passo, i, rotulo) => {
        estado.passoMapa = { passo, rotulo };
        if (abaAtiva() === 'sens') redesenharDetalheMapa();
      },
    });
  }
  if (estado.sensSre === estado.sre) { redesenharDetalheMapa(); return; }
  const { meta } = estado.rede;
  const a = estado.a;
  if (!estado.cam && M.temD0(a)) estado.cam = M.caminhoSre(a, meta.beta_min);
  const c = cenario(pac, 1) || {};
  estado.sensSre = estado.sre;
  estado.sens.definir({ a, cam: estado.cam, alphaRef: meta.alpha_km_func, betaRef: c.beta_estrut ?? meta.beta_rede, betaMin: meta.beta_min, sre: estado.sre });
}

// ── planilha de saída ────────────────────────────────────────────────────────
function montarSelFatorTabela() {
  const sel = $('sel-fator-tabela');
  sel.innerHTML = estado.rede.meta.fatores.map((f) => `<option value="${f}" ${f === 1 ? 'selected' : ''}>${fatorTxt(f)} da penalidade${f === 1 ? ' (modelo atual)' : ''}</option>`).join('');
}

const COLS_SEG = [
  ['seg_id', 'Seg.', 0], ['km_inicial', 'km inicial', 3], ['km_final', 'km final', 3], ['comprimento_km', 'Comprimento (km)', 3], ['n_intervalos', 'Intervalos', 0],
  ['d0_medio', 'd0 médio', 2], ['d0_desvio', 'd0 desvio', 2], ['d0_erro_padrao', 'd0 erro padrão', 2], ['d0_cv', 'd0 CV', 3], ['d0_frac_medido', 'd0 medido', 3],
  ['igg_medio', 'IGG médio', 2], ['igg_desvio', 'IGG desvio', 2], ['igg_cv', 'IGG CV', 3], ['iri_medio', 'IRI médio', 2], ['iri_desvio', 'IRI desvio', 2], ['iri_cv', 'IRI CV', 3], ['coerente', 'Coerente', -1],
];

function linhasTabela(pac) {
  return pac.segmentos.filter((s) => s.tipo === estado.tipoTabela && s.fator === estado.fatorTabela).sort((a, b) => a.seg_id - b.seg_id);
}

function desenharTabela(pac) {
  const linhas = linhasTabela(pac);
  const corpo = linhas.map((s) => `<tr>${COLS_SEG.map(([k, , casas]) => (casas < 0 ? okFalha(s[k]) : `<td>${casas === 0 ? s[k] ?? '—' : num(s[k], casas)}</td>`)).join('')}</tr>`).join('');
  $('tab-segmentos').innerHTML = `<table><thead><tr>${COLS_SEG.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead><tbody>${corpo || '<tr><td>Sem segmentos.</td></tr>'}</tbody></table>`;
}

document.querySelectorAll('#chips-tipo .chip').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#chips-tipo .chip').forEach((x) => x.classList.toggle('ativo', x === b));
  estado.tipoTabela = b.dataset.tipo;
  if (estado.pac) desenharTabela(estado.pac);
}));
$('sel-fator-tabela').addEventListener('change', (e) => {
  estado.fatorTabela = Number(e.target.value);
  if (estado.pac) desenharTabela(estado.pac);
});
$('btn-csv').addEventListener('click', () => {
  if (!estado.pac) return;
  const linhas = linhasTabela(estado.pac).map((s) => ({ sre: estado.sre, tipo: s.tipo, fator: s.fator, ...Object.fromEntries(COLS_SEG.map(([k]) => [k, s[k]])) }));
  baixarCsv(`${estado.sre}_${estado.tipoTabela}_${fatorTxt(estado.fatorTabela)}.csv`, linhas);
});

// ── dados de 200 m ───────────────────────────────────────────────────────────
function linhasDados(pac) {
  return pac.intervalos.map((iv, i) => ({ sre: pac.sre.sre, intervalo: i + 1, km_inicial: iv.km_inicial, km_final: iv.km_final, d0: iv.d0, d0_medido: iv.d0_obs,
    igg: iv.igg, igg_medido: iv.igg_obs, iri: iv.iri, iri_medido: iv.iri_obs, aca: iv.aca }));
}

function desenharDados(pac) {
  const sn = (v) => `<td class="${v ? '' : 'interp'}">${v ? 'sim' : 'não'}</td>`;
  const corpo = linhasDados(pac).map((l) => `<tr><td>${l.intervalo}</td><td>${km(l.km_inicial)}</td><td>${km(l.km_final)}</td><td>${num(l.d0, 2)}</td>${sn(l.d0_medido)}`
    + `<td>${num(l.igg, 2)}</td>${sn(l.igg_medido)}<td>${num(l.iri, 3)}</td>${sn(l.iri_medido)}<td>${num(l.aca, 2)}</td></tr>`).join('');
  $('tab-dados').innerHTML = `<table><thead><tr><th>Intervalo</th><th>km inicial</th><th>km final</th><th>d0</th><th>d0 medido</th><th>IGG</th><th>IGG medido</th><th>IRI</th><th>IRI medido</th><th>ACA</th></tr></thead><tbody>${corpo}</tbody></table>`;
}
$('btn-csv-dados').addEventListener('click', () => { if (estado.pac) baixarCsv(`${estado.sre}_intervalos_200m.csv`, linhasDados(estado.pac)); });

// ── sensibilidade: escolher um SRE e ver a segmentação com várias penalidades ──
function montarRede() {
  const { sens_rede: sr, meta } = estado.rede;
  const sres = estado.rede.sres.filter((s) => s.tem_dados && s.n_intervalos >= 6);
  $('sens-lista').innerHTML = sres.map((s) => `<option value="${esc(s.sre)}">${esc(s.rodovia || '')} · ${num(s.extensao_km, 1)} km · ${s.n_seg_combinada ?? '—'} seg.</option>`).join('');
  const regs = [...new Set(sres.map((s) => s.regional).filter((r) => r !== null))].sort((x, y) => x - y);
  $('sens-regional').innerHTML = '<option value="">Todas</option>' + regs.map((r) => `<option value="${r}">Regional ${r}</option>`).join('');
  const sugerir = () => {
    const reg = $('sens-regional').value, ord = $('sens-ordem').value;
    const lst = sres.filter((s) => !reg || String(s.regional) === reg).sort((x, y) => (
      ord === 'ext' ? y.extensao_km - x.extensao_km : ord === 'seg' ? (y.n_seg_combinada || 0) - (x.n_seg_combinada || 0) : x.sre.localeCompare(y.sre)));
    $('sens-sugestoes').innerHTML = lst.slice(0, 12).map((s) => `<button type="button" class="sugestao" data-sre="${esc(s.sre)}"><strong class="num">${esc(s.sre)}</strong><span>${esc(s.rodovia || '')} · ${num(s.extensao_km, 1)} km · ${s.n_seg_combinada ?? '—'} seg.</span></button>`).join('');
    $('sens-sugestoes').querySelectorAll('.sugestao').forEach((b) => b.addEventListener('click', () => analisarSre(b.dataset.sre)));
  };
  $('sens-regional').addEventListener('change', sugerir);
  $('sens-ordem').addEventListener('change', sugerir);
  const abrir = () => {
    const v = $('sens-busca').value.trim().toUpperCase();
    if (sres.some((s) => s.sre === v)) analisarSre(v);
    else $('sens-status').textContent = v ? `${v} não está entre os SREs com dados (PAV, DUP e EOD).` : 'Digite um código de SRE.';
  };
  $('sens-abrir').addEventListener('click', abrir);
  $('sens-busca').addEventListener('change', abrir);
  $('sens-busca').addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
  $('sens-ver-mapa').addEventListener('click', () => {
    document.querySelector('.aba-topo[data-pagina="painel"]').click();
    if (estado.sensRedeSre) selecionarSre(estado.sensRedeSre);
  });
  sugerir();
  $('sens-status').textContent = `${num(sres.length, 0)} SREs disponíveis. Escolha um na lista, digite o código ou clique numa sugestão.`;

  // panorama da malha (recolhido): só o que é mais fácil de ler
  const fatores = sr.map((r) => r.fator);
  const ref = sr[fatores.indexOf(1)].metricas;
  const kp = (t) => ({ funcional: 'func', estrutural: 'estrut', combinada: 'comb' }[t]);
  $('rede-kpis').innerHTML = TIPOS.map((t) => kpi(`Segmentos ${t}`, num(ref[`${kp(t)}_segmentos`], 0), `mediana ${num(ref[`${kp(t)}_comp_mediano_km`], 2)} km`)).join('');
  $('rede-sub').textContent = `Penalidade do modelo atual: ${num(meta.beta_rede, 2)} (cotovelo da curva quebras × penalidade da malha). Cenários: ${fatores.map(fatorTxt).join(', ')} dessa penalidade.`;
  const porTipo = (suf) => Object.fromEntries(TIPOS.map((t) => [t, sr.map((r) => r.metricas[`${kp(t)}_${suf}`])]));
  document.querySelector('.detalhes-rede').addEventListener('toggle', (e) => {
    if (!e.target.open || estado.panoramaDesenhado) return;
    estado.panoramaDesenhado = true;
    G.grafPorTipo('graf-rede-densidade', porTipo('quebras_por_km'), fatores, 'quebras por km', { formato: ':.3f' });
    G.grafComprimento('graf-rede-comp', sr, fatores);
  });
  const doHash = new URLSearchParams(location.hash.slice(1)).get('sre');
  analisarSre(estado.sre || doHash || sres.slice().sort((x, y) => y.extensao_km - x.extensao_km)[0].sre);
}

async function analisarSre(sre) {
  $('sens-busca').value = sre;
  $('sens-status').innerHTML = `<span class="spinner"></span> Calculando a segmentação de ${esc(sre)} para várias penalidades…`;
  let pac;
  try { pac = await carregarSre(sre); } catch (err) { $('sens-status').textContent = `Erro: ${err.message}`; return; }
  const { meta } = estado.rede;
  const a = M.arraysDoBanco(pac.intervalos);
  const cam = M.temD0(a) ? M.caminhoSre(a, meta.beta_min) : null;
  const c = pac.cenarios.find((x) => x.fator === 1) || {};
  const s = pac.sre;
  estado.sensRedeSre = sre;
  $('sens-rede-caixa').hidden = false;
  $('sens-rodovia').textContent = `${s.rodovia || ''} · Regional ${s.regional ?? '—'} · ${s.situacao || ''} · ${num(s.extensao_km, 2)} km · ${s.n_intervalos} intervalos`;
  $('sens-titulo').textContent = `SRE ${sre}`;
  estado.sensRede ||= new Sensibilidade($('sens-rede-comp'));
  estado.sensRede.definir({ a, cam, alphaRef: meta.alpha_km_func, betaRef: c.beta_estrut ?? meta.beta_rede, betaMin: meta.beta_min, sre });
  $('sens-status').textContent = cam ? '' : 'Este SRE não tem d0 suficiente: só a penalidade funcional pode variar.';
}

window.addEventListener('resize', () => { if (estado.pac) G.redimensionar($('detalhe')); });

// menu lateral recolhível (lembra a escolha neste navegador)
(() => {
  const app = document.querySelector('.app'), btn = $('recolher');
  const aplicar = (compacto) => {
    app.classList.toggle('compacto', compacto);
    btn.setAttribute('aria-expanded', String(!compacto));
    btn.title = btn.ariaLabel = compacto ? 'Expandir menu' : 'Recolher menu';
    setTimeout(() => { estado.mapa?.invalidar(); window.dispatchEvent(new Event('resize')); }, 250);
  };
  let guardado = false;
  try { guardado = localStorage.getItem('menu-compacto') === '1'; } catch { /* sem armazenamento */ }
  aplicar(guardado);
  btn.addEventListener('click', () => {
    const c = !app.classList.contains('compacto');
    aplicar(c);
    try { localStorage.setItem('menu-compacto', c ? '1' : '0'); } catch { /* sem armazenamento */ }
  });
})();

iniciar().catch((err) => erro(err.message));

// ── downloads (saídas padrão do modelo: planilhas e gráficos) ────────────────
const aviso = (btn, fn) => btn.addEventListener('click', async () => {
  const txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Gerando…';
  try { await fn(); } catch (err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = txt; }
});
const CAMPOS_SRE = ['sre', 'rodovia', 'classe_via', 'regional', 'situacao', 'jurisdicao', 'trecho', 'inicio', 'fim', 'km_inicial', 'km_final', 'extensao_km', 'tem_dados', 'n_intervalos',
  'iri_medio', 'igg_medio', 'd0_medio', 'classe_iri', 'classe_igg', 'classe_d0', 'n_seg_funcional', 'n_seg_estrutural', 'n_seg_combinada', 'beta_estrut'];
const linhasSres = () => estado.rede.sres.map((s) => Object.fromEntries(CAMPOS_SRE.map((k) => [k === 'beta_estrut' ? 'penalidade_estrutural' : k, s[k] ?? null])));

aviso($('dl-sres-csv'), async () => baixarCsv('sres_resumo.csv', linhasSres()));
aviso($('dl-cond-png'), async () => baixarPng('graf-parametros', 'condicao_dos_pavimentos', { largura: 1400, altura: 520 }));
aviso($('dl-malha-csv'), async () => {
  const tipo = $('tipo-mapa').value;
  const porSre = new Map(estado.rede.sres.map((s) => [s.sre, s]));
  baixarCsv(`segmentos_${tipo}_malha.csv`, linhasSegmentosRede(await carregarSegmentosRede(tipo), porSre, tipo));
});
aviso($('dl-malha-xlsx'), async () => {
  const porSre = new Map(estado.rede.sres.map((s) => [s.sre, s]));
  const abas = {};
  for (const t of TIPOS) abas[t.toUpperCase()] = linhasSegmentosRede(await carregarSegmentosRede(t), porSre, t);
  abas.SRES = linhasSres();
  abas.PARAMETROS = estado.rede.parametros.map((p) => ({ parametro: p.parametro, valor: p.valor }));
  await baixarExcel('segmentacao_malha', abas);
});

aviso($('dl-sre-xlsx'), async () => {
  if (!estado.pac) return;
  await baixarExcel(`${estado.sre}_segmentacao`, abasDoSre(estado.pac, estado.rede.parametros));
});
aviso($('dl-sre-csv'), async () => {
  if (!estado.pac) return;
  const linhas = linhasTabela(estado.pac).map((s) => ({ sre: estado.sre, tipo: s.tipo, fator: s.fator, ...Object.fromEntries(COLS_SEG.map(([k]) => [k, s[k]])) }));
  baixarCsv(`${estado.sre}_${estado.tipoTabela}.csv`, linhas);
});
aviso($('dl-sre-png'), async () => {
  if (!estado.pac) return;
  if (abaAtiva() !== 'modelo') {
    document.querySelector('#abas-sre [data-aba="modelo"]').click();
    await new Promise((r) => setTimeout(r, 700));
  }
  await baixarPng('graf-perfil', `${estado.sre}_perfil_longitudinal`, { largura: 1600, altura: 1500 });
});
