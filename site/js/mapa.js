// Mapa da malha (Leaflet) em três níveis de zoom:
//   longe   → SREs (cores alternadas ou classe da média do SRE)
//   médio   → segmentos homogêneos do modelo atual (combinada, estrutural ou funcional)
//   perto   → intervalos de 200 m do dataset, dentro dos segmentos homogêneos
// O SRE selecionado é desenhado por cima com a segmentação escolhida no detalhe (inclusive um passo
// da análise de sensibilidade).
import { classificar, criarReferencia, camadaBase, km, num, esc, NOMES_PARAM, UNIDADES, CORES_SITUACAO, NOMES_SITUACAO } from './util.js';

const COR_SEG = ['#E8820C', '#2F6FDB'];
export const ZOOM_SEGMENTOS = 10;
export const ZOOM_INTERVALOS = 13;
const MAX_SRES_INTERVALOS = 25;
const NOMES_NIVEL = { sre: 'SREs', seg: 'segmentos homogêneos', int: 'intervalos de 200 m' };
const NOMES_TIPO = { combinada: 'combinada', estrutural: 'estrutural', funcional: 'funcional' };

export class Mapa {
  /** fontes: { segmentos(tipo) → Promise<[...]>, intervalos(sres) → Promise<{intervalos, geom}> } */
  constructor(elId, aoSelecionar, fontes, aoMudar = () => {}) {
    this.aoSelecionar = aoSelecionar;
    this.fontes = fontes;
    this.aoMudar = aoMudar;
    this.modo = 'sre';          // cor: 'sre' (alternada) | 'iri' | 'igg' | 'd0'
    this.tipo = 'combinada';    // segmentação mostrada nos níveis médio e perto
    this.camada = 'auto';       // 'auto' (pelo zoom) | 'sre' | 'seg' | 'int'
    this.render = L.canvas({ padding: 0.5, tolerance: 6 });
    this.map = L.map(elId, { preferCanvas: true, zoomSnap: 0.25, scrollWheelZoom: false }).setView([-15.9, -49.6], 6.5);
    this.ligarZoomComCtrl(elId);
    camadaBase(this.map);
    this.camadaMalha = L.layerGroup().addTo(this.map);
    this.camadaSeg = L.layerGroup();
    this.camadaInt = L.layerGroup();
    this.camadaDetalhe = L.layerGroup().addTo(this.map);
    this.linhas = new Map();
    this.refs = new Map();       // referência linear por SRE (geometria simplificada)
    this.refsDet = new Map();    // idem com a geometria detalhada (intervalos)
    this.segRede = {};           // tipo → Map(sre → segmentos)
    this.intervalos = new Map(); // sre → intervalos de 200 m
    this.extra = null;           // camada de geometria enviada pelo usuário
    let t = null;
    this.map.on('zoomend moveend', () => { clearTimeout(t); t = setTimeout(() => this.atualizar(), 120); });
    this.aoMira = () => {};      // km sob o cursor no SRE selecionado (ou null) → gráficos
    this.marcaMira = null;
    this.map.on('mousemove', (e) => this.miraDoMapa(e));
    this.map.on('mouseout', () => { this.mira(null); this.aoMira(null); });
  }

  // cursor sobre o mapa: km do SRE selecionado mais próximo, se estiver a menos de ~24 px da linha
  miraDoMapa(e) {
    if (!this.selecionado || !this.pacote) return;
    const r = this.ref(this.selecionado, true).kmDe(e.latlng.lat, e.latlng.lng);
    const mPorPx = 40075016 * Math.cos(e.latlng.lat * Math.PI / 180) / 2 ** (this.map.getZoom() + 8);
    const k = r.distM / mPorPx <= 24 ? r.km : null;
    this.mira(k);
    this.aoMira(k);
  }

  /** marca o km k do SRE selecionado (null apaga) — mira sincronizada com o perfil longitudinal */
  mira(k) {
    if (k === null || k === undefined || !this.selecionado || !this.pacote) {
      if (this.marcaMira) { this.marcaMira.remove(); this.marcaMira = null; }
      return;
    }
    const p = this.ref(this.selecionado, true).ponto(k);
    if (!this.marcaMira) {
      this.marcaMira = L.circleMarker(p, { renderer: this.render, radius: 7, color: cssCor('--texto'), weight: 2, fillColor: cssCor('--destaque'), fillOpacity: 1, interactive: false })
        .bindTooltip('', { permanent: true, direction: 'top', offset: [0, -8], className: 'dica-sre' }).addTo(this.map);
    }
    this.marcaMira.setLatLng(p).setTooltipContent(`<strong>km ${km(k)}</strong>`);
  }

