// Modelo de segmentação v8 (segmentacao_rede_v8_sensibilidade.ipynb) portado para JavaScript.
// Mesmas fórmulas, mesma ordem de operações e mesmos desempates do Python, para que o site possa
// refazer a segmentação com qualquer penalidade (análise de sensibilidade) ou rodar o modelo do zero
// num dataset do usuário. tools/validar_modelo_js.mjs compara este código com os resultados do notebook.
//
// Convenções do notebook: `a` = sinais de um SRE em intervalos de ~200 m ({ini, fim, d0, igg, iri, d0_obs});
// uma quebra é o índice do 1º intervalo do segmento seguinte; bkps do PELT incluem n no fim.
import * as E from './estatistica.js';

export const PADRAO = {
  MIN_SIZE: 3,              // nº mínimo de intervalos por segmento (3 × 200 m = 600 m)
  JUMP: 1,
  MARGEM_PEN: 0.5,          // funcional: banda ±50% em torno de α_km × extensão
  N_CAND_PEN: 9,            // funcional: nº de penalidades candidatas na banda (escolha por BIC)
  VAR_FLOOR_FRAC: 0.10,     // estrutural: piso de variância = (fração × desvio do d0 no SRE)²
  PELT_EXATO: true,
  CROPS_MAX_RUNS: 400,
  N_GRID_BETA: 400,
  N_MIN_COTOVELO_SRE: 4,
  FUNDIR_FUNC: true,
  FUNDIR_ESTRUT: false,
  FUNDIR_COMB: true,
  ALPHA_TESTE: 0.05,
  SUBSEGMENTAR_COMB: true,
  BUFFER_KM: 0.4,
  MIN_COMP_COMB_KM: 0.6,
  CV_LIMITE: 1.0,
  N_LAGS_ACF: 20,
  N_MIN_AUDITORIA: 8,
  N_MIN_CALIB: 50,
  N_SRES_CALIB: 120,
  BETA_MAX_QUANTIL: 0.9,
};

const MIN_SIZE_CUSTO = { l2: 1, normal: 2 };

// ── PELT ─────────────────────────────────────────────────────────────────────
export function prefixos(y) {
  const m = E.media(y);
  const n = y.length;
  const S1 = new Float64Array(n + 1), S2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = y[i] - m;
    S1[i + 1] = S1[i] + v;
    S2[i + 1] = S2[i] + v * v;
  }
  return [S1, S2];
}

function custo(modelo, t, e, P, piso) {
  const [S1, S2] = P;
  const n = e - t;
  const s1 = S1[e] - S1[t];
  const sq = S2[e] - S2[t];
  if (modelo === 'l2') return sq - (s1 * s1) / n;
  const v = Math.max(sq / n - (s1 / n) ** 2, 0);
  return n * Math.log(v + piso);
}

/** PELT com custo O(1) por segmento; devolve bkps no formato do ruptures (inclui n).
 *  exato = poda adiada (ótimo global exato com min_size > 1). */
export function pelt(y, modelo, minSize, jump, pen, P = null, piso = 0, exato = false) {
  const n = y.length;
  minSize = Math.max(minSize | 0, MIN_SIZE_CUSTO[modelo]);
  P = P || prefixos(y);
  const F = new Float64Array(n + 1).fill(Infinity);
  F[0] = 0;
  const prev = new Int32Array(n + 1);
  const valido = new Uint8Array(n + 1);
  valido[0] = 1;
  const saiEm = new Int32Array(n + 1).fill(n + 1);
  let adm = [];
  const ind = [];
  for (let k = 0; k < n; k += jump) if (k >= minSize) ind.push(k);
  ind.push(n);
  for (const bkp of ind) {
    const novo = Math.floor((bkp - minSize) / jump) * jump;
    if (novo >= 0) adm.push(novo);
    const ts = adm.filter((t) => valido[t] && saiEm[t] > bkp);
    if (!ts.length) throw new Error('sem partição admissível');
    const tot = ts.map((t) => F[t] + (custo(modelo, t, bkp, P, piso) + pen));
    let j = 0;
    for (let i = 1; i < tot.length; i++) if (tot[i] < tot[j]) j = i;
    F[bkp] = tot[j];
    prev[bkp] = ts[j];
    valido[bkp] = 1;
    if (exato) {
      for (let i = 0; i < ts.length; i++) if (tot[i] > F[bkp] + pen) saiEm[ts[i]] = Math.min(saiEm[ts[i]], bkp + minSize);
      adm = ts;
    } else {
      adm = ts.filter((_, i) => tot[i] <= F[bkp] + pen);
    }
  }
  const bkps = [];
  for (let e = n; e > 0; e = prev[e]) bkps.push(e);
  return bkps.reverse();
}

export function custoTotal(modelo, bkps, P, piso = 0) {
  let q = 0, ini = 0;
  for (const fim of bkps) { q += custo(modelo, ini, fim, P, piso); ini = fim; }
  return q;
}

export function pisoVariancia(d0, p = PADRAO) {
  const v = d0.filter(Number.isFinite);
  const s = v.length ? E.desvio(v) : 0;
  return Math.max((p.VAR_FLOOR_FRAC * s) ** 2, 1e-9);
}

