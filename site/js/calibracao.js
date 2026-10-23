// Penalidade de referência para cada combinação de parâmetros. Cada sinal/modelo tem escala própria, então a
// penalidade estrutural é o cotovelo da curva "quebras na malha × penalidade" refeito para a combinação, e o
// α_km funcional é recalibrado pelo BIC quando o parâmetro funcional não é o IGG. A combinação padrão
// (IGG + D0 normal) usa os valores do notebook gravados no banco. O cálculo roda num Web Worker, uma vez por
// combinação, e fica guardado neste navegador.
import { carregarIntervalos } from './dados.js';
import { arraysDoBanco, ehPadrao } from './modelo.js';

const memoria = new Map();
let gruposMalha = null;

const chaveEst = (meta, cfg) => `calib2:${meta.gerado_em}:estrut:${cfg.estrut}|${cfg.modelo}`;
const chaveFunc = (meta, cfg) => `calib2:${meta.gerado_em}:func:${cfg.func}`;
const ler = (k) => { if (memoria.has(k)) return memoria.get(k); try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const gravar = (k, v) => { memoria.set(k, v); try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

/** { beta, betaMin, alpha, diag } da combinação; progresso(texto) recebe mensagens de andamento */
export async function referencia(cfg, rede, progresso = () => {}) {
  const { meta } = rede;
  const base = { beta: meta.beta_rede, betaMin: meta.beta_min, alpha: meta.alpha_km_func, origem: 'notebook' };
  if (ehPadrao(cfg)) return base;
  const precisaEst = !(cfg.estrut === 'd0' && cfg.modelo === 'normal');
  const precisaFunc = cfg.func !== 'igg';
  const est = precisaEst ? ler(chaveEst(meta, cfg)) : { beta: base.beta, betaMin: base.betaMin };
  const fun = precisaFunc ? ler(chaveFunc(meta, cfg)) : { alpha: base.alpha };
  if (est && fun) return { ...est, ...fun, origem: 'calibrado' };

  if (!gruposMalha) {
    const sres = rede.sres.filter((s) => s.tem_dados).map((s) => s.sre);
    progresso(`Lendo os intervalos de ${sres.length.toLocaleString('pt-BR')} SREs para calibrar a penalidade…`);
    const r = await carregarIntervalos(sres, false);
    gruposMalha = {};
    for (const [s, iv] of Object.entries(r.intervalos)) if (iv.length) gruposMalha[s] = arraysDoBanco(iv);
  }
  const res = await new Promise((ok, falha) => {
    const w = new Worker(new URL('./trabalhador.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.tipo === 'progresso') progresso(`${m.etapa}${m.total > 1 ? ` (${m.feito}/${m.total})` : ''}…`);
      else { w.terminate(); m.tipo === 'erro' ? falha(new Error(m.mensagem)) : ok(m.resultado); }
    };
    w.onerror = (e) => { w.terminate(); falha(new Error(e.message)); };
    w.postMessage({ tipo: 'calibrar', grupos: gruposMalha, cfg, estrut: !est, func: !fun });
  });
  const e2 = est || { beta: res.betaRede, betaMin: res.betaMin, diag: res.diag };
  const f2 = fun || { alpha: res.alpha };
  if (!est) gravar(chaveEst(meta, cfg), e2);
  if (!fun) gravar(chaveFunc(meta, cfg), f2);
  return { ...e2, ...f2, origem: 'calibrado' };
}
