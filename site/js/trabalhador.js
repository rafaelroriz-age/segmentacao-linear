// Web Worker: roda o modelo v8 inteiro (calibração + segmentação) num dataset sem travar a página,
// ou só calibra a penalidade de referência de uma combinação de parâmetros na malha.
// Mensagens de entrada:
//   { grupos: {sre: a}, cfg: { p, modoBeta, betaFixo, betaMalha, modoAlpha, alphaFixo, alphaMalha, sinais } }
//   { tipo: 'calibrar', grupos, cfg: {func, estrut, modelo}, estrut: bool, func: bool }
import * as M from './modelo.js';

const progresso = (etapa, feito, total) => postMessage({ tipo: 'progresso', etapa, feito, total });

onmessage = (ev) => {
  try {
    const r = ev.data.tipo === 'calibrar' ? calibrar(ev.data) : rodar(ev.data.grupos, ev.data.cfg);
    postMessage({ tipo: 'fim', resultado: r });
  } catch (err) {
    postMessage({ tipo: 'erro', mensagem: err.message || String(err) });
  }
};

function calibrar({ grupos, cfg, estrut, func }) {
  const p = M.PADRAO;
  const out = {};
  if (estrut) {
    const sres = Object.keys(grupos).filter((s) => M.temEstrut(grupos[s], cfg, p));
    const betaMin = M.betaMinimo(grupos, p) ?? Math.log(20);   // ln(N mediano): vale para qualquer custo
    const caminhos = {};
    sres.forEach((s, i) => {
      caminhos[s] = M.caminhoSre(grupos[s], betaMin, p, cfg);
      if (i % 50 === 0) progresso('Calibrando a penalidade estrutural na malha', i, sres.length);
    });
    const diag = M.diagnosticoRede(caminhos, betaMin, p);
    Object.assign(out, { betaMin, betaRede: diag.betaRede, diag: { grid: diag.grid, K: diag.K } });
  }
  if (func) {
    progresso('Calibrando o quociente funcional (BIC)', 0, 1);
    const c = M.calibrarFuncional(grupos, p, null, cfg.func);
    out.alpha = c ? c.alpha : null;
  }
  return out;
}

function rodar(grupos, cfg) {
  const p = { ...M.PADRAO, ...cfg.p };
  const sinais = cfg.sinais || M.CFG_PADRAO;
  const sres = Object.keys(grupos);
  const t0 = Date.now();

  // 1. caminho CROPS de cada SRE com o sinal estrutural escolhido
  const betaMin = M.betaMinimo(grupos, p) ?? Math.log(20);
  const caminhos = {};
  const comEst = sres.filter((s) => M.temEstrut(grupos[s], sinais, p));
  comEst.forEach((s, i) => {
    caminhos[s] = M.caminhoSre(grupos[s], betaMin, p, sinais);
    if (i % 20 === 0) progresso('Caminho de penalidades (CROPS) dos SREs', i, comEst.length);
  });

  // 2. penalidade estrutural
  let diag = null, betaRede = null;
  if (comEst.length) {
    diag = M.diagnosticoRede(caminhos, betaMin, p);
    betaRede = diag.betaRede;
  }
  const betaBase = { rede: betaRede ?? cfg.betaMalha, malha: cfg.betaMalha, sre: betaRede ?? cfg.betaMalha, fixo: cfg.betaFixo }[cfg.modoBeta] ?? cfg.betaMalha;

  // 3. quociente de penalidade funcional
  let calib = null, alpha = cfg.alphaMalha;
  if (cfg.modoAlpha === 'fixo') alpha = cfg.alphaFixo;
  else if (cfg.modoAlpha === 'calibrar') {
    progresso('Calibração funcional (α_km pelo BIC)', 0, 1);
    calib = M.calibrarFuncional(grupos, p, null, sinais.func);
    if (calib) alpha = calib.alpha;
  }

  // 4. segmentação de cada SRE
  const porSre = {};
  sres.forEach((s, i) => {
    const a = grupos[s];
    const cam = caminhos[s] || null;
    const cot = cam ? M.cotoveloSre(cam, betaMin, p) : null;
    let beta = betaBase, origem = cfg.modoBeta;
    if (cfg.modoBeta === 'sre') {
      if (cot) beta = cot[1];
      else origem = 'rede (poucas soluções para cotovelo próprio)';
    }
    const r = M.segmentarSre(a, { alphaFunc: alpha, beta, cam, p, cfg: sinais });
    const segmentos = r.segmentos();
    delete r.segmentos;
    porSre[s] = { r, segmentos, cam, cotovelo: cot, beta: cam ? beta : null, origem: cam ? origem : 'sem sinal estrutural' };
    if (i % 20 === 0) progresso('Segmentação funcional, estrutural e combinada', i, sres.length);
  });
  progresso('Concluído', 1, 1);
  return { betaMin, betaRede, betaBase, diag, alpha, calib, porSre, p, sinais, segundos: (Date.now() - t0) / 1000 };
}