// ── CROPS (Haynes, Eckley & Fearnhead, 2017): todas as segmentações ótimas do PELT 'normal' ──
export function cropsNormal(y, betaMin, p = PADRAO, piso = 1e-9) {
  const N = y.length;
  const P = prefixos(y);
  const sols = new Map([[0, [custoTotal('normal', [N], P, piso), [N]]]]);
  if (N < 2 * Math.max(p.MIN_SIZE, MIN_SIZE_CUSTO.normal)) return sols;
  const run = (beta) => {
    const bk = pelt(y, 'normal', p.MIN_SIZE, p.JUMP, beta, P, piso, p.PELT_EXATO);
    const K = bk.length - 1, Q = custoTotal('normal', bk, P, piso);
    if (!sols.has(K) || Q < sols.get(K)[0] - 1e-9) sols.set(K, [Q, bk]);
    return [K, sols.get(K)[0]];
  };
  const [Klo, Qlo] = run(betaMin);
  let bHi = Math.max(2 * betaMin, 1);
  let [Khi, Qhi] = run(bHi);
  let nRuns = 2;
  while (Khi > 0 && nRuns < p.CROPS_MAX_RUNS) { bHi *= 2; [Khi, Qhi] = run(bHi); nRuns++; }
  const pilha = [[betaMin, Klo, Qlo, bHi, Khi, Qhi]];
  while (pilha.length && nRuns < p.CROPS_MAX_RUNS) {
    const [b0, K0, Q0, b1, K1, Q1] = pilha.pop();
    if (K0 <= K1 + 1) continue;
    const bi = (Q1 - Q0) / (K0 - K1);
    if (!(b0 < bi && bi < b1)) continue;
    const [Ki, Qi] = run(bi);
    nRuns++;
    if (Ki !== K0 && Ki !== K1) pilha.push([b0, K0, Q0, bi, Ki, Qi], [bi, Ki, Qi, b1, K1, Q1]);
  }
  const hull = [];
  for (const K of [...sols.keys()].sort((a, b) => a - b)) {
    const q = sols.get(K)[0];
    while (hull.length >= 2) {
      const [k1, q1] = hull[hull.length - 2], [k2, q2] = hull[hull.length - 1];
      if ((k2 - k1) * (q - q1) - (q2 - q1) * (K - k1) <= 0) hull.pop();
      else break;
    }
    hull.push([K, q]);
  }
  return new Map(hull.map(([K]) => [K, sols.get(K)]));
}

/** caminho CROPS do SRE: Ks crescente, custo Q e faixa [inf, sup] de penalidade em que cada solução é ótima */
export function caminhoSre(a, betaMin, p = PADRAO) {
  const path = cropsNormal(a.d0, betaMin, p, pisoVariancia(a.d0, p));
  const Ks = [...path.keys()].sort((x, y) => x - y);
  const Q = Ks.map((k) => path.get(k)[0]);
  const sup = [Infinity, ...Ks.slice(1).map((k, i) => (Q[i] - Q[i + 1]) / (k - Ks[i]))];
  const inf = [...sup.slice(1), betaMin];
  return { Ks, Q, inf, sup, bkps: Object.fromEntries(Ks.map((k) => [k, path.get(k)[1]])) };
}

export function kOtimo(cam, beta) {
  let j = 0;
  for (let i = 1; i < cam.Ks.length; i++) if (cam.Q[i] + beta * cam.Ks[i] < cam.Q[j] + beta * cam.Ks[j]) j = i;
  return cam.Ks[j];
}

export function kneedleIdx(x, y) {
  if (x.length < 3) return 0;
  const ptp = (v) => Math.max(...v) - Math.min(...v);
  if (ptp(y) === 0) return 0;
  const xmin = Math.min(...x), ymin = Math.min(...y);
  const xn = x.map((v) => (v - xmin) / Math.max(ptp(x), 1e-12));
  const yn = y.map((v) => (v - ymin) / Math.max(ptp(y), 1e-12));
  const L = xn.length - 1;
  let j = 0, best = -1;
  for (let i = 0; i < xn.length; i++) {
    const d = Math.abs((yn[L] - yn[0]) * xn[i] - (xn[L] - xn[0]) * yn[i] + xn[L] * yn[0] - yn[L] * xn[0]);
    if (d > best) { best = d; j = i; }
  }
  return j;
}

/** cotovelo do próprio SRE (Biswas & Kuna, Figs. 8-9): [K*, penalidade no centro do intervalo de K*] */
export function cotoveloSre(cam, betaMin, p = PADRAO) {
  if (cam.Ks.length < p.N_MIN_COTOVELO_SRE) return null;
  const grid = E.linspace(betaMin, cam.sup[1], p.N_GRID_BETA);
  const ks = grid.map((b) => kOtimo(cam, b));
  const Kest = kOtimo(cam, grid[kneedleIdx(grid, ks)]);
  const i = cam.Ks.indexOf(Kest);
  const beta = Number.isFinite(cam.sup[i]) ? 0.5 * (cam.inf[i] + cam.sup[i]) : cam.sup[1] * 1.05;
  return [Kest, beta];
}

