// Mapa da malha (Leaflet): SREs coloridos por classe ou alternados, e o SRE selecionado
// recortado nos intervalos de 200 m.
import { classificar, criarReferencia, km, num, esc, NOMES_PARAM, UNIDADES, fatorTxt } from './util.js';

const COR_SRE = ['#d7301f', '#f08c00'];
const COR_SEM_PAV = '#4a4a48';
const SEM_PAVIMENTO = new Set(['LEN', 'PLA', 'IMP', 'EOP', 'EOD']);
const COR_SEG = ['#d7301f', '#2a78d6'];

export class Mapa {
  constructor(elId, aoSelecionar) {
    this.aoSelecionar = aoSelecionar;
    this.modo = 'sre';
    this.render = L.canvas({ padding: 0.5, tolerance: 6 });
    this.map = L.map(elId, { preferCanvas: true, zoomSnap: 0.25 }).setView([-15.9, -49.6], 6.5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.camadaMalha = L.layerGroup().addTo(this.map);
    this.camadaDetalhe = L.layerGroup().addTo(this.map);
    this.linhas = new Map();
  }

  carregarMalha(sres, limites) {
    this.sres = sres;
    this.limites = limites;
    // cores alternadas ao longo de cada rodovia (Segmentação S.R.E)
    const ordem = [...sres].sort((a, b) => (a.rodovia || '').localeCompare(b.rodovia || '') || a.km_inicial - b.km_inicial);
    this.alternada = new Map(ordem.map((s, i) => [s.sre, i % 2]));
    sres.forEach((s) => {
      const ll = s.geom_mapa.map(([x, y]) => [y, x]);
      const linha = L.polyline(ll, { renderer: this.render, weight: 2.4, opacity: 0.95, interactive: true });
      linha.bindTooltip(`<strong>${esc(s.sre)}</strong><br>${km(s.km_inicial)} - ${km(s.km_final)} km`, { sticky: true, className: 'dica-sre', direction: 'top', offset: [0, -6] });
      linha.on('mouseover', () => linha.setStyle({ weight: 5 }));
      linha.on('mouseout', () => linha.setStyle({ weight: s.sre === this.selecionado ? 5 : 2.4 }));
      linha.on('click', () => this.aoSelecionar(s.sre));
      linha.addTo(this.camadaMalha);
      this.linhas.set(s.sre, linha);
    });
    this.contornoMalha = L.featureGroup([...this.linhas.values()]).getBounds();
    this.map.fitBounds(this.contornoMalha, { padding: [10, 10] });
    this.colorir();
  }

  corSre(s) {
    if (this.modo === 'sre') return SEM_PAVIMENTO.has(s.situacao) ? COR_SEM_PAV : COR_SRE[this.alternada.get(s.sre)];
    return classificar(this.limites, this.modo, s[`${this.modo}_medio`]).cor;
  }

  definirModo(modo) {
    this.modo = modo;
    this.colorir();
    if (this.pacote) this.desenharDetalhe(this.pacote, this.fatorDetalhe);
  }

  colorir() {
    this.sres.forEach((s) => this.linhas.get(s.sre).setStyle({ color: this.corSre(s), opacity: this.selecionado && s.sre !== this.selecionado ? 0.45 : 0.95 }));
  }

  legenda() {
    if (this.modo === 'sre') {
      return `<span><i class="linha" style="background:${COR_SRE[0]}"></i><i class="linha" style="background:${COR_SRE[1]}"></i>SREs (cores alternadas)</span>`
        + `<span><i class="linha" style="background:${COR_SEM_PAV}"></i>Leito natural, planejada ou em obras</span>`
        + (this.selecionado ? `<span><i class="linha" style="background:${COR_SEG[0]}"></i><i class="linha" style="background:${COR_SEG[1]}"></i>Segmentos homogêneos (combinada)</span>` : '');
    }
    const lst = this.limites.filter((l) => l.parametro === this.modo).sort((a, b) => a.ordem - b.ordem);
    const un = UNIDADES[this.modo] ? ` ${UNIDADES[this.modo]}` : '';
    let ant = null;
    const itens = lst.map((l) => {
      let faixa = '';
      if (l.classe !== 'Sem dado') {
        faixa = l.limite_sup === null ? ` (> ${num(ant, 1)}${un})` : ant === null ? ` (≤ ${num(l.limite_sup, 1)}${un})` : ` (${num(ant, 1)}–${num(l.limite_sup, 1)}${un})`;
        ant = l.limite_sup;
      }
      return `<span><i style="background:${l.cor}"></i>${l.classe}${faixa}</span>`;
    }).join('');
    return `<span><strong>${NOMES_PARAM[this.modo]}${this.selecionado ? ' — SRE selecionado a cada 200 m; malha pela média do SRE' : ' — média do SRE'}</strong></span>${itens}`;
  }

  selecionar(sre) {
    const ant = this.selecionado;
    this.selecionado = sre;
    if (ant && this.linhas.has(ant)) this.linhas.get(ant).setStyle({ weight: 2.4 });
    this.camadaDetalhe.clearLayers();
    this.pacote = null;
    this.colorir();
    const l = this.linhas.get(sre);
    if (l) {
      l.setStyle({ weight: 5 }).bringToFront();
      this.map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 13 });
    }
  }

  limparSelecao() {
    this.selecionado = null;
    this.pacote = null;
    this.camadaDetalhe.clearLayers();
    this.linhas.forEach((l) => l.setStyle({ weight: 2.4 }));
    this.colorir();
  }

  // SRE selecionado: intervalos de 200 m (modo de parâmetro) ou segmentos homogêneos (modo S.R.E)
  desenharDetalhe(pac, fator = 1) {
    this.pacote = pac;
    this.fatorDetalhe = fator;
    this.camadaDetalhe.clearLayers();
    const s = pac.sre;
    if (!s || !s.geom_detalhe || !pac.intervalos.length) return;
    const ref = criarReferencia(s.geom_detalhe, s.km_inicial, s.km_final);
    const segs = pac.segmentos.filter((g) => g.fator === fator && g.tipo === 'combinada');
    if (this.modo === 'sre') {
      segs.forEach((g, i) => {
        const p = L.polyline(ref.trecho(g.km_inicial, g.km_final), { renderer: this.render, color: COR_SEG[i % 2], weight: 7, opacity: 0.95 });
        p.bindTooltip(`<strong>${esc(s.sre)} · segmento ${g.seg_id}</strong><br>${km(g.km_inicial)} - ${km(g.km_final)} km (${num(g.comprimento_km, 2)} km)`
          + `<br>d0 ${num(g.d0_medio, 1)} · IGG ${num(g.igg_medio, 1)} · IRI ${num(g.iri_medio, 2)}`, { sticky: true, className: 'dica-sre' });
        p.on('click', () => this.aoSelecionar(s.sre));
        p.addTo(this.camadaDetalhe);
      });
    } else {
      const campo = this.modo === 'iri' ? 'iri' : this.modo;
      pac.intervalos.forEach((iv) => {
        const v = iv[`${campo}_obs`] ? iv[campo] : null;
        const cl = classificar(this.limites, this.modo, v);
        const p = L.polyline(ref.trecho(iv.km_inicial, iv.km_final), { renderer: this.render, color: cl.cor, weight: 7, opacity: 0.95 });
        p.bindTooltip(`<strong>${esc(s.sre)}</strong> · km ${km(iv.km_inicial)} - ${km(iv.km_final)}<br>${NOMES_PARAM[this.modo]}: ${v === null ? 'sem medição' : num(v, this.modo === 'iri' ? 2 : 1)} (${cl.classe})`,
          { sticky: true, className: 'dica-sre' });
        p.addTo(this.camadaDetalhe);
      });
    }
    // fronteiras dos segmentos homogêneos (combinada)
    segs.slice(1).forEach((g) => {
      L.circleMarker(ref.ponto(g.km_inicial), { renderer: this.render, radius: 5, color: '#1d1d1f', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
        .bindTooltip(`Quebra combinada · km ${km(g.km_inicial)} (${fatorTxt(fator)})`, { className: 'dica-sre' })
        .addTo(this.camadaDetalhe);
    });
  }

  invalidar() { this.map.invalidateSize(); }
}
