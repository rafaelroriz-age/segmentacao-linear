// Estatística usada pelo modelo (mesmas definições do numpy/scipy usados no notebook v8).
// Somas em pares como o numpy, para que médias e custos batam com o Python até o último bit
// sempre que possível; as distribuições (t, F, qui-quadrado, normal) têm precisão de ~1e-12.

// ── somas e momentos ──────────────────────────────────────────────────────────
// soma em pares do numpy (pairwise_sum, blocos de 8 e corte em 128)
export function soma(a, lo = 0, n = a.length - lo) {
  if (n < 8) {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[lo + i];
    return s;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let s = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) s += a[lo + i];
    return s;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return soma(a, lo, n2) + soma(a, lo + n2, n - n2);
}

export const media = (a) => soma(a) / a.length;

export function variancia(a, ddof = 0) {
  const m = media(a);
  return soma(a.map((x) => (x - m) * (x - m))) / (a.length - ddof);
}
export const desvio = (a, ddof = 0) => Math.sqrt(variancia(a, ddof));

export function mediana(a) {
  const s = Float64Array.from(a).sort();
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// quantil com interpolação linear (padrão do numpy e do pandas)
export function quantil(a, q) {
  const s = Float64Array.from(a).sort();
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const i = Math.floor(pos);
  return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (pos - i) : s[i];
}

export function linspace(a, b, n) {
  if (n === 1) return [a];
  const passo = (b - a) / (n - 1);
  const out = Array.from({ length: n }, (_, i) => i * passo + a);
  out[n - 1] = b;
  return out;
}

export const isclose = (a, b) => Math.abs(a - b) <= 1e-8 + 1e-5 * Math.abs(b);

// ── funções especiais ────────────────────────────────────────────────────────
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function lnGama(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGama(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// beta incompleta regularizada I_x(a, b) (fração contínua de Lentz)
function fracaoBeta(x, a, b) {
  const MIN = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < MIN) d = MIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < MIN) d = MIN;
    c = 1 + aa / c; if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < MIN) d = MIN;
    c = 1 + aa / c; if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

export function betaReg(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const ln = lnGama(a + b) - lnGama(a) - lnGama(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(ln) * fracaoBeta(x, a, b)) / a;
  return 1 - (Math.exp(ln) * fracaoBeta(1 - x, b, a)) / b;
}

// gama incompleta regularizada superior Q(a, x)
export function gamaQ(a, x) {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  const lnPre = -x + a * Math.log(x) - lnGama(a);
  if (x < a + 1) {
    let soma_ = 1 / a, termo = 1 / a;
    for (let n = 1; n < 1000; n++) {
      termo *= x / (a + n);
      soma_ += termo;
      if (Math.abs(termo) < Math.abs(soma_) * 1e-16) break;
    }
    return 1 - soma_ * Math.exp(lnPre);
  }
  const MIN = 1e-300;
  let b = x + 1 - a, c = 1 / MIN, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < MIN) d = MIN;
    c = b + an / c; if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(lnPre) * h;
}

// ── distribuições ────────────────────────────────────────────────────────────
export function normalSf(z) {   // P(Z > z)
  if (Number.isNaN(z)) return NaN;
  const q = 0.5 * gamaQ(0.5, (z * z) / 2);
  return z >= 0 ? q : 1 - q;
}
export const normalCdf = (z) => normalSf(-z);