// ── funcional: PELT l2 sobre IGG padronizado, penalidade α_km × extensão com banda e BIC ──
export function bandaPenalidades(base, margem, n) {
  if (base <= 0 || margem <= 0 || n <= 1) return [Math.max(base, 0.05)];
  return E.linspace(Math.max(0.05, base * (1 - margem)), base * (1 + margem), n | 0);
}

function padronizar(x) {   // StandardScaler do scikit-learn
  const N = x.length;
  const m = E.soma(x) / N;
  const t = x.map((v) => v - m);
  const corr = E.soma(t);
  const v = (E.soma(t.map((u) => u * u)) - (corr * corr) / N) / N;
  let s = Math.sqrt(v);
  if (s < 10 * Number.EPSILON * Math.max(Math.abs(m), 1)) s = 1;
  return x.map((u) => (u - m) / s);
}

function bicL2(X, bkps) {
  const N = X.length;
  let sse = 0, ini = 0;
  for (const fim of bkps) {
    const pts = X.slice(ini, fim);
    const m = E.media(pts);
    sse += E.soma(pts.map((v) => (v - m) ** 2));
    ini = fim;
  }
  const L = bkps.length;
  return N * Math.log(Math.max(sse, 1e-12) / N) + (L + L - 1) * Math.log(N);
}

export const extensao = (a, lo, hi) => (hi < a.ini.length ? a.ini[hi] : Math.max(...a.fim.slice(lo, hi))) - Math.min(...a.ini.slice(lo, hi));

export function segmentarFuncional(a, alpha, p = PADRAO) {
  const N = a.igg.length;
  const pens = bandaPenalidades(alpha * extensao(a, 0, N), p.MARGEM_PEN, p.N_CAND_PEN);
  const Xs = N > 1 ? padronizar(a.igg) : [...a.igg];
  const P = prefixos(Xs);
  let melhor = null;
  const candidatos = [];
  for (const pen of pens) {
    let bk;
    try { bk = pelt(Xs, 'l2', p.MIN_SIZE, p.JUMP, pen, P); } catch { bk = [N]; }
    const bic = bicL2(Xs, bk);
    candidatos.push({ pen, quebras: bk.slice(0, -1), bic });
    if (!melhor || bic < melhor.bic) melhor = candidatos[candidatos.length - 1];
  }
  return { quebras: melhor.quebras, pen: melhor.pen, bic: melhor.bic, candidatos };
}

// ── fusão de seções vizinhas sem diferença significativa (Welch e Brown-Forsythe) ──
function pWelch(x, y) {
  if (x.length < 2 || y.length < 2) return 1;
  const { p } = E.welch(x, y);
  if (Number.isNaN(p)) return E.isclose(E.media(x), E.media(y)) ? 1 : 0;
  return p;
}

function pBF(x, y) {
  if (x.length < 2 || y.length < 2) return 1;
  const { p } = E.brownForsythe([x, y]);
  if (Number.isNaN(p)) return E.isclose(E.variancia(x), E.variancia(y)) ? 1 : 0;
  return p;
}

/** funde seções consecutivas sem diferença em nenhuma série; devolve as quebras restantes e o registro
 *  de cada fusão (explicabilidade). series = [[array, testaVariancia, nome]] */
export function fundirTestes(inicios, series, N, alpha, registro = null) {
  const fr = [...inicios].map(Number).sort((x, y) => x - y);
  while (fr.length) {
    const lim = [0, ...fr, N];
    const ps = fr.map((_, i) => {
      let pv = 1;
      for (const [s, testaVar] of series) {
        const x = s.slice(lim[i], lim[i + 1]), y = s.slice(lim[i + 1], lim[i + 2]);
        pv = Math.min(pv, pWelch(x, y), testaVar ? pBF(x, y) : 1);
      }
      return pv;
    });
    let j = 0;
    for (let i = 1; i < ps.length; i++) if (ps[i] > ps[j]) j = i;
    if (ps[j] <= alpha) break;
    if (registro) registro.push({ quebra: fr[j], p: ps[j] });
    fr.splice(j, 1);
  }
  return fr;
}

export function segmentarEstruturalTrecho(d0, lo, hi, beta, piso, p = PADRAO) {
  if (hi - lo < 2 * p.MIN_SIZE) return [];
  const bk = pelt(d0.slice(lo, hi), 'normal', p.MIN_SIZE, p.JUMP, beta, null, piso, p.PELT_EXATO);
  return bk.slice(0, -1).map((b) => lo + b);
}

export function reconciliarCombinada(funcKm, subKm, kmMin, kmMax, p = PADRAO) {
  const fronteiras = [...subKm];
  for (const fk of funcKm) if (!subKm.some((sk) => Math.abs(fk - sk) <= p.BUFFER_KM)) fronteiras.push(fk);
  const ord = [...new Set(fronteiras)].sort((x, y) => x - y);
  const limpas = [];
  let ultimo = kmMin;
  for (const f of ord) {
    if (f - ultimo >= p.MIN_COMP_COMB_KM && kmMax - f >= p.MIN_COMP_COMB_KM) { limpas.push(f); ultimo = f; }
  }
  return limpas;
}

