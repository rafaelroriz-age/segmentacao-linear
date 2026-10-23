// Análise de sensibilidade de um SRE: grade crescente de penalidades, um gráfico de segmentação por
// penalidade, explicação de cada passo e resumo. O cálculo é feito no navegador (modelo.js), com o
// mesmo algoritmo do notebook; serve tanto para SREs da malha quanto para datasets enviados.
import * as M from './modelo.js';
import * as GP from './graficos_passos.js';
import * as GS from './graficos_seg.js';
import { num, esc, baixarCsv, TIPOS } from './util.js';
import { baixarExcel, baixarPng } from './exportar.js';

const AJUDA = {
  alvo: 'Qual penalidade varia. Estrutural: a penalidade do PELT sobre o parâmetro estrutural escolhido (quanto maior, menos quebras). Funcional: o quociente α_km do PELT l2 sobre o parâmetro funcional (penalidade = α_km × extensão). A outra fica no valor de referência.',
  grade: 'Caminho exato: um passo para cada solução distinta do caminho CROPS, então de um passo para o seguinte a segmentação estrutural sempre muda — nenhum gráfico é repetido. Linear ou logarítmica: n penalidades igualmente espaçadas entre o mínimo e o máximo.',
  maxPassos: 'Limite de passos no caminho exato. SREs longos podem ter dezenas de soluções; acima do limite, os passos são amostrados de forma uniforme, sempre incluindo a referência.',
};

export class Sensibilidade {
  constructor(raiz, { aoMudarPasso = () => {} } = {}) {
    this.raiz = raiz;
    this.aoMudarPasso = aoMudarPasso;
    this.alvo = 'estrutural';
    this.modo = 'caminho';
    this.iSel = 0;
    this.montarHtml();
  }

  $(sel) { return this.raiz.querySelector(sel); }