  // a roda do mouse só dá zoom com Ctrl pressionado; sem Ctrl a página rola e aparece um aviso
  ligarZoomComCtrl(elId) {
    const el = document.getElementById(elId);
    const aviso = document.getElementById('aviso-zoom');
    let t = null;
    el.addEventListener('wheel', (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        const z = this.map.getZoom() + (ev.deltaY < 0 ? 0.5 : -0.5);
        this.map.setZoomAround(this.map.mouseEventToContainerPoint(ev), Math.min(Math.max(z, this.map.getMinZoom()), this.map.getMaxZoom()));
        if (aviso) aviso.hidden = true;
      } else if (aviso) {
        aviso.hidden = false;
        clearTimeout(t);
        t = setTimeout(() => { aviso.hidden = true; }, 1400);
      }
    }, { passive: false });
  }

  carregarMalha(sres, limites) {
    this.sres = sres;
    this.porSre = new Map(sres.map((s) => [s.sre, s]));
    this.limites = limites;
    sres.forEach((s) => {
      const ll = s.geom_mapa.map(([x, y]) => [y, x]);
      const linha = L.polyline(ll, { renderer: this.render, weight: 2.4, opacity: 0.95, interactive: true });
      linha.bindTooltip(`<strong>${esc(s.sre)}</strong> · ${esc(s.rodovia || '')} · ${esc(s.situacao || '')}<br>km ${km(s.km_inicial)} – ${km(s.km_final)}`
        + (s.tem_dados ? `<br>${s.n_seg_combinada ?? '—'} seg. combinados · ${s.n_seg_estrutural ?? '—'} estruturais · ${s.n_seg_funcional ?? '—'} funcionais` : '<br>sem dados no dataset'),
      { sticky: true, className: 'dica-sre', direction: 'top', offset: [0, -6] });
      linha.on('click', () => this.aoSelecionar(s.sre));
      linha.addTo(this.camadaMalha);
      this.linhas.set(s.sre, linha);
      linha._limites = linha.getBounds();
    });
    this.contornoMalha = L.featureGroup([...this.linhas.values()]).getBounds();
    this.map.fitBounds(this.contornoMalha, { padding: [10, 10], animate: false });   // sem animação: um SRE do #sre= na URL precisa conseguir dar zoom logo depois
    this.atualizar();
  }

  ref(sre, detalhada = false) {
    const cache = detalhada ? this.refsDet : this.refs;
    if (!cache.has(sre)) {
      const s = this.porSre.get(sre);
      const g = detalhada ? this.geomDet?.[sre] || s.geom_mapa : s.geom_mapa;
      cache.set(sre, criarReferencia(g, s.km_inicial, s.km_final));
    }
    return cache.get(sre);
  }

  // ── nível atual ──
  nivel() {
    if (this.camada !== 'auto') return this.camada;
    const z = this.map.getZoom();
    return z >= ZOOM_INTERVALOS ? 'int' : z >= ZOOM_SEGMENTOS ? 'seg' : 'sre';
  }

  definirModo(modo) { this.modo = modo; this.redesenharTudo(); }
  definirTipo(tipo) { this.tipo = tipo; this.redesenharTudo(); }
  definirCamada(c) { this.camada = c; this.atualizar(); }

  redesenharTudo() {
    this.segDesenhado = null;
    this.intDesenhado = null;
    this.atualizar();
    if (this.pacote) this.desenharDetalhe(this.pacote, this.quebrasDetalhe, this.rotuloDetalhe, this.segsDetalhe);
  }

  visiveis() {
    const b = this.map.getBounds().pad(0.15);
    return this.sres.filter((s) => this.linhas.get(s.sre)._limites.intersects(b));
  }

  async atualizar() {
    if (!this.sres) return;
    const nivel = this.nivel();
    this.colorir(nivel);
    const mostrar = (camada, sim) => { if (sim && !this.map.hasLayer(camada)) camada.addTo(this.map); if (!sim && this.map.hasLayer(camada)) this.map.removeLayer(camada); };
    let aviso = '';
    try {
      if (nivel === 'seg' || nivel === 'int') await this.desenharSegmentos();
      mostrar(this.camadaSeg, nivel === 'seg' || nivel === 'int');
      if (nivel === 'int') aviso = await this.desenharIntervalos();
      mostrar(this.camadaInt, nivel === 'int');
    } catch (err) {
      aviso = `Camada indisponível: ${err.message}`;
    }
    // o SRE selecionado muda de forma entre os níveis (segmentos ↔ intervalos de 200 m)
    if (this.pacote && nivel !== this.nivelDetalhe) this.desenharDetalhe(this.pacote, this.quebrasDetalhe, this.rotuloDetalhe, this.segsDetalhe);
    this.camadaDetalhe.eachLayer((l) => l.bringToFront && l.bringToFront());
    this.aoMudar({ nivel, zoom: this.map.getZoom(), aviso, texto: this.textoNivel(nivel, aviso) });
  }

  textoNivel(nivel, aviso) {
    const z = num(this.map.getZoom(), 1);
    let t = `Zoom ${z} · ${NOMES_NIVEL[nivel]}`;
    if (nivel !== 'sre') t += ` (${NOMES_TIPO[this.tipo]})`;
    if (this.camada === 'auto') {
      if (nivel === 'sre') t += ` · aproxime até o zoom ${ZOOM_SEGMENTOS} para ver os segmentos homogêneos`;
      else if (nivel === 'seg') t += ` · aproxime até o zoom ${ZOOM_INTERVALOS} para ver os intervalos de 200 m`;
    }
    return aviso ? `${t} · ${aviso}` : t;
  }

  colorir(nivel = this.nivel()) {
    const fundo = nivel !== 'sre';
    this.sres.forEach((s) => {
      const sel = s.sre === this.selecionado;
      const linha = this.linhas.get(s.sre);
      if (fundo) linha.setStyle({ color: cssCor('--texto-mudo'), weight: sel ? 4 : 1.6, opacity: 0.55 });
      else linha.setStyle({ color: this.corSre(s), weight: sel ? 5 : 2.4, opacity: this.selecionado && !sel ? 0.45 : 0.95 });
    });
  }

  corSre(s) {
    if (this.modo === 'sre') return CORES_SITUACAO[s.situacao] || '#6b7280';
    return classificar(this.limites, this.modo, s[`${this.modo}_medio`]).cor;
  }

  corSegmento(g, i) {
    if (this.modo === 'sre') return COR_SEG[i % 2];
    const campo = this.modo === 'iri' ? 'iri_medio' : `${this.modo}_medio`;
    return classificar(this.limites, this.modo, g[campo]).cor;
  }

  async segmentosDe(tipo) {
    if (!this.segRede[tipo]) {
      const linhas = await this.fontes.segmentos(tipo);
      const m = new Map();
      linhas.forEach((g) => { if (!m.has(g.sre)) m.set(g.sre, []); m.get(g.sre).push(g); });
      this.segRede[tipo] = m;
    }
    return this.segRede[tipo];
  }

  async desenharSegmentos() {
    const chave = `${this.tipo}|${this.modo}`;
    if (this.segDesenhado === chave) return;
    const porSre = await this.segmentosDe(this.tipo);
    this.camadaSeg.clearLayers();
    for (const [sre, segs] of porSre) {
      if (!this.porSre.has(sre) || sre === this.selecionado) continue;
      const ref = this.ref(sre);
      segs.forEach((g, i) => {
        const p = L.polyline(ref.trecho(g.km_inicial, g.km_final), { renderer: this.render, color: this.corSegmento(g, i), weight: 5, opacity: 0.9 });
        p.bindTooltip(dicaSegmento(sre, g, this.tipo), { sticky: true, className: 'dica-sre' });
        p.on('click', () => this.aoSelecionar(sre));
        p.addTo(this.camadaSeg);
      });
      segs.slice(1).forEach((g) => L.circleMarker(ref.ponto(g.km_inicial), { renderer: this.render, radius: 3, color: '#1d1d1f', weight: 1.5, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(this.camadaSeg));
    }
    this.segDesenhado = chave;
  }

  async desenharIntervalos() {
    const vis = this.visiveis().filter((s) => s.tem_dados);
    if (vis.length > MAX_SRES_INTERVALOS) {
      this.camadaInt.clearLayers();
      this.intDesenhado = null;
      return `${vis.length} SREs na tela; aproxime mais para ver os intervalos de 200 m`;
    }
    const faltam = vis.map((s) => s.sre).filter((s) => !this.intervalos.has(s));
    if (faltam.length) {
      const r = await this.fontes.intervalos(faltam);
      this.geomDet = { ...(this.geomDet || {}), ...r.geom };
      faltam.forEach((s) => { this.intervalos.set(s, r.intervalos[s] || []); this.refsDet.delete(s); });
    }
    const chave = `${this.tipo}|${this.modo}|${vis.map((s) => s.sre).join(',')}`;
    if (this.intDesenhado === chave) return '';
    const porSre = await this.segmentosDe(this.tipo);
    this.camadaInt.clearLayers();
    for (const s of vis) {
      if (s.sre === this.selecionado) continue;
      this.desenharIntervalosSre(this.camadaInt, s.sre, this.intervalos.get(s.sre), (porSre.get(s.sre) || []).slice(1).map((g) => g.km_inicial));
    }
    this.intDesenhado = chave;
    return '';
  }

  // intervalos de 200 m de um SRE, coloridos pela classe do parâmetro (ou pelo segmento em modo S.R.E)
  desenharIntervalosSre(camada, sre, intervalos, quebrasKm) {
    if (!intervalos || !intervalos.length) return;
    const ref = this.ref(sre, true);
    const qs = [...quebrasKm].sort((a, b) => a - b);
    const segDe = (k) => { let i = 0; while (i < qs.length && k >= qs[i] - 1e-6) i++; return i; };
    intervalos.forEach((iv) => {
      const iSeg = segDe(iv.km_inicial);
      let cor, rot;
      if (this.modo === 'sre') { cor = COR_SEG[iSeg % 2]; rot = ''; }
      else {
        const v = iv[`${this.modo}_obs`] ? iv[this.modo] : null;
        const cl = classificar(this.limites, this.modo, v);
        cor = cl.cor; rot = `${NOMES_PARAM[this.modo]}: ${v === null ? 'sem medição' : num(v, this.modo === 'iri' ? 2 : 1)} (${cl.classe})<br>`;
      }
      const p = L.polyline(ref.trecho(iv.km_inicial, iv.km_final), { renderer: this.render, color: cor, weight: 8, opacity: 0.95 });
      p.bindTooltip(`<strong>${esc(sre)}</strong> · intervalo km ${km(iv.km_inicial)} – ${km(iv.km_final)}<br>${rot}`
        + `d0 ${num(iv.d0, 1)}${iv.d0_obs ? '' : ' (interpolado)'} · IGG ${num(iv.igg, 1)}${iv.igg_obs ? '' : ' (interp.)'} · IRI ${num(iv.iri, 2)}${iv.iri_obs ? '' : ' (interp.)'}`
        + `<br>segmento homogêneo ${iSeg + 1} (${NOMES_TIPO[this.tipo]})`, { sticky: true, className: 'dica-sre' });
      p.on('click', () => this.aoSelecionar(sre));
      p.addTo(camada);
    });
    // divisões de 200 m (pontos pequenos) e fronteiras dos segmentos homogêneos (pontos grandes)
    intervalos.slice(1).forEach((iv) => L.circleMarker(ref.ponto(iv.km_inicial), { renderer: this.render, radius: 2, color: '#ffffff', weight: 1, fillColor: '#ffffff', fillOpacity: 1, interactive: false }).addTo(camada));
    qs.forEach((k) => L.circleMarker(ref.ponto(k), { renderer: this.render, radius: 5.5, color: '#1d1d1f', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
      .bindTooltip(`Fronteira de segmento homogêneo · km ${km(k)}`, { className: 'dica-sre' }).addTo(camada));
  }

  legenda() {
    const nivel = this.nivel();
    const partes = [];
    if (this.modo === 'sre') {
      if (nivel === 'sre') {
        Object.entries(CORES_SITUACAO).forEach(([k, cor]) => partes.push(`<span><i class="linha" style="background:${cor}"></i>${k} · ${NOMES_SITUACAO[k]}</span>`));
      } else {
        partes.push(`<span><i class="linha" style="background:${COR_SEG[0]}"></i><i class="linha" style="background:${COR_SEG[1]}"></i>Segmentos homogêneos (${NOMES_TIPO[this.tipo]}, cores alternadas)</span>`);
      }
    } else {
      const lst = this.limites.filter((l) => l.parametro === this.modo).sort((a, b) => a.ordem - b.ordem);
      const un = UNIDADES[this.modo] ? ` ${UNIDADES[this.modo]}` : '';
      let ant = null;
      const base = { sre: 'média do SRE', seg: `média do segmento ${NOMES_TIPO[this.tipo]}`, int: 'valor medido no intervalo de 200 m' }[nivel];
      partes.push(`<span><strong>${NOMES_PARAM[this.modo]} — ${base}</strong></span>`);
      lst.forEach((l) => {
        let faixa = '';
        if (l.classe !== 'Sem dado') {
          faixa = l.limite_sup === null ? ` (> ${num(ant, 1)}${un})` : ant === null ? ` (≤ ${num(l.limite_sup, 1)}${un})` : ` (${num(ant, 1)}–${num(l.limite_sup, 1)}${un})`;
          ant = l.limite_sup;
        }
        partes.push(`<span><i style="background:${l.cor}"></i>${l.classe}${faixa}</span>`);
      });
    }
    if (nivel !== 'sre') partes.push('<span><i class="ponto"></i>fronteira de segmento</span>');
    if (nivel === 'int') partes.push('<span><i class="ponto pequeno"></i>divisão de 200 m</span>');
    if (this.selecionado) partes.push(`<span><i class="linha" style="background:${COR_SEG[0]};height:6px"></i>SRE selecionado: ${esc(this.rotuloDetalhe || '')}</span>`);
    return partes.join('');
  }

  selecionar(sre) {
    this.selecionado = sre;
    this.camadaDetalhe.clearLayers();
    this.pacote = null;
    this.segDesenhado = null;
    this.intDesenhado = null;
    const l = this.linhas.get(sre);
    if (l) this.map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 13 });
    this.atualizar();
  }

  limparSelecao() {
    this.selecionado = null;
    this.pacote = null;
    this.camadaDetalhe.clearLayers();
    this.segDesenhado = null;
    this.intDesenhado = null;
    this.atualizar();
  }

  /** SRE selecionado com uma segmentação qualquer: quebrasKm = km das fronteiras; segs = atributos opcionais */
  desenharDetalhe(pac, quebrasKm, rotulo, segs = null) {
    this.pacote = pac;
    this.quebrasDetalhe = quebrasKm;
    this.rotuloDetalhe = rotulo;
    this.segsDetalhe = segs;
    this.camadaDetalhe.clearLayers();
    const s = pac.sre;
    const nivel = this.nivel();
    this.nivelDetalhe = nivel;
    if (!s || !s.geom_detalhe || !pac.intervalos.length) return;
    if (!this.geomDet?.[s.sre]) {
      this.geomDet = { ...(this.geomDet || {}), [s.sre]: s.geom_detalhe };
      this.refsDet.delete(s.sre);
    }
    this.intervalos.set(s.sre, pac.intervalos);
    const ref = this.ref(s.sre, true);
    if (nivel === 'int' || this.modo !== 'sre') {
      this.desenharIntervalosSre(this.camadaDetalhe, s.sre, pac.intervalos, quebrasKm);
    } else {
      const lim = [s.km_inicial, ...quebrasKm, s.km_final];
      for (let i = 0; i < lim.length - 1; i++) {
        const g = segs?.[i];
        const p = L.polyline(ref.trecho(lim[i], lim[i + 1]), { renderer: this.render, color: COR_SEG[i % 2], weight: 8, opacity: 0.95 });
        p.bindTooltip(`<strong>${esc(s.sre)} · segmento ${i + 1}</strong><br>km ${km(lim[i])} – ${km(lim[i + 1])} (${num(lim[i + 1] - lim[i], 2)} km)`
          + (g ? `<br>d0 ${num(g.d0_medio, 1)} · IGG ${num(g.igg_medio, 1)} · IRI ${num(g.iri_medio, 2)}` : '') + `<br>${esc(rotulo)}`, { sticky: true, className: 'dica-sre' });
        p.addTo(this.camadaDetalhe);
      }
      quebrasKm.forEach((k) => L.circleMarker(ref.ponto(k), { renderer: this.render, radius: 5.5, color: '#1d1d1f', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
        .bindTooltip(`Fronteira · km ${km(k)} (${esc(rotulo)})`, { className: 'dica-sre' }).addTo(this.camadaDetalhe));
    }
  }

  // geometria enviada pelo usuário (GeoJSON) sobre a malha
  mostrarExtra(geojson, rotulo) {
    if (this.extra) this.map.removeLayer(this.extra);
    this.extra = L.geoJSON(geojson, { style: { color: '#7b2cbf', weight: 4, opacity: 0.9 } })
      .bindTooltip(rotulo, { sticky: true, className: 'dica-sre' }).addTo(this.map);
    this.map.fitBounds(this.extra.getBounds(), { padding: [30, 30] });
  }

  invalidar() { this.map.invalidateSize(); }
}

function dicaSegmento(sre, g, tipo) {
  return `<strong>${esc(sre)} · segmento ${g.seg_id}</strong> (${NOMES_TIPO[tipo]})<br>km ${km(g.km_inicial)} – ${km(g.km_final)} (${num(g.km_final - g.km_inicial, 2)} km)`
    + `<br>d0 ${num(g.d0_medio, 1)} · IGG ${num(g.igg_medio, 1)} · IRI ${num(g.iri_medio, 2)}`;
}

function cssCor(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#898781';
}