function searchsorted(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

// ── atributos dos segmentos ──────────────────────────────────────────────────
const arred = (v, c) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** c) / 10 ** c);

function mediaCv(v) {
  if (!v.length) return [null, null];
  const m = E.media(v);
  const s = v.length > 1 ? E.desvio(v) : 0;
  return [m, Math.abs(m) > 1e-9 ? s / Math.abs(m) : NaN];
}

function atributos(a, lo, hi, kmA, kmB, p) {
  const fat = (k) => a[k].slice(lo, hi);
  const d0 = fat('d0'), igg = fat('igg'), iri = fat('iri');
  const [d0m, d0cv] = mediaCv(d0), [iggm, iggcv] = mediaCv(igg), [irim, iricv] = mediaCv(iri);
  const cvs = [d0cv, iggcv, iricv].filter((c) => c !== null && !Number.isNaN(c));
  const sd = (v) => (v.length > 1 && v.every(Number.isFinite) ? E.desvio(v, 1) : null);
  const d0sd = sd(d0), iggsd = sd(igg), irisd = sd(iri);
  const obs = a.d0_obs ? a.d0_obs.slice(lo, hi) : [];
  return {
    km_inicial: arred(kmA, 3), km_final: arred(kmB, 3), comprimento_km: arred(kmB - kmA, 3), n_intervalos: hi - lo,
    d0_medio: arred(d0m, 2), d0_desvio: arred(d0sd, 2), d0_erro_padrao: d0sd === null ? null : arred(d0sd / Math.sqrt(hi - lo), 2),
    d0_cv: arred(d0cv, 3), d0_frac_medido: obs.length ? arred(obs.filter(Boolean).length / obs.length, 3) : null,
    igg_medio: arred(iggm, 2), igg_desvio: arred(iggsd, 2), igg_cv: arred(iggcv, 3),
    iri_medio: arred(irim, 2), iri_desvio: arred(irisd, 2), iri_cv: arred(iricv, 3),
    coerente: cvs.length > 0 && Math.max(...cvs) <= p.CV_LIMITE,
  };
}

export function montarSegmentos(tipo, inicios, a, kmMin, kmMax, p = PADRAO) {
  const N = a.ini.length;
  const ord = [...inicios].sort((x, y) => x - y);
  const idx = [0, ...ord, N];
  const kms = [kmMin, ...ord.map((s) => a.ini[s]), kmMax];
  return idx.slice(0, -1).map((lo, i) => ({ tipo, seg_id: i + 1, ...atributos(a, lo, idx[i + 1], kms[i], kms[i + 1], p) }));
}

// ── auditoria dos resíduos estruturais (Biswas & Kuna, "Test of Assumptions") ──
export function residuosSegmentos(y, obs, inicios) {
  const N = y.length;
  const lim = [0, ...[...inicios].sort((a, b) => a - b), N];
  const r = new Array(N).fill(NaN), z = new Array(N).fill(NaN), grupos = [], nsd = [];
  for (let i = 0; i < lim.length - 1; i++) {
    const idx = [];
    for (let k = lim[i]; k < lim[i + 1]; k++) if (obs[k]) idx.push(k);
    if (!idx.length) continue;
    const v = idx.map((k) => y[k]);
    const m = E.media(v);
    idx.forEach((k) => { r[k] = y[k] - m; });
    if (idx.length > 1) {
      const sd = E.desvio(v, 1);
      nsd.push([idx.length, sd]);
      grupos.push(idx.map((k) => r[k]));
      if (sd > 0) idx.forEach((k) => { z[k] = r[k] / sd; });
    }
  }
  return { r, z, grupos, nsd };
}

