// Exportação de segmentos homogêneos em Shapefile (polilinhas, WGS 84), sem bibliotecas externas:
// grava .shp, .shx, .dbf, .prj e .cpg de cada camada e compacta tudo num .zip (sem compressão).
import { criarReferencia } from './util.js';

const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const utf8 = new TextEncoder();

/** linha [[lon, lat], ...] do trecho km0–km1 de um SRE cuja geometria é coords ([[lon, lat], ...]) de kmIni a kmFim */
export function trechoLonLat(coords, kmIni, kmFim, k0, k1) {
  if (!coords || coords.length < 2) return null;
  return criarReferencia(coords, kmIni, kmFim).trecho(k0, k1).map(([lat, lon]) => [lon, lat]);
}

// ── .shp e .shx ──
function caixaDe(c) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of c) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
function gravarShp(geoms) {
  const conteudo = geoms.map((c) => (c && c.length >= 2 ? 44 + 4 + 16 * c.length : 4));
  const totalShp = 100 + conteudo.reduce((a, n) => a + 8 + n, 0);
  const shp = new DataView(new ArrayBuffer(totalShp));
  const shx = new DataView(new ArrayBuffer(100 + 8 * geoms.length));
  const caixas = geoms.filter((c) => c && c.length >= 2).map(caixaDe);
  const caixa = caixas.length
    ? [Math.min(...caixas.map((b) => b[0])), Math.min(...caixas.map((b) => b[1])), Math.max(...caixas.map((b) => b[2])), Math.max(...caixas.map((b) => b[3]))]
    : [0, 0, 0, 0];
  for (const [dv, bytes] of [[shp, totalShp], [shx, 100 + 8 * geoms.length]]) {
    dv.setInt32(0, 9994, false);
    dv.setInt32(24, bytes / 2, false);
    dv.setInt32(28, 1000, true);
    dv.setInt32(32, 3, true);   // PolyLine
    caixa.forEach((v, i) => dv.setFloat64(36 + 8 * i, v, true));
  }
  let o = 100;
  geoms.forEach((c, i) => {
    shx.setInt32(100 + 8 * i, o / 2, false);
    shx.setInt32(104 + 8 * i, conteudo[i] / 2, false);
    shp.setInt32(o, i + 1, false);
    shp.setInt32(o + 4, conteudo[i] / 2, false);
    o += 8;
    if (!(c && c.length >= 2)) { shp.setInt32(o, 0, true); o += 4; return; }   // geometria nula
    shp.setInt32(o, 3, true);
    caixaDe(c).forEach((v, k) => shp.setFloat64(o + 4 + 8 * k, v, true));
    shp.setInt32(o + 36, 1, true);
    shp.setInt32(o + 40, c.length, true);
    shp.setInt32(o + 44, 0, true);
    c.forEach((p, k) => { shp.setFloat64(o + 48 + 16 * k, p[0], true); shp.setFloat64(o + 56 + 16 * k, p[1], true); });
    o += conteudo[i];
  });
  return [new Uint8Array(shp.buffer), new Uint8Array(shx.buffer)];
}

// ── .dbf (dBase III, texto em UTF-8, declarado no .cpg) ──
function nomesCampos(chaves) {
  const usados = new Set();
  return chaves.map((k) => {
    let base = k.normalize('NFD').replace(/[^\w]/g, '').slice(0, 10) || 'campo';
    let n = base, i = 1;
    while (usados.has(n.toLowerCase())) { const suf = String(i++); n = base.slice(0, 10 - suf.length) + suf; }
    usados.add(n.toLowerCase());
    return n;
  });
}

