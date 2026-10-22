// Web Worker: roda o modelo v8 inteiro (calibração + segmentação) num dataset sem travar a página.
// Mensagem de entrada: { grupos: {sre: a}, cfg: { p, modoBeta, betaFixo, betaMalha, modoAlpha, alphaFixo, alphaMalha } }
import * as M from './modelo.js';

const progresso = (etapa, feito, total) => postMessage({ tipo: 'progresso', etapa, feito, total });

onmessage = (ev) => {
  try {
    postMessage({ tipo: 'fim', resultado: rodar(ev.data.grupos, ev.data.cfg) });
  } catch (err) {
    postMessage({ tipo: 'erro', mensagem: err.message || String(err) });
  }
};

function rodar(grupos, cfg) {
  const p = { ...M.PADRAO, ...cfg.p };
  const sres = Object.keys(grupos);
  const t0 = Date.now();

  // 1. caminho CROPS de cada SRE com d0 (PELT normal, todas as soluções ótimas)
  const betaMin = M.betaMinimo(grupos, p) ?? Math.log(20);
  const caminhos = {};
  const comD0 = sres.filter((s) => M.temD0(grupos[s], p));
  comD0.forEach((s, i) => {
    caminhos[s] = M.caminhoSre(grupos[s], betaMin, p);
    if (i % 20 === 0) progresso('Caminho de penalidades (CROPS) dos SREs com d0', i, comD0.length);
  });

  // 2. penalidade estrutural
  let diag = null, betaRede = null;
  if (comD0.length) {
    diag = M.diagnosticoRede(caminhos, betaMin, p);
    betaRede = diag.betaRede;
  }
  const betaBase = { rede: betaRede ?? cfg.betaMalha, malha: cfg.betaMalha, sre: betaRede ?? cfg.betaMalha, fixo: cfg.betaFixo }[cfg.modoBeta] ?? cfg.betaMalha;

  // 3. quociente de penalidade funcional
  let calib = null, alpha = cfg.alphaMalha;
  if (cfg.modoAlpha === 'fixo') alpha = cfg.alphaFixo;
  else if (cfg.modoAlpha === 'calibrar') {
    progresso('Calibração funcional (α_km pelo BIC)', 0, 1);
    calib = M.calibrarFuncional(grupos, p);
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
    const r = M.segmentarSre(a, { alphaFunc: alpha, beta, cam, p });
    const segmentos = r.segmentos();
    delete r.segmentos;
    porSre[s] = { r, segmentos, cam, cotovelo: cot, beta: cam ? beta : null, origem: cam ? origem : 'sem d0' };
    if (i % 20 === 0) progresso('Segmentação funcional, estrutural e combinada', i, sres.length);
  });
  progresso('Concluído', 1, 1);
  return { betaMin, betaRede, betaBase, diag, alpha, calib, porSre, p, segundos: (Date.now() - t0) / 1000 };
}