export function auditarResiduos(y, obs, inicios, p = PADRAO) {
  const { r, z, grupos, nsd } = residuosSegmentos(y, obs, inicios);
  const rr = r.filter(Number.isFinite), zz = z.filter(Number.isFinite);
  const out = { n_residuos: rr.length, n_segmentos: inicios.length + 1 };
  const ptp = (v) => Math.max(...v) - Math.min(...v);
  if (rr.length < p.N_MIN_AUDITORIA || zz.length < 3 || ptp(zz) === 0) return { aud: out, z };
  const sw = zz.length <= 5000 ? E.shapiro(zz) : { w: NaN, p: NaN };
  const ks = E.ksNormal(zz);
  const swBruto = rr.length >= 3 && rr.length <= 5000 && ptp(rr) > 0 ? E.shapiro(rr).p : NaN;
  const n = rr.length;
  const h = Math.max(1, Math.min(p.N_LAGS_ACF, Math.floor(n / 4)));
  const mr = E.media(rr);
  const rc = rr.map((v) => v - mr);
  const den = rc.reduce((s, v) => s + v * v, 0);
  const acf = [];
  for (let k = 1; k <= h; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += rc[i] * rc[i + k];
    acf.push(den > 0 ? s / den : 0);
  }
  const banda = 1.96 / Math.sqrt(n);
  const lbQ = n * (n + 2) * acf.reduce((s, v, i) => s + (v * v) / (n - (i + 1)), 0);
  const lbP = E.chi2Sf(lbQ, h);
  const validos = grupos.filter((g) => g.length >= 2);
  const bfP = validos.length >= 2 ? E.brownForsythe(validos).p : NaN;
  const sds = nsd.map(([, s]) => s).filter((s) => s > 0);
  Object.assign(out, {
    shapiro_w: arred(sw.w, 4), shapiro_p: arred(sw.p, 4), ks_d: arred(ks.d, 4), ks_p: arred(ks.p, 4),
    shapiro_p_res_bruto: arred(swBruto, 4), normalidade_ok: sw.p > p.ALPHA_TESTE && ks.p > p.ALPHA_TESTE,
    acf_lag1: arred(acf[0], 4), acf_max_abs: arred(Math.max(...acf.map(Math.abs)), 4), banda_acf_95: arred(banda, 4),
    lags_fora_banda: acf.filter((v) => Math.abs(v) > banda).length, n_lags: h,
    ljung_box_q: arred(lbQ, 3), ljung_box_p: arred(lbP, 4), independencia_ok: lbP > p.ALPHA_TESTE,
    brown_forsythe_p: arred(bfP, 4), heterocedastico: Number.isFinite(bfP) && bfP <= p.ALPHA_TESTE,
    razao_desvio_max_min: sds.length >= 2 ? arred(Math.max(...sds) / Math.min(...sds), 3) : null,
    erro_padrao_medio: nsd.length ? arred(E.media(nsd.map(([k, s]) => s / Math.sqrt(k))), 3) : null,
  });
  return { aud: out, z };
}

// ── segmentação de um SRE (funcional, estrutural e combinada) ────────────────
/** opts: { alphaFunc, beta, cam (caminho CROPS ou null), p, auditar } */
export function segmentarSre(a, { alphaFunc, beta, cam, p = PADRAO, auditar = true }) {
  const N = a.ini.length;
  const ini = a.ini;
  const kmMin = Math.min(...ini), kmMax = Math.max(...a.fim);
  const temIgg = N > 0 && a.igg.every(Number.isFinite);
  const temD0 = !!cam;
  const piso = pisoVariancia(a.d0, p);
  const fusoes = { funcional: [], estrutural: [], combinada: [] };

  // funcional
  let funcS = [], penFunc = null, candFunc = [];
  if (temIgg) {
    const f = segmentarFuncional(a, alphaFunc, p);
    funcS = f.quebras; penFunc = f.pen; candFunc = f.candidatos;
  }
  const nFuncBruto = funcS.length;
  if (p.FUNDIR_FUNC && temIgg) funcS = fundirTestes(funcS, [[a.igg, false]], N, p.ALPHA_TESTE, fusoes.funcional);

  // estrutural: solução do caminho CROPS na penalidade escolhida
  let estrutS = [];
  if (temD0) estrutS = cam.bkps[kOtimo(cam, beta)].slice(0, -1).map(Number);
  const nEstrutBruto = estrutS.length;
  if (p.FUNDIR_ESTRUT && temD0) estrutS = fundirTestes(estrutS, [[a.d0, true]], N, p.ALPHA_TESTE, fusoes.estrutural);

  // combinada em 2 etapas
  let subS = estrutS;
  if (temD0 && p.SUBSEGMENTAR_COMB) {
    const lims = [0, ...funcS, N];
    subS = [];
    for (let i = 0; i < lims.length - 1; i++) subS.push(...segmentarEstruturalTrecho(a.d0, lims[i], lims[i + 1], beta, piso, p));
  }
  const funcKm = funcS.map((s) => ini[s]);
  const combKm = reconciliarCombinada(funcKm, subS.map((s) => ini[s]), kmMin, kmMax, p);
  let combS = combKm.map((k) => searchsorted(ini, k));
  const nCombBruto = combS.length;
  if (p.FUNDIR_COMB) {
    const series = [...(temD0 ? [[a.d0, true]] : []), ...(temIgg ? [[a.igg, false]] : [])];
    if (series.length) combS = fundirTestes(combS, series, N, p.ALPHA_TESTE, fusoes.combinada);
  }

  let aud = { n_residuos: 0, n_segmentos: 1 }, z = null;
  if (temD0 && auditar && a.d0_obs) ({ aud, z } = auditarResiduos(a.d0, a.d0_obs, estrutS, p));

  return {
    func_s: funcS, estrut_s: estrutS, comb_s: combS, sub_s: subS,
    func_km: funcKm, estrut_km: estrutS.map((s) => ini[s]), comb_km: combS.map((s) => ini[s]),
    pen_func: penFunc, cand_func: candFunc, beta: temD0 ? beta : null, alpha: alphaFunc,
    bruto: { funcional: nFuncBruto, estrutural: nEstrutBruto, combinada: nCombBruto }, fusoes,
    aud, z, km_min: kmMin, km_max: kmMax, piso,
    segmentos: () => [
      ...montarSegmentos('funcional', funcS, a, kmMin, kmMax, p),
      ...montarSegmentos('estrutural', estrutS, a, kmMin, kmMax, p),
      ...montarSegmentos('combinada', combS, a, kmMin, kmMax, p),
    ],
  };
}