function gravarDbf(linhas) {
  const chaves = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const nomes = nomesCampos(chaves);
  const campos = chaves.map((k, i) => {
    const vals = linhas.map((l) => l[k]).filter((v) => v !== null && v !== undefined && v !== '');
    if (vals.length && vals.every((v) => typeof v === 'boolean')) return { k, nome: nomes[i], tipo: 'L', tam: 1, dec: 0 };
    if (vals.length && vals.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const inteiro = vals.every((v) => Number.isInteger(v));
      return { k, nome: nomes[i], tipo: 'N', tam: inteiro ? 12 : 19, dec: inteiro ? 0 : 6 };
    }
    const tam = Math.min(254, Math.max(1, ...vals.map((v) => utf8.encode(String(v)).length)));
    return { k, nome: nomes[i], tipo: 'C', tam, dec: 0 };
  });
  const tamCab = 32 + 32 * campos.length + 1;
  const tamReg = 1 + campos.reduce((a, c) => a + c.tam, 0);
  const buf = new Uint8Array(tamCab + tamReg * linhas.length + 1);
  const dv = new DataView(buf.buffer);
  const hoje = new Date();
  buf[0] = 0x03; buf[1] = hoje.getFullYear() - 1900; buf[2] = hoje.getMonth() + 1; buf[3] = hoje.getDate();
  dv.setUint32(4, linhas.length, true);
  dv.setUint16(8, tamCab, true);
  dv.setUint16(10, tamReg, true);
  campos.forEach((c, i) => {
    const p = 32 + 32 * i;
    buf.set(utf8.encode(c.nome), p);
    buf[p + 11] = c.tipo.charCodeAt(0);
    buf[p + 16] = c.tam;
    buf[p + 17] = c.dec;
  });
  buf[tamCab - 1] = 0x0d;
  buf.fill(0x20, tamCab, tamCab + tamReg * linhas.length);
  linhas.forEach((l, r) => {
    let p = tamCab + tamReg * r + 1;
    for (const c of campos) {
      const v = l[c.k];
      let txt = '';
      if (v !== null && v !== undefined && v !== '') {
        if (c.tipo === 'L') txt = v ? 'T' : 'F';
        else if (c.tipo === 'N') { txt = c.dec ? v.toFixed(c.dec) : String(v); if (txt.length > c.tam) txt = v.toPrecision(c.tam - 7); txt = txt.padStart(c.tam); }
        else txt = String(v);
      } else if (c.tipo === 'L') txt = '?';
      let bytes = utf8.encode(txt);
      if (bytes.length > c.tam) {   // corta sem quebrar um caractere UTF-8 no meio
        let n = c.tam;
        while (n > 0 && (bytes[n] & 0xc0) === 0x80) n--;
        bytes = bytes.slice(0, n);
      }
      buf.set(bytes, p);
      p += c.tam;
    }
  });
  buf[buf.length - 1] = 0x1a;
  return buf;
}

// ── .zip (método "store") ──
const TAB_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TAB_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipar(arquivos) {
  const partes = [], central = [];
  let o = 0;
  for (const [nome, dados] of arquivos) {
    const n = utf8.encode(nome), crc = crc32(dados);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, dados.length, true); loc.setUint32(22, dados.length, true); loc.setUint16(26, n.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, dados.length, true); cen.setUint32(24, dados.length, true); cen.setUint16(28, n.length, true);
    cen.setUint32(42, o, true);
    partes.push(new Uint8Array(loc.buffer), n, dados);
    central.push(new Uint8Array(cen.buffer), n);
    o += 30 + n.length + dados.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, o, true);
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/zip' });
}

/**
 * camadas = { nome: [{ coords: [[lon, lat], ...] | null, props: {...} }] } → baixa <arquivo>.zip
 * com um shapefile de polilinhas (WGS 84) por camada não vazia.
 */
export function baixarShapefile(arquivo, camadas) {
  const arqs = [];
  for (const [nome, feicoes] of Object.entries(camadas)) {
    if (!feicoes || !feicoes.length) continue;
    const [shp, shx] = gravarShp(feicoes.map((f) => f.coords));
    arqs.push([`${nome}.shp`, shp], [`${nome}.shx`, shx], [`${nome}.dbf`, gravarDbf(feicoes.map((f) => f.props))],
      [`${nome}.prj`, utf8.encode(PRJ_WGS84)], [`${nome}.cpg`, utf8.encode('UTF-8')]);
  }
  if (!arqs.length) throw new Error('Nenhum segmento para exportar.');
  const url = URL.createObjectURL(zipar(arqs));
  const a = Object.assign(document.createElement('a'), { href: url, download: arquivo.endsWith('.zip') ? arquivo : `${arquivo}.zip` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