// inversa da normal padrão (Acklam) com um passo de Newton
export function qnorm(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5, r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

export function tSf(t, df) {   // P(T > t)
  if (Number.isNaN(t)) return NaN;
  if (t === Infinity) return 0;
  if (t === -Infinity) return 1;
  const p = 0.5 * betaReg(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? p : 1 - p;
}

export function fSf(f, d1, d2) {   // P(F > f)
  if (Number.isNaN(f)) return NaN;
  if (f <= 0) return 1;
  if (f === Infinity) return 0;
  return betaReg(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

export const chi2Sf = (x, k) => gamaQ(k / 2, x / 2);

// ── testes (mesmas convenções de scipy.stats) ────────────────────────────────
// Welch: diferença de médias (ttest_ind com equal_var=False), p bilateral
export function welch(x, y) {
  const nx = x.length, ny = y.length;
  const mx = media(x), my = media(y);
  const vx = variancia(x, 1) / nx, vy = variancia(y, 1) / ny;
  const den = vx + vy;
  if (den === 0) return { t: mx === my ? NaN : Math.sign(mx - my) * Infinity, p: mx === my ? NaN : 0 };
  const t = (mx - my) / Math.sqrt(den);
  let df = (den * den) / ((vx * vx) / (nx - 1) + (vy * vy) / (ny - 1));
  if (Number.isNaN(df)) df = 1;
  return { t, df, p: 2 * tSf(Math.abs(t), df) };
}

// Brown-Forsythe: Levene centrado na mediana, k grupos
export function brownForsythe(grupos) {
  const k = grupos.length;
  const n = grupos.map((g) => g.length);
  const N = n.reduce((a, b) => a + b, 0);
  const z = grupos.map((g) => { const md = mediana(g); return g.map((v) => Math.abs(v - md)); });
  const zi = z.map((g) => media(g));
  const zb = soma(zi.map((v, i) => v * n[i])) / N;
  const numer = (N - k) * soma(zi.map((v, i) => n[i] * (v - zb) ** 2));
  const dvar = soma(z.map((g, i) => soma(g.map((v) => (v - zi[i]) ** 2))));
  const W = numer / ((k - 1) * dvar);
  return { W, p: fSf(W, k - 1, N - k) };
}

// Shapiro-Wilk (Royston, 1995, algoritmo AS R94 usado pelo scipy)
function poli(cc, x) {
  let r = cc[0];
  if (cc.length > 1) {
    let p = x * cc[cc.length - 1];
    for (let j = cc.length - 2; j > 0; j--) p = (p + cc[j]) * x;
    r += p;
  }
  return r;
}

export function shapiro(dados) {
  const x = Float64Array.from(dados).sort();
  const n = x.length;
  if (n < 3) return { w: NaN, p: NaN };
  const md = mediana(x);
  for (let i = 0; i < n; i++) x[i] -= md;
  const amp = x[n - 1] - x[0];
  if (amp < 1e-19) return { w: 1, p: 1 };
  const n2 = Math.floor(n / 2);
  const a = new Float64Array(n2);
  if (n === 3) a[0] = Math.SQRT1_2;
  else {
    const an25 = n + 0.25;
    const m = Array.from({ length: n2 }, (_, i) => qnorm((i + 1 - 0.375) / an25));
    const summ2 = 2 * m.reduce((s, v) => s + v * v, 0);
    const ssumm2 = Math.sqrt(summ2);
    const rsn = 1 / Math.sqrt(n);
    const a1 = poli([0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056], rsn) - m[0] / ssumm2;
    let i1, fac;
    if (n > 5) {
      i1 = 3;
      const a2 = -m[1] / ssumm2 + poli([0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633], rsn);
      fac = Math.sqrt((summ2 - 2 * m[0] ** 2 - 2 * m[1] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2));
      a[1] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * m[0] ** 2) / (1 - 2 * a1 ** 2));
    }
    a[0] = a1;
    for (let i = i1; i <= n2; i++) a[i - 1] = -m[i - 1] / fac;
  }
  // coeficientes na ordem de x: -a nas posições baixas, +a nas altas (antissimétricos)
  const coef = new Float64Array(n);
  for (let i = 0; i < n2; i++) { coef[i] = -a[i]; coef[n - 1 - i] = a[i]; }
  const xs = Array.from(x, (v) => v / amp);
  const mc = media(Array.from(coef)), mx = media(xs);
  let ssa = 0, ssx = 0, sax = 0;
  for (let i = 0; i < n; i++) {
    const u = coef[i] - mc, v = xs[i] - mx;
    ssa += u * u; ssx += v * v; sax += u * v;
  }
  const ssassx = Math.sqrt(ssa * ssx);
  const w1 = ((ssassx - sax) * (ssassx + sax)) / (ssa * ssx);
  const w = 1 - w1;
  if (n === 3) return { w, p: Math.max(1.90986 * (Math.asin(Math.sqrt(w)) - 1.04720), 0) };
  let y = Math.log(w1), mm, s;
  const lx = Math.log(n);
  if (n <= 11) {
    const gama = poli([-2.273, 0.459], n);
    if (y >= gama) return { w, p: 1e-99 };
    y = -Math.log(gama - y);
    mm = poli([0.544, -0.39978, 0.025054, -6.714e-4], n);
    s = Math.exp(poli([1.3822, -0.77857, 0.062767, -0.0020322], n));
  } else {
    mm = poli([-1.5861, -0.31082, -0.083751, 0.0038915], lx);
    s = Math.exp(poli([-0.4803, -0.082676, 0.0030302], lx));
  }
  return { w, p: normalSf((y - mm) / s) };
}

// Kolmogorov-Smirnov de uma amostra contra N(0,1); p exato de Marsaglia, Tsang e Wang (2003)
function ksCdf(n, d) {
  const s0 = d * d * n;
  if (s0 > 7.24 || (s0 > 3.76 && n > 99)) return 1 - 2 * Math.exp(-(2.000071 + 0.331 / Math.sqrt(n) + 1.409 / n) * s0);
  const k = Math.floor(n * d) + 1, m = 2 * k - 1, h = k - n * d;
  const H = Array.from({ length: m }, (_, i) => Float64Array.from({ length: m }, (_, j) => (i - j + 1 < 0 ? 0 : 1)));
  for (let i = 0; i < m; i++) { H[i][0] -= h ** (i + 1); H[m - 1][i] -= h ** (m - i); }
  H[m - 1][0] += 2 * h - 1 > 0 ? (2 * h - 1) ** m : 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i - j + 1 > 0) for (let g = 1; g <= i - j + 1; g++) H[i][j] /= g;
  const mult = (A, B) => A.map((linha, i) => Float64Array.from({ length: m }, (_, j) => { let s = 0; for (let t = 0; t < m; t++) s += linha[t] * B[t][j]; return s; }));
  function pot(A, e) {
    if (e === 1) return { M: A, ex: 0 };
    const { M: V, ex } = pot(A, Math.floor(e / 2));
    let B = mult(V, V), eB = 2 * ex;
    if (e % 2) B = mult(A, B);
    if (B[k - 1][k - 1] > 1e140) { B = B.map((l) => l.map((v) => v * 1e-140)); eB += 140; }
    return { M: B, ex: eB };
  }
  const { M: Q, ex } = pot(H, n);
  let s = Q[k - 1][k - 1], eQ = ex;
  for (let i = 1; i <= n; i++) { s = (s * i) / n; if (s < 1e-140) { s *= 1e140; eQ -= 140; } }
  return s * 10 ** eQ;
}

export function ksNormal(dados) {
  const x = Float64Array.from(dados).sort();
  const n = x.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const c = normalCdf(x[i]);
    d = Math.max(d, (i + 1) / n - c, c - i / n);
  }
  return { d, p: Math.min(Math.max(1 - ksCdf(n, d), 0), 1) };
}