// ── análise de sensibilidade: penalidades crescentes ────────────────────────
/** penalidades da grade. modo 'caminho' = um passo por solução distinta do caminho CROPS (cada passo muda a
 *  segmentação estrutural); 'linear' | 'log' = n penalidades de min a max. Sempre inclui a referência. */
export function gradePenalidades(cam, betaRef, { modo = 'caminho', min, max, n = 12, maxPassos = 30 } = {}) {
  let pens;
  if (modo === 'caminho' && cam && cam.Ks.length > 1) {
    const Kref = kOtimo(cam, betaRef);
    pens = [];
    for (let j = cam.Ks.length - 1; j >= 0; j--) {
      if (cam.Ks[j] === Kref) pens.push(betaRef);
      else if (Number.isFinite(cam.sup[j])) pens.push(0.5 * (cam.inf[j] + cam.sup[j]));
      else pens.push(1.25 * cam.inf[j]);
    }
    if (pens.length > maxPassos) {
      const iR = pens.indexOf(betaRef);
      const idx = [...new Set([...E.linspace(0, pens.length - 1, maxPassos).map(Math.round), iR])].sort((x, y) => x - y);
      pens = idx.map((i) => pens[i]);
    }
    return pens;
  }
  n = Math.max(2, n | 0);
  pens = modo === 'log'
    ? E.linspace(Math.log(min), Math.log(max), n).map(Math.exp)
    : E.linspace(min, max, n);
  if (betaRef >= min && betaRef <= max && !pens.some((v) => Math.abs(v - betaRef) < 1e-9)) pens.push(betaRef);
  return pens.sort((x, y) => x - y);
}

/** segmentações do SRE para cada penalidade. alvo 'estrutural' varia β; 'funcional' varia α_km. */
export function passosSensibilidade(a, { alvo = 'estrutural', pens, alphaRef, betaRef, cam, p = PADRAO }) {
  return pens.map((pen) => {
    const alpha = alvo === 'funcional' ? pen : alphaRef;
    const beta = alvo === 'estrutural' ? pen : betaRef;
    const r = segmentarSre(a, { alphaFunc: alpha, beta, cam, p });
    r.penalidade = pen;
    r.fator = alvo === 'estrutural' ? pen / betaRef : pen / alphaRef;
    return r;
  });
}

// texto explicativo de um passo: o que o PELT minimiza, o que mudou e por que compensou
function desc(a, serie, lo, hi, un) {
  const v = serie.slice(lo, hi);
  const k0 = a.ini[lo], k1 = hi < a.ini.length ? a.ini[hi] : a.fim[a.fim.length - 1];
  const sd = v.length > 1 ? E.desvio(v, 1) : 0;
  return `km ${fmt(k0, 1)}–${fmt(k1, 1)} (média ${fmt(E.media(v), 1)}, desvio ${fmt(sd, 1)}${un})`;
}
const fmt = (v, c) => (v === null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }));

export function explicarPasso(a, passo, anterior, cam, alvo, p = PADRAO) {
  const chave = alvo === 'estrutural' ? 'estrut_s' : 'func_s';
  const [serie, un] = alvo === 'estrutural' ? [a.d0, ''] : [a.igg, ''];
  const pen = passo.penalidade;
  const L = [];
  if (alvo === 'estrutural') {
    L.push(`O PELT normal sobre d0 minimiza Q + penalidade × K, com Q = soma de n·log(variância) dos segmentos (−2 × log-verossimilhança) e K = nº de quebras.`);
    if (cam && cam.Ks.length > 1) {
      const K = passo.estrut_s.length;
      const j = cam.Ks.indexOf(K);
      if (j >= 0) L.push(`Com penalidade ${fmt(pen, 2)}, a melhor solução tem K = ${K} quebras (Q = ${fmt(cam.Q[j], 1)}); ela continua ótima para penalidades entre ${fmt(cam.inf[j], 2)} e ${Number.isFinite(cam.sup[j]) ? fmt(cam.sup[j], 2) : '∞'}.`);
    }
  } else {
    L.push(`O PELT l2 sobre o IGG padronizado minimiza a soma dos quadrados + penalidade × K; a penalidade é α_km × extensão, escolhida pelo BIC numa faixa de ±${Math.round(p.MARGEM_PEN * 100)}% (α_km = ${fmt(pen, 4)}; penalidade escolhida = ${fmt(passo.pen_func, 2)}).`);
  }
  if (!anterior) {
    L.push('Primeiro passo: penalidade mais fraca da sequência, maior número de quebras.');
  } else {
    const rem = anterior[chave].filter((b) => !passo[chave].includes(b));
    const nov = passo[chave].filter((b) => !anterior[chave].includes(b));
    L.push(`Desde o passo anterior (penalidade ${fmt(anterior.penalidade, 2)} → ${fmt(pen, 2)}): ${anterior[chave].length} → ${passo[chave].length} quebras (${rem.length} removidas, ${nov.length} novas).`);
    if (alvo === 'estrutural' && cam && cam.Ks.length > 1) {
      const K0 = anterior.estrut_s.length, K1 = passo.estrut_s.length;
      const j0 = cam.Ks.indexOf(K0), j1 = cam.Ks.indexOf(K1);
      if (j0 >= 0 && j1 >= 0 && K0 !== K1) {
        const dQ = cam.Q[j1] - cam.Q[j0];
        L.push(`Por quê: com ${K1} quebras o ajuste piora (Q sobe ${fmt(dQ, 1)}), mas a penalidade economiza ${fmt(pen, 2)} × ${K0 - K1} = ${fmt(pen * (K0 - K1), 1)}; a troca compensa a partir da penalidade ${fmt(dQ / (K0 - K1), 2)}.`);
      }
    }
    const lim0 = [0, ...anterior[chave], serie.length];
    rem.slice(0, 4).forEach((b) => { const i = lim0.indexOf(b); L.push(`− removida no km ${fmt(a.ini[b], 1)}: unia ${desc(a, serie, lim0[i - 1], b, un)} e ${desc(a, serie, b, lim0[i + 1], un)}.`); });
    const lim1 = [0, ...passo[chave], serie.length];
    nov.slice(0, 3).forEach((b) => { const i = lim1.indexOf(b); L.push(`+ nova no km ${fmt(a.ini[b], 1)}: separa ${desc(a, serie, lim1[i - 1], b, un)} de ${desc(a, serie, b, lim1[i + 1], un)}.`); });
    if (rem.length > 4 || nov.length > 3) L.push(`(… ${Math.max(rem.length - 4, 0)} removidas e ${Math.max(nov.length - 3, 0)} novas não listadas)`);
    L.push(`Combinada: ${anterior.comb_s.length + 1} → ${passo.comb_s.length + 1} segmentos.`);
  }
  const sw = passo.aud.shapiro_p, lb = passo.aud.ljung_box_p;
  if (sw !== null && sw !== undefined && Number.isFinite(sw)) {
    L.push(`Resíduos estruturais: Shapiro p = ${fmt(sw, 3)} (${sw > p.ALPHA_TESTE ? 'normalidade ok' : 'normalidade rejeitada'}) · Ljung-Box p = ${fmt(lb, 3)} (${lb > p.ALPHA_TESTE ? 'independentes' : 'autocorrelacionados: indício de quebras de menos'}).`);
  }
  return L;
}

