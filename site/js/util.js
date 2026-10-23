// Utilidades: formatação, classes de condição, referência linear (km → coordenada) e estatística.

export const NOMES_PARAM = { iri: 'IRI', igg: 'IGG', d0: 'Deflexão (d0)' };
export const UNIDADES = { iri: 'm/km', igg: '', d0: '0,01 mm' };
export const TIPOS = ['funcional', 'estrutural', 'combinada'];
// só trechos pavimentados entram no modelo e no site: pavimentada, duplicada e em obras de duplicação
export const SITUACOES = ['PAV', 'DUP', 'EOD'];
export const NOMES_SITUACAO = { PAV: 'Pavimentada', DUP: 'Duplicada', EOD: 'Em obras de duplicação' };
export const CORES_SITUACAO = { PAV: '#C92A2A', DUP: '#E07A86', EOD: '#5C0F0F' };
export const NOMES_TIPO = { funcional: 'Funcional (IGG, l2)', estrutural: 'Estrutural (d0, PELT normal)', combinada: 'Combinada (2 etapas)' };

const nf = (casas) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const cacheNf = {};
export function num(v, casas = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return '∞';
  return (cacheNf[casas] ||= nf(casas)).format(v);
}
export const km = (v) => num(v, 3);
export const fatorTxt = (f) => `${String(+f.toFixed(2)).replace('.', ',')}x`;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// tipografia dos gráficos: grotesca neutra na interface, monoespaçada nos números dos eixos
export const FONTE_UI = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONTE_MONO = '"IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';

// ── mapa base cartográfico monocromático (Esri Light/Dark Gray Canvas), trocado junto com o tema ──
// Sem chave de API: os basemaps da CARTO (Positron/Dark Matter) passaram a devolver marca d'água
// "API KEY REQUIRED" sem chave. Os rótulos ficam numa camada separada, também em cinza.
const midiaEscura = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
export function temaEscuro() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : !!midiaEscura?.matches;
}
export const URL_MAPA_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
export function camadaBase(map) {
  const url = (tipo) => `${URL_MAPA_BASE}/World_${temaEscuro() ? 'Dark' : 'Light'}_Gray_${tipo}/MapServer/tile/{z}/{y}/{x}`;
  const opc = { maxNativeZoom: 16, maxZoom: 20 };
  const base = L.tileLayer(url('Base'), { ...opc, attribution: 'Base: Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  const rotulos = L.tileLayer(url('Reference'), opc).addTo(map);
  midiaEscura?.addEventListener('change', () => { base.setUrl(url('Base')); rotulos.setUrl(url('Reference')); });
  return base;
}

export function cssVar(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

// ── classes de condição (tabela classe_limite) ──
export function classesDe(limites, param) {
  return limites.filter((c) => c.parametro === param).sort((a, b) => a.ordem - b.ordem);
}
export function classificar(limites, param, valor) {
  const lst = classesDe(limites, param);
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return lst.find((c) => c.classe === 'Sem dado');
  return lst.find((c) => c.classe !== 'Sem dado' && (c.limite_sup === null || valor <= c.limite_sup)) || lst[lst.length - 1];
}

// ── referência linear: posição ao longo da geometria proporcional ao km do SRE ──
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dlat = (b[1] - a[1]) * r, dlon = (b[0] - a[0]) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function criarReferencia(coords, kmIni, kmFim) {
  const acum = [0];
  for (let i = 1; i < coords.length; i++) acum.push(acum[i - 1] + distM(coords[i - 1], coords[i]));
  const total = acum[acum.length - 1] || 1;
  const ext = kmFim - kmIni || 1;
  const pos = (k) => Math.min(Math.max((k - kmIni) / ext, 0), 1) * total;
  function ponto(d) {
    let i = 1;
    while (i < acum.length - 1 && acum[i] < d) i++;
    const seg = acum[i] - acum[i - 1] || 1;
    const t = Math.min(Math.max((d - acum[i - 1]) / seg, 0), 1);
    const a = coords[i - 1], b = coords[i];
    return [a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t]; // [lat, lon] para o Leaflet
  }
  // inverso: km do ponto da linha mais próximo de [lat, lon] e a distância até ela (m)
  function kmDe(lat, lon) {
    const kx = Math.cos(lat * Math.PI / 180);
    let melhor = Infinity, dist = 0;
    for (let i = 1; i < coords.length; i++) {
      const ax = coords[i - 1][0] * kx, ay = coords[i - 1][1], bx = coords[i][0] * kx, by = coords[i][1];
      const dx = bx - ax, dy = by - ay, px = lon * kx, py = lat;
      const t = dx || dy ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0), 1) : 0;
      const d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d2 < melhor) { melhor = d2; dist = acum[i - 1] + t * (acum[i] - acum[i - 1]); }
    }
    return { km: kmIni + (dist / total) * ext, distM: Math.sqrt(melhor) * 111320 };
  }
  return {
    kmDe,
    ponto: (k) => ponto(pos(k)),
    trecho(k0, k1) {
      const d0 = pos(k0), d1 = pos(k1);
      const out = [ponto(d0)];
      for (let i = 0; i < acum.length; i++) if (acum[i] > d0 && acum[i] < d1) out.push([coords[i][1], coords[i][0]]);
      out.push(ponto(d1));
      return out;
    },
  };
}

// ── estatística ──
// inversa da normal padrão (Acklam), para o gráfico Q-Q
export function qnorm(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// resíduos padronizados z = (d0 - média do segmento) / desvio (ddof=1), só nos d0 medidos
export function residuosPadronizados(intervalos, segmentos) {
  const z = [];
  for (const s of segmentos) {
    const v = intervalos.filter((i) => i.d0_obs && i.km_inicial >= s.km_inicial - 1e-6 && i.km_inicial < s.km_final - 1e-6).map((i) => i.d0);
    if (v.length < 2) continue;
    const m = v.reduce((x, y) => x + y, 0) / v.length;
    const sd = Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / (v.length - 1));
    if (sd > 0) v.forEach((x) => z.push((x - m) / sd));
  }
  return z;
}

export function baixarCsv(nome, linhas) {
  if (!linhas.length) return;
  const cols = Object.keys(linhas[0]);
  const cel = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(';'), ...linhas.map((l) => cols.map((c) => cel(l[c])).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