  montarHtml() {
    this.raiz.innerHTML = `
      <p class="nota" data-r="nota"></p>
      <div class="painel-controles">
        <div class="controle"><span class="rot-controle">Penalidade que varia <button class="ajuda" type="button" title="${esc(AJUDA.alvo)}">?</button></span>
          <div class="chips" data-r="alvo"><button class="chip" data-v="funcional">Funcional</button><button class="chip ativo" data-v="estrutural">Estrutural</button></div></div>
        <label class="controle"><span class="rot-controle">Grade <button class="ajuda" type="button" title="${esc(AJUDA.grade)}">?</button></span>
          <select data-r="modo"><option value="caminho">Caminho exato (cada passo muda)</option><option value="linear">Linear</option><option value="log">Logarítmica</option></select></label>
        <label class="controle" data-r="caixa-min"><span class="rot-controle">Mínimo</span><input type="number" step="any" data-r="min"></label>
        <label class="controle" data-r="caixa-max"><span class="rot-controle">Máximo</span><input type="number" step="any" data-r="max"></label>
        <label class="controle" data-r="caixa-n"><span class="rot-controle">Nº de passos</span><input type="number" min="2" max="60" step="1" data-r="n"></label>
        <label class="controle" data-r="caixa-maxp"><span class="rot-controle">Máx. passos <button class="ajuda" type="button" title="${esc(AJUDA.maxPassos)}">?</button></span><input type="number" min="3" max="80" step="1" data-r="maxp"></label>
        <div class="controle"><span class="rot-controle">&nbsp;</span><div class="linha-botoes"><button class="btn" type="button" data-r="recalc">Recalcular</button><button class="btn btn-sec" type="button" data-r="padrao">Padrão</button></div></div>
      </div>
      <div class="player">
        <button class="btn btn-sec btn-icone" type="button" data-r="ant" aria-label="Passo anterior">◀</button>
        <div class="livre"><input type="range" min="0" max="1000" step="1" value="0" data-r="slider" aria-label="Penalidade (arraste para mudar o gráfico)"><div class="rot-slider"><span data-r="rot-min"></span><span>arraste: o gráfico muda em tempo real</span><span data-r="rot-max"></span></div></div>
        <button class="btn btn-sec btn-icone" type="button" data-r="prox" aria-label="Próximo passo">▶</button>
        <button class="btn btn-sec" type="button" data-r="play">Reproduzir</button>
        <span class="rot-passo" data-r="rot-passo"></span>
      </div>
      <div class="kpis kpis-compactos" data-r="kpis"></div>
      <div data-r="insights"></div>
      <div class="etapa-seg"><h3><span class="num-etapa">1</span> Segmentação funcional <span class="sub" data-r="tit-func"></span></h3><div class="graf" data-r="graf-func"></div></div>
      <div class="etapa-seg"><h3><span class="num-etapa">2</span> Segmentação estrutural <span class="sub" data-r="tit-estrut"></span></h3><div class="graf" data-r="graf-estrut"></div></div>
      <div class="etapa-seg"><h3><span class="num-etapa">3</span> Funcional + estrutural no mesmo gráfico</h3><p class="sub">Eixo esquerdo: parâmetro funcional; direito: estrutural. As linhas cheias são as fronteiras do resultado (as mesmas do gráfico 4): roxa = veio da funcional, azul = da estrutural, escura = as duas coincidem (a até 0,4 km). Traço cinza claro = fronteira descartada por deixar um segmento menor que 1 km. As faixas de fundo são os segmentos do resultado.</p><div class="graf" data-r="graf-unido"></div></div>
          <div class="etapa-seg"><h3><span class="num-etapa">4</span> Resultado: segmentos e classe de condição</h3><p class="sub">Cada barra é um segmento. Na linha do resultado, a cor é a pior classe entre a funcional e a estrutural (classe limitante). Passe o mouse para ver os valores.</p><div class="graf" data-r="graf-regua"></div></div>
      <div class="barra-download"><span class="rot-controle">Baixar</span><button class="btn btn-sec" type="button" data-r="png-passo">Gráficos deste passo (3 PNG)</button><button class="btn btn-sec" type="button" data-r="png-nseg">Segmentos × penalidade (PNG)</button><button class="btn btn-sec" type="button" data-r="png-faixas">Posição das quebras (PNG)</button><button class="btn btn-sec" type="button" data-r="png-todos">Todos os passos (um PNG por penalidade)</button></div>
      <div class="explicacao" data-r="explicacao"></div>
      <div class="cab-cartao"><div><h3>Um gráfico por penalidade</h3><p class="sub" data-r="sub-minis"></p></div></div>
      <div class="grade-mini" data-r="minis"></div>
      <div class="duas-colunas">
        <div><h3>Segmentos × penalidade</h3><p class="sub">Clique num ponto para abrir o passo. Pontilhado laranja: modelo atual.</p><div class="graf graf-medio" data-r="graf-nseg"></div></div>
        <div><h3>Onde ficam as quebras</h3><p class="sub">Uma linha por penalidade (crescente para cima).</p><div class="graf" data-r="graf-faixas"></div></div>
      </div>
      <details class="detalhes" data-r="det-fusoes"><summary>Detalhes técnicos deste passo (fusões, BIC, resíduos)</summary><div data-r="fusoes"></div><div class="graf graf-baixo" data-r="graf-bic"></div></details>
      <details class="detalhes"><summary>Tabela de todos os passos</summary>
        <div class="barra-download"><span class="rot-controle">Baixar</span><button class="btn btn-sec" type="button" data-r="csv">Tabela (CSV)</button><button class="btn btn-sec" type="button" data-r="xlsx">Passos (Excel)</button></div>
        <div class="tabela-rolagem" data-r="tabela"></div></details>`;
    this.$('[data-r="alvo"]').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      this.alvo = b.dataset.v;
      this.raiz.querySelectorAll('[data-r="alvo"] .chip').forEach((x) => x.classList.toggle('ativo', x === b));
      if (this.alvo === 'funcional' && this.modo === 'caminho') this.modo = 'linear';
      this.preencherPadrao();
      this.calcular();
    });
    this.$('[data-r="modo"]').addEventListener('change', (e) => { this.modo = e.target.value; this.preencherPadrao(false); this.calcular(); });
    this.$('[data-r="recalc"]').addEventListener('click', () => this.calcular());
    this.$('[data-r="padrao"]').addEventListener('click', () => { this.modo = this.alvo === 'estrutural' ? 'caminho' : 'linear'; this.preencherPadrao(); this.calcular(); });
    this.$('[data-r="slider"]').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      cancelAnimationFrame(this.quadro);
      this.quadro = requestAnimationFrame(() => this.livre(this.penDe(v)));
    });
    this.$('[data-r="xlsx"]').addEventListener('click', () => baixarExcel(`${this.ctx.sre || 'sre'}_sensibilidade_${this.alvo}`, { PASSOS: this.linhasTabela() }));
    const nome = (x) => `${this.ctx.sre || 'sre'}_${x}`;
    this.$('[data-r="png-passo"]').addEventListener('click', async () => {
      const pen = this.passos[this.iSel].penalidade.toFixed(2);
      for (const [k, r] of [['funcional', 'graf-func'], ['estrutural', 'graf-estrut'], ['unido', 'graf-unido'], ['resultado', 'graf-regua']]) {
        await baixarPng(this.$(`[data-r="${r}"]`), nome(`pen_${pen}_${k}`), { largura: 1600, altura: k === 'resultado' ? 380 : 620 });
        await new Promise((ok) => setTimeout(ok, 400));
      }
    });
    this.$('[data-r="png-nseg"]').addEventListener('click', () => baixarPng(this.$('[data-r="graf-nseg"]'), nome('segmentos_x_penalidade'), { largura: 1200 }));
    this.$('[data-r="png-faixas"]').addEventListener('click', () => baixarPng(this.$('[data-r="graf-faixas"]'), nome('posicao_das_quebras')));
    this.$('[data-r="png-todos"]').addEventListener('click', () => this.baixarTodos());
    this.$('[data-r="ant"]').addEventListener('click', () => this.selecionar(Math.max(0, this.iSel - 1)));
    this.$('[data-r="prox"]').addEventListener('click', () => this.selecionar(Math.min(this.passos.length - 1, this.iSel + 1)));
    this.$('[data-r="play"]').addEventListener('click', () => this.alternarPlay());
    this.$('[data-r="csv"]').addEventListener('click', () => this.baixar());
    this.raiz.querySelectorAll('.ajuda').forEach((b) => b.addEventListener('click', () => alert(b.title)));
  }

  /** ctx: { a, cam, alphaRef, betaRef, betaMin, sre, p, cfg, limites (classe_limite) } */
  definir(ctx) {
    this.ctx = { p: M.PADRAO, cfg: M.CFG_PADRAO, limites: [], ...ctx };
    const { cfg } = this.ctx;
    this.$('[data-r="alvo"] [data-v="funcional"]').textContent = `Funcional (${M.SINAIS_FUNC[cfg.func]})`;
    this.$('[data-r="alvo"] [data-v="estrutural"]').textContent = `Estrutural (${M.SINAIS_ESTRUT[cfg.estrut]})`;
    this.parar();
    const temD0 = !!this.ctx.cam;
    this.$('[data-r="alvo"] [data-v="estrutural"]').disabled = !temD0;
    if (!temD0) this.alvo = 'funcional';
    this.raiz.querySelectorAll('[data-r="alvo"] .chip').forEach((x) => x.classList.toggle('ativo', x.dataset.v === this.alvo));
    this.modo = this.alvo === 'estrutural' ? 'caminho' : 'linear';
    this.preencherPadrao();
    this.calcular();
  }

  preencherPadrao(tudo = true) {
    const { cam, betaRef, betaMin, alphaRef } = this.ctx;
    const sel = this.$('[data-r="modo"]');
    sel.querySelector('[value="caminho"]').disabled = this.alvo !== 'estrutural' || !cam || cam.Ks.length < 2;
    if (sel.querySelector(`[value="${this.modo}"]`).disabled) this.modo = 'linear';
    sel.value = this.modo;
    const caminho = this.modo === 'caminho';
    ['caixa-min', 'caixa-max', 'caixa-n'].forEach((k) => { this.$(`[data-r="${k}"]`).hidden = caminho; });
    this.$('[data-r="caixa-maxp"]').hidden = !caminho;
    if (!tudo && this.$('[data-r="min"]').value) return;
    if (this.alvo === 'estrutural') {
      const zero = cam && cam.Ks.length > 1 ? cam.sup[1] : betaRef * 3;
      this.$('[data-r="min"]').value = +(Math.max(betaMin || betaRef / 4, 0.01)).toFixed(3);
      this.$('[data-r="max"]').value = +(Math.max(zero * 1.1, betaRef * 1.5)).toFixed(3);
    } else {
      this.$('[data-r="min"]').value = +(alphaRef * 0.25).toFixed(4);
      this.$('[data-r="max"]').value = +(alphaRef * 3).toFixed(4);
    }
    this.$('[data-r="n"]').value = 12;
    if (!this.$('[data-r="maxp"]').value) this.$('[data-r="maxp"]').value = 30;
  }

  calcular() {
    const { a, cam, alphaRef, betaRef, p } = this.ctx;
    const pRef = this.alvo === 'estrutural' ? betaRef : alphaRef;
    const lerNum = (k) => Number(this.$(`[data-r="${k}"]`).value);
    let min = lerNum('min'), max = lerNum('max');
    if (!(min > 0) || !(max > min)) { min = pRef / 4; max = pRef * 3; }
    const pens = M.gradePenalidades(this.alvo === 'estrutural' ? cam : null, pRef, {
      modo: this.modo, min, max, n: lerNum('n') || 12, maxPassos: lerNum('maxp') || 30,
    });
    this.passos = M.passosSensibilidade(a, { alvo: this.alvo, pens, alphaRef, betaRef, cam, p, cfg: this.ctx.cfg });
    this.iRef = this.passos.reduce((j, s, i, arr) => (Math.abs(Math.log(s.penalidade / pRef)) < Math.abs(Math.log(arr[j].penalidade / pRef)) ? i : j), 0);
    const ref = this.passos[this.iRef];
    const tol = p.BUFFER_KM;
    this.passos.forEach((s) => {
      s.f1 = Object.fromEntries(TIPOS.map((t) => [t, M.f1Quebras(ref[chaveKm(t)], s[chaveKm(t)], tol).f1]));
    });
    this.notaFaixa();
    const { lo, hi } = this.limites();
    const fm = (v) => (this.alvo === 'estrutural' ? num(v, 2) : num(v, 4));
    this.$('[data-r="rot-min"]').textContent = fm(lo);
    this.$('[data-r="rot-max"]').textContent = fm(hi);
    this.selecionar(this.iRef, true);
    this.resumo();
    this.minis();
    this.tabela();
  }

  notaFaixa() {
    const { cam, betaRef, alphaRef } = this.ctx;
    const nota = this.$('[data-r="nota"]');
    const n = this.passos.length;
    if (this.alvo === 'estrutural' && cam && cam.Ks.length > 1) {
      const K = M.kOtimo(cam, betaRef);
      const j = cam.Ks.indexOf(K);
      const sup = Number.isFinite(cam.sup[j]) ? `${num(cam.sup[j], 2)} (${num(cam.sup[j] / betaRef, 2)}x)` : 'sem limite superior';
      nota.innerHTML = `<strong>${n} passos</strong> de penalidade estrutural, de ${num(this.passos[0].penalidade, 2)} a ${num(this.passos[n - 1].penalidade, 2)}. `
        + `A segmentação estrutural da referência (penalidade ${num(betaRef, 2)}, <strong>${K} quebras</strong>) continua ótima para penalidades entre `
        + `<strong>${num(cam.inf[j], 2)} (${num(cam.inf[j] / betaRef, 2)}x)</strong> e <strong>${sup}</strong>. `
        + `O caminho CROPS deste SRE tem ${cam.Ks.length} soluções; a penalidade que zera as quebras é ${num(cam.sup[1], 2)}.`;
    } else if (this.alvo === 'estrutural') {
      nota.textContent = `Este SRE não tem ${M.SINAIS_ESTRUT[this.ctx.cfg.estrut]} suficiente para a segmentação estrutural; só a penalidade funcional pode variar.`;
    } else {
      nota.innerHTML = `<strong>${n} passos</strong> do quociente de penalidade funcional α_km, de ${num(this.passos[0].penalidade, 4)} a ${num(this.passos[n - 1].penalidade, 4)} `
        + `(referência ${num(alphaRef, 4)}). Em cada passo a penalidade do PELT l2 é α_km × extensão, ajustada pelo BIC numa faixa de ±${Math.round(this.ctx.p.MARGEM_PEN * 100)}%; a penalidade estrutural fica em ${num(betaRef, 2)}.`;
    }
  }

  // posição do slider (0–1000) ↔ penalidade, em escala logarítmica quando a grade cobre muitas ordens
  limites() {
    const v = this.passos.map((p) => p.penalidade);
    const lo = Math.min(...v), hi = Math.max(...v);
    return { lo, hi, log: lo > 0 && hi / lo > 20 };
  }

  posDe(pen) {
    const { lo, hi, log } = this.limites();
    if (hi === lo) return 0;
    return Math.round(1000 * (log ? Math.log(pen / lo) / Math.log(hi / lo) : (pen - lo) / (hi - lo)));
  }

  penDe(pos) {
    const { lo, hi, log } = this.limites();
    return log ? lo * (hi / lo) ** (pos / 1000) : lo + ((hi - lo) * pos) / 1000;
  }

  /** penalidade qualquer (slider): refaz a segmentação na hora; o passo "anterior" é o da grade logo abaixo */
  livre(pen) {
    if (!this.passos || !this.passos.length) return;
    const { a, cam, alphaRef, betaRef, p } = this.ctx;
    const s = M.segmentarSre(a, { alphaFunc: this.alvo === 'funcional' ? pen : alphaRef, beta: this.alvo === 'estrutural' ? pen : betaRef, cam, p, cfg: this.ctx.cfg });
    const ref = this.passos[this.iRef];
    s.penalidade = pen;
    s.fator = pen / (this.alvo === 'estrutural' ? betaRef : alphaRef);
    s.f1 = Object.fromEntries(TIPOS.map((t) => [t, M.f1Quebras(ref[chaveKm(t)], s[chaveKm(t)], p.BUFFER_KM).f1]));
    let iAnt = -1;
    this.passos.forEach((x, i) => { if (x.penalidade < pen - 1e-9) iAnt = i; });
    const ant = iAnt >= 0 ? this.passos[iAnt] : null;
    let iPerto = 0;
    this.passos.forEach((x, i) => { if (Math.abs(Math.log(x.penalidade / pen)) < Math.abs(Math.log(this.passos[iPerto].penalidade / pen))) iPerto = i; });
    this.iSel = iPerto;
    this.mostrar(s, ant, { livre: true, i: iPerto });
  }

  selecionar(i, silencioso = false) {
    if (!this.passos || !this.passos.length) return;
    this.iSel = i;
    this.$('[data-r="slider"]').value = this.posDe(this.passos[i].penalidade);
    this.mostrar(this.passos[i], i > 0 ? this.passos[i - 1] : null, { livre: false, i }, silencioso);
  }

  mostrar(s, ant, { livre, i }, silencioso = false) {
    const { a, cam, sre, cfg, limites } = this.ctx;
    const pTxt = this.alvo === 'estrutural' ? num(s.penalidade, 3) : `α_km ${num(s.penalidade, 4)}`;
    this.$('[data-r="rot-passo"]').innerHTML = livre
      ? `Penalidade <strong>${pTxt}</strong> · ${num(s.fator, 2)}x da referência · passo mais próximo da grade: ${i + 1} de ${this.passos.length}`
      : `Passo <strong>${i + 1}</strong> de ${this.passos.length} · penalidade ${pTxt} · ${num(s.fator, 2)}x da referência${i === this.iRef ? ' · <strong>referência</strong>' : ''}`;
    const K = s.estrut_s.length, j = cam ? cam.Ks.indexOf(K) : -1;
    const igual = !livre && i === this.iRef ? 'é o modelo atual' : s.f1.combinada >= 0.999 ? 'mesmas fronteiras do modelo atual' : `${Math.round(100 * s.f1.combinada)}% das fronteiras coincidem com o modelo atual`;
    this.$('[data-r="kpis"]').innerHTML = [
      kpi('Penalidade', pTxt, `${num(s.fator, 2)}x a do modelo atual`),
      kpi('Funcional + estrutural', s.comb_s.length + 1, igual),
      kpi(`Segmentos funcionais (${M.SINAIS_FUNC[cfg.func]})`, s.func_s.length + 1, ''),
      kpi(`Segmentos estruturais (${M.SINAIS_ESTRUT[cfg.estrut]})`, cam ? K + 1 : '—', j >= 0 ? `mesma solução de ${num(cam.inf[j], 1)} a ${Number.isFinite(cam.sup[j]) ? num(cam.sup[j], 1) : '∞'}` : ''),
    ].join('');
    this.desenharEtapas(s);
    const linhas = M.explicarPasso(a, s, ant, cam, this.alvo, this.ctx.p);
    this.$('[data-r="explicacao"]').innerHTML = `<h3>O que aconteceu neste passo</h3><ul>${linhas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
    this.detalhesFusoes(s);
    this.raiz.querySelectorAll('.mini').forEach((m) => m.classList.toggle('sel', Number(m.dataset.i) === i));
    if (!silencioso && !livre) this.resumo();
    this.aoMudarPasso(s, i, this.rotulo(s));
  }

  // os três gráficos (funcional, estrutural, resultado) e os insights do passo
  desenharEtapas(s) {
    const { a, cfg, limites, sre } = this.ctx;
    const robE = GS.robustez(s.estrut_km, this.passos.map((x) => x.estrut_km), this.ctx.p.BUFFER_KM);
    const robF = GS.robustez(s.func_km, this.passos.map((x) => x.func_km), this.ctx.p.BUFFER_KM);
    this.$('[data-r="tit-func"]').textContent = `· ${M.SINAIS_FUNC[cfg.func]} · PELT l2 · ${s.func_s.length + 1} segmentos`;
    this.$('[data-r="tit-estrut"]').textContent = `· ${M.SINAIS_ESTRUT[cfg.estrut]} · PELT ${cfg.modelo} · ${s.estrut_s.length + 1} segmentos`;
    GS.grafSinal(this.$('[data-r="graf-func"]'), a, cfg.func, s.func_s, { cor: '#7c3aed', rob: this.alvo === 'funcional' ? robF : null, altura: 260 });
    const serieE = cfg.estrut === 'aca' ? M.sinalEstrutural(a, { ...cfg, modelo: 'normal' }) : a[cfg.estrut];
    GS.grafSinal(this.$('[data-r="graf-estrut"]'), a, cfg.estrut, s.estrut_s, { serie: serieE, modo: cfg.modelo === 'linear' ? 'reta' : 'media', rob: robE, altura: 280, outras: s.func_s });
    GS.grafUnido(this.$('[data-r="graf-unido"]'), a, s);
    GS.grafRegua(this.$('[data-r="graf-regua"]'), a, s, limites);
    this.$('[data-r="insights"]').innerHTML = GS.insights(a, s, limites, { robE, robF, sre });
  }

  rotulo(s) {
    return this.alvo === 'estrutural' ? `funcional + estrutural, penalidade ${num(s.penalidade, 2)}` : `funcional + estrutural, α_km ${num(s.penalidade, 4)}`;
  }

  detalhesFusoes(s) {
    const { a } = this.ctx;
    const { cfg } = this.ctx;
    const f = M.SINAIS_FUNC[cfg.func], e = cfg.estrut === 'raio' ? 'raio' : 'd0';
    const nomes = { funcional: `Funcional (Welch no ${f})`, estrutural: `Estrutural (Welch + Brown-Forsythe no ${e})`, combinada: `Funcional + estrutural (${e}: média e variância; ${f}: média)` };
    const blocos = TIPOS.map((t) => {
      const f = s.fusoes[t];
      if (!f.length) return `<p><strong>${nomes[t]}:</strong> nenhuma fusão${t === 'estrutural' && !this.ctx.p.FUNDIR_ESTRUT ? ' (desligada no modelo, como em Biswas & Kuna)' : ''}.</p>`;
      return `<p><strong>${nomes[t]}:</strong> ${f.length} quebra(s) removida(s) por não haver diferença significativa entre os vizinhos (p > ${num(this.ctx.p.ALPHA_TESTE, 2)}): `
        + f.map((x) => `km ${num(a.ini[x.quebra], 1)} (p = ${num(x.p, 3)})`).join(', ') + '.</p>';
    });
    if (s.aud.shapiro_p !== undefined && s.aud.shapiro_p !== null) blocos.push(`<p><strong>Resíduos estruturais:</strong> Shapiro p = ${num(s.aud.shapiro_p, 3)} · Ljung-Box p = ${num(s.aud.ljung_box_p, 3)} (p &gt; ${num(this.ctx.p.ALPHA_TESTE, 2)} = premissa atendida).</p>`);
    blocos.push(`<p>PELT bruto antes das fusões: funcional ${s.bruto.funcional}, estrutural ${s.bruto.estrutural}, combinada ${s.bruto.combinada} quebras.</p>`);
    if (s.cand_func.length) blocos.push(`<p><strong>Penalidade funcional:</strong> ${s.cand_func.length} candidatas na faixa; venceu ${num(s.pen_func, 3)} (menor BIC).</p>`);
    this.$('[data-r="fusoes"]').innerHTML = blocos.join('');
    if (s.cand_func.length) GP.grafBicFuncional(this.$('[data-r="graf-bic"]'), s.cand_func, s.pen_func);
  }

  resumo() {
    const { a } = this.ctx;
    GP.grafSegmentosPen(this.$('[data-r="graf-nseg"]'), this.passos, this.alvo, this.iRef, this.iSel, (i) => this.selecionar(i));
    GP.grafFaixasPassos(this.$('[data-r="graf-faixas"]'), a, this.passos, this.alvo, this.iRef, this.iSel, (i) => this.selecionar(i));
  }

  minis() {
    const { a } = this.ctx;
    const caixa = this.$('[data-r="minis"]');
    const { cfg } = this.ctx;
    const est = this.alvo === 'estrutural';
    const chaveS = est ? cfg.estrut : cfg.func;
    const serieM = est && cfg.estrut === 'aca' ? M.sinalEstrutural(a, { ...cfg, modelo: 'normal' }) : a[chaveS];
    this.$('[data-r="sub-minis"]').textContent = `${est ? M.SINAIS_ESTRUT[cfg.estrut] : M.SINAIS_FUNC[cfg.func]} com a média de cada segmento ${est ? 'estrutural' : 'funcional'}. Clique para abrir.`;
    this.obs?.disconnect();
    caixa.innerHTML = this.passos.map((s, i) => `<button type="button" class="mini ${i === this.iRef ? 'ref' : ''} ${i === this.iSel ? 'sel' : ''}" data-i="${i}">
      <span class="mini-tit">${i + 1}. penalidade ${this.alvo === 'estrutural' ? num(s.penalidade, 2) : num(s.penalidade, 4)}${i === this.iRef ? ' · ref.' : ''}</span>
      <span class="mini-sub">${s.estrut_s.length + 1} estrut. · ${s.func_s.length + 1} func. · ${s.comb_s.length + 1} comb.</span>
      <span class="mini-graf"></span></button>`).join('');
    caixa.querySelectorAll('.mini').forEach((b) => b.addEventListener('click', () => { this.selecionar(Number(b.dataset.i)); this.$('[data-r="insights"]').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    // desenha só quando o mini-gráfico aparece na tela
    this.obs = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (!e.isIntersecting) return;
      const i = Number(e.target.dataset.i);
      const ps = this.passos[i];
      GS.grafSinal(e.target.querySelector('.mini-graf'), a, chaveS, est ? ps.estrut_s : ps.func_s,
        { serie: serieM, modo: est && cfg.modelo === 'linear' ? 'reta' : 'media', altura: 170, cor: est ? null : '#7c3aed' });
      this.obs.unobserve(e.target);
    }), { rootMargin: '200px' });
    caixa.querySelectorAll('.mini').forEach((m) => this.obs.observe(m));
  }

  linhasTabela() {
    const { a, cam, sre } = this.ctx;
    const chave = this.alvo === 'estrutural' ? 'estrut_s' : 'func_s';
    return this.passos.map((s, i) => {
      const ant = i > 0 ? this.passos[i - 1] : null;
      const K = s.estrut_s.length, j = cam ? cam.Ks.indexOf(K) : -1;
      const kmL = (v) => v.map((b) => num(a.ini[b], 1)).join(', ');
      return {
        sre: sre || '', passo: i + 1, referencia: i === this.iRef, alvo: this.alvo, penalidade: +s.penalidade.toFixed(6), fator: +s.fator.toFixed(4),
        penalidade_funcional_l2: s.pen_func === null ? null : +s.pen_func.toFixed(4),
        seg_funcional: s.func_s.length + 1, seg_estrutural: cam ? K + 1 : null, seg_combinada: s.comb_s.length + 1,
        custo_q_estrutural: j >= 0 ? +cam.Q[j].toFixed(3) : null,
        otima_de: j >= 0 ? +cam.inf[j].toFixed(4) : null, otima_ate: j >= 0 && Number.isFinite(cam.sup[j]) ? +cam.sup[j].toFixed(4) : null,
        quebras_removidas_km: ant ? kmL(ant[chave].filter((b) => !s[chave].includes(b))) : '',
        quebras_novas_km: ant ? kmL(s[chave].filter((b) => !ant[chave].includes(b))) : '',
        quebras_estrutural_km: kmL(s.estrut_s), quebras_funcional_km: kmL(s.func_s), quebras_combinada_km: kmL(s.comb_s),
        f1_combinada_ref: +s.f1.combinada.toFixed(3), shapiro_p: s.aud.shapiro_p ?? null, ljung_box_p: s.aud.ljung_box_p ?? null,
      };
    });
  }

  tabela() {
    const linhas = this.linhasTabela();
    const cols = [['passo', 'Passo'], ['penalidade', 'Penalidade'], ['fator', 'Fator'], ['seg_estrutural', 'Seg. estrut.'], ['seg_funcional', 'Seg. func.'], ['seg_combinada', 'Seg. comb.'],
      ['custo_q_estrutural', 'Custo Q'], ['otima_de', 'Ótima de'], ['otima_ate', 'até'], ['quebras_removidas_km', 'Removidas (km)'], ['quebras_novas_km', 'Novas (km)'],
      ['f1_combinada_ref', 'F1 comb. vs ref.'], ['shapiro_p', 'Shapiro p'], ['ljung_box_p', 'Ljung-Box p']];
    const cel = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : esc(v));
    this.$('[data-r="tabela"]').innerHTML = `<table><thead><tr>${cols.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead><tbody>${
      linhas.map((l, i) => `<tr class="${l.referencia ? 'ref' : ''} clicavel" data-i="${i}">${cols.map(([k]) => `<td class="${k.includes('quebras') ? 'txt' : ''}">${cel(l[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    this.raiz.querySelectorAll('[data-r="tabela"] tr.clicavel').forEach((tr) => tr.addEventListener('click', () => this.selecionar(Number(tr.dataset.i))));
  }

  baixar() {
    baixarCsv(`${this.ctx.sre || 'sre'}_sensibilidade_${this.alvo}.csv`, this.linhasTabela());
  }

  async baixarTodos() {
    const alvo = this.$(this.alvo === 'estrutural' ? '[data-r="graf-estrut"]' : '[data-r="graf-func"]');
    const guardado = this.iSel;
    for (let i = 0; i < this.passos.length; i++) {
      this.selecionar(i, true);
      await new Promise((r) => setTimeout(r, 350));
      await baixarPng(alvo, `${this.ctx.sre || 'sre'}_passo_${String(i + 1).padStart(2, '0')}_pen_${this.passos[i].penalidade.toFixed(2)}`);
      await new Promise((r) => setTimeout(r, 450));
    }
    this.selecionar(guardado);
  }

  alternarPlay() {
    if (this.timer) return this.parar();
    this.$('[data-r="play"]').textContent = 'Pausar';
    this.timer = setInterval(() => {
      if (this.iSel >= this.passos.length - 1) return this.parar();
      this.selecionar(this.iSel + 1);
    }, 1400);
  }

  parar() {
    clearInterval(this.timer);
    this.timer = null;
    const b = this.$('[data-r="play"]');
    if (b) b.textContent = 'Reproduzir';
  }
}

const chaveKm = (t) => ({ funcional: 'func_km', estrutural: 'estrut_km', combinada: 'comb_km' }[t]);
const kpi = (rot, val, det = '') => `<div class="kpi"><div class="rot">${rot}</div><div class="val">${val}</div>${det ? `<div class="det">${det}</div>` : ''}</div>`;