/** concordância entre quebras (km): [quebras da ref. com uma do cenário a ≤ tol, quebras do cenário com uma da ref.] */
export function concordancia(refKm, km, tol) {
  if (!refKm.length || !km.length) return [0, 0];
  const r = refKm.filter((x) => km.some((y) => Math.abs(x - y) <= tol)).length;
  const c = km.filter((y) => refKm.some((x) => Math.abs(x - y) <= tol)).length;
  return [r, c];
}

export function f1Quebras(refKm, km, tol) {
  const [r, c] = concordancia(refKm, km, tol);
  const R = refKm.length ? r / refKm.length : 1, P = km.length ? c / km.length : 1;
  return { recall: R, precisao: P, f1: R + P > 0 ? (2 * R * P) / (R + P) : 0 };
}

// ── preparo de um dataset bruto (mesma leitura do notebook, Célula 3) ────────
/** linhas: [{sre, sre_segmento?, km_inicial, km_final, igg, iri_medio, d0}] → { sre: a } */
export function prepararDataset(linhas) {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return NaN;
    const x = typeof v === 'number' ? v : Number(String(v).trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(x) ? x : NaN;
  };
  const temSeg = linhas.some((l) => l.sre_segmento !== undefined && l.sre_segmento !== null && l.sre_segmento !== '');
  const grupos = new Map();
  for (const l of linhas) {
    const sre = String(l.sre ?? '').trim();
    if (!sre) continue;
    const ki = num(l.km_inicial), kf = num(l.km_final);
    const chave = temSeg ? `${sre}\u0000${l.sre_segmento}` : `${sre}\u0000${ki}\u0000${kf}`;
    if (!grupos.has(chave)) grupos.set(chave, { sre, ki: [], kf: [], igg: [], iri: [], d0: [] });
    const g = grupos.get(chave);
    g.ki.push(ki); g.kf.push(kf); g.igg.push(num(l.igg)); g.iri.push(num(l.iri_medio ?? l.iri)); g.d0.push(num(l.d0));
  }
  const mediaFin = (v) => { const f = v.filter(Number.isFinite); return f.length ? E.media(f) : NaN; };
  const porSre = new Map();
  for (const g of grupos.values()) {
    const ki = g.ki.filter(Number.isFinite), kf = g.kf.filter(Number.isFinite);
    if (!ki.length || !kf.length) continue;
    const r = { ini: Math.min(...ki), fim: Math.max(...kf), igg: mediaFin(g.igg), iri: mediaFin(g.iri), d0: mediaFin(g.d0) };
    if (!porSre.has(g.sre)) porSre.set(g.sre, []);
    porSre.get(g.sre).push(r);
  }
  const out = {};
  for (const [sre, rs] of [...porSre.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    rs.sort((x, y) => x.ini - y.ini);
    const a = { ini: rs.map((r) => r.ini), fim: rs.map((r) => r.fim), d0_obs: rs.map((r) => Number.isFinite(r.d0)),
      igg_obs: rs.map((r) => Number.isFinite(r.igg)), iri_obs: rs.map((r) => Number.isFinite(r.iri)) };
    for (const c of ['igg', 'iri', 'd0']) a[c] = interpolar(rs.map((r) => r[c]));
    a.centro = a.ini.map((v, i) => 0.5 * (v + a.fim[i]));
    const m = a.d0.every(Number.isFinite) ? E.media(a.d0) : NaN;
    let acc = 0;
    a.aca = a.d0.map((v) => (acc += v - m));
    out[sre] = a;
  }
  return out;
}

// interpolação linear por posição (pandas interpolate(limit_direction='both')) e mediana nos restantes
function interpolar(v) {
  const idx = v.map((x, i) => (Number.isFinite(x) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return v.map(() => NaN);
  return v.map((x, i) => {
    if (Number.isFinite(x)) return x;
    if (i < idx[0]) return v[idx[0]];
    if (i > idx[idx.length - 1]) return v[idx[idx.length - 1]];
    let k = 0;
    while (idx[k + 1] < i) k++;
    const i0 = idx[k], i1 = idx[k + 1];
    return v[i0] + ((v[i1] - v[i0]) * (i - i0)) / (i1 - i0);
  });
}

/** arrays do modelo a partir dos intervalos de um SRE do banco (dados_sre) */
export function arraysDoBanco(intervalos) {
  const a = { ini: [], fim: [], d0: [], igg: [], iri: [], aca: [], d0_obs: [], igg_obs: [], iri_obs: [] };
  for (const i of intervalos) {
    a.ini.push(i.km_inicial); a.fim.push(i.km_final);
    a.d0.push(i.d0 ?? NaN); a.igg.push(i.igg ?? NaN); a.iri.push(i.iri ?? NaN); a.aca.push(i.aca ?? NaN);
    a.d0_obs.push(!!i.d0_obs); a.igg_obs.push(!!i.igg_obs); a.iri_obs.push(!!i.iri_obs);
  }
  a.centro = a.ini.map((v, i) => 0.5 * (v + a.fim[i]));
  return a;
}

export const temD0 = (a, p = PADRAO) => a.d0.length >= 2 * p.MIN_SIZE && a.d0.every(Number.isFinite);

// ── calibração em um dataset inteiro (Célula 5) ──────────────────────────────
/** penalidade mínima da varredura: ln(N mediano dos SREs com d0 e N ≥ N_MIN_CALIB) */
export function betaMinimo(grupos, p = PADRAO) {
  const N = Object.values(grupos).filter((a) => a.d0.every(Number.isFinite)).map((a) => a.d0.length);
  if (!N.length) return null;
  const base = N.filter((n) => n >= p.N_MIN_CALIB);
  return Math.log(E.mediana(base.length ? base : N));
}

/** diagnóstico da rede: nº total de quebras × penalidade e o cotovelo (β da rede) */
export function diagnosticoRede(caminhos, betaMin, p = PADRAO) {
  const zeros = Object.values(caminhos).filter((c) => c.Ks.length > 1).map((c) => c.sup[1]);
  const bMax = zeros.length ? E.quantil(zeros, p.BETA_MAX_QUANTIL) : 10 * betaMin;
  const grid = E.linspace(betaMin, Math.max(bMax, betaMin * 1.01), p.N_GRID_BETA);
  const K = grid.map(() => 0);
  for (const c of Object.values(caminhos)) grid.forEach((b, i) => { K[i] += kOtimo(c, b); });
  return { grid, K, betaRede: grid[kneedleIdx(grid, K)] };
}

/** calibração funcional: α_km que minimiza a soma do BIC numa amostra estratificada por comprimento */
export function calibrarFuncional(grupos, p = PADRAO, grade = null) {
  grade = grade || Array.from({ length: 29 }, (_, i) => Math.round((0.05 + 0.0125 * i) * 1e4) / 1e4);
  let cand = Object.entries(grupos).filter(([, a]) => a.igg.every(Number.isFinite)).map(([s, a]) => [s, a.igg.length]);
  cand.sort((x, y) => x[1] - y[1]);
  let sel = cand.filter(([, n]) => n >= p.N_MIN_CALIB);
  if (!sel.length) sel = cand.slice(-10);
  if (sel.length > p.N_SRES_CALIB) {
    const idx = [...new Set(E.linspace(0, sel.length - 1, p.N_SRES_CALIB).map(Math.round))];
    sel = idx.map((i) => sel[i]);
  }
  if (!sel.length) return null;
  const soma = grade.map(() => 0), nq = grade.map(() => 0);
  for (const [s] of sel) {
    const a = grupos[s];
    const ext = Math.max(extensao(a, 0, a.ini.length), 1e-9);
    grade.forEach((al, i) => { const f = segmentarFuncional(a, al, p); soma[i] += f.bic; nq[i] += f.quebras.length / ext / sel.length; });
  }
  let j = 0;
  for (let i = 1; i < soma.length; i++) if (soma[i] < soma[j]) j = i;
  return { alpha: grade[j], grade, somaBic: soma, quebrasPorKm: nq, sres: sel.map(([s]) => s) };
}
