// Análise de sensibilidade de um SRE: grade crescente de penalidades, um gráfico de segmentação por
// penalidade, explicação de cada passo e resumo. O cálculo é feito no navegador (modelo.js), com o
// mesmo algoritmo do notebook; serve tanto para SREs da malha quanto para datasets enviados.
import * as M from './modelo.js';
import * as GP from './graficos_passos.js';
import { grafCrops } from './graficos.js';
import { num, esc, baixarCsv, TIPOS } from './util.js';

const AJUDA = {
  alvo: 'Qual penalidade varia. Estrutural: a penalidade do PELT normal sobre d0 (quanto maior, menos quebras estruturais). Funcional: o quociente α_km do PELT l2 sobre o IGG (penalidade = α_km × extensão). A outra fica no valor do modelo atual.',
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
          <div class="chips" data-r="alvo"><button class="chip ativo" data-v="estrutural">Estrutural (d0)</button><button class="chip" data-v="funcional">Funcional (IGG)</button></div></div>
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
        <input type="range" min="0" max="0" value="0" data-r="slider" aria-label="Passo da grade de penalidades">
        <button class="btn btn-sec btn-icone" type="button" data-r="prox" aria-label="Próximo passo">▶</button>
        <button class="btn btn-sec" type="button" data-r="play">Reproduzir</button>
        <span class="rot-passo" data-r="rot-passo"></span>
      </div>
      <div class="kpis kpis-compactos" data-r="kpis"></div>
      <div class="graf" data-r="graf-passo"></div>
      <div class="explicacao" data-r="explicacao"></div>
      <details class="detalhes" data-r="det-fusoes"><summary>Fusões e escolha da penalidade funcional neste passo</summary><div data-r="fusoes"></div><div class="graf graf-baixo" data-r="graf-bic"></div></details>
      <div class="duas-colunas">
        <div><h3>Segmentos × penalidade</h3><p class="sub">Clique num ponto para abrir o passo. Linha pontilhada laranja: referência (modelo atual).</p><div class="graf graf-medio" data-r="graf-nseg"></div></div>
        <div><h3>Caminho CROPS e penalidades testadas</h3><p class="sub">Nº de quebras estruturais ótimo para cada penalidade; linhas verticais: passos da grade.</p><div class="graf graf-medio" data-r="graf-crops"></div></div>
      </div>
      <h3>Posição das quebras em cada passo</h3>
      <p class="sub">Penalidade crescente de baixo para cima; entre parênteses, o nº de segmentos. Clique numa quebra para abrir o passo.</p>
      <div class="graf" data-r="graf-faixas"></div>
      <div class="cab-cartao"><div><h3>Todos os passos</h3><p class="sub">Um gráfico por penalidade (linha laranja: quebras da combinada; verde: quebra nova; cinza: removida). Clique para abrir.</p></div></div>
      <div class="grade-mini" data-r="minis"></div>
      <div class="cab-cartao"><h3>Tabela dos passos</h3><button class="btn btn-sec" type="button" data-r="csv">Baixar CSV</button></div>
      <div class="tabela-rolagem" data-r="tabela"></div>`;
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
    this.$('[data-r="slider"]').addEventListener('input', (e) => this.selecionar(Number(e.target.value)));
    this.$('[data-r="ant"]').addEventListener('click', () => this.selecionar(Math.max(0, this.iSel - 1)));
    this.$('[data-r="prox"]').addEventListener('click', () => this.selecionar(Math.min(this.passos.length - 1, this.iSel + 1)));
    this.$('[data-r="play"]').addEventListener('click', () => this.alternarPlay());
    this.$('[data-r="csv"]').addEventListener('click', () => this.baixar());
    this.raiz.querySelectorAll('.ajuda').forEach((b) => b.addEventListener('click', () => alert(b.title)));
  }

  /** ctx: { a, cam, alphaRef, betaRef, betaMin, sre, p } */
  definir(ctx) {
    this.ctx = { p: M.PADRAO, ...ctx };
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
    this.passos = M.passosSensibilidade(a, { alvo: this.alvo, pens, alphaRef, betaRef, cam, p });
    this.iRef = this.passos.reduce((j, s, i, arr) => (Math.abs(Math.log(s.penalidade / pRef)) < Math.abs(Math.log(arr[j].penalidade / pRef)) ? i : j), 0);
    const ref = this.passos[this.iRef];
    const tol = p.BUFFER_KM;
    this.passos.forEach((s) => {
      s.f1 = Object.fromEntries(TIPOS.map((t) => [t, M.f1Quebras(ref[chaveKm(t)], s[chaveKm(t)], tol).f1]));
    });
    this.notaFaixa();
    const sl = this.$('[data-r="slider"]');
    sl.max = this.passos.length - 1;
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
      nota.textContent = 'Este SRE não tem d0 suficiente para a segmentação estrutural; só a penalidade funcional pode variar.';
    } else {
      nota.innerHTML = `<strong>${n} passos</strong> do quociente de penalidade funcional α_km, de ${num(this.passos[0].penalidade, 4)} a ${num(this.passos[n - 1].penalidade, 4)} `
        + `(referência ${num(alphaRef, 4)}). Em cada passo a penalidade do PELT l2 é α_km × extensão, ajustada pelo BIC numa faixa de ±${Math.round(this.ctx.p.MARGEM_PEN * 100)}%; a penalidade estrutural fica em ${num(betaRef, 2)}.`;
    }
  }

  selecionar(i, silencioso = false) {
    if (!this.passos || !this.passos.length) return;
    this.iSel = i;
    const { a, cam, sre } = this.ctx;
    const s = this.passos[i], ant = i > 0 ? this.passos[i - 1] : null;
    this.$('[data-r="slider"]').value = i;
    const pTxt = this.alvo === 'estrutural' ? num(s.penalidade, 3) : `α_km ${num(s.penalidade, 4)}`;
    this.$('[data-r="rot-passo"]').innerHTML = `Passo <strong>${i + 1}</strong> de ${this.passos.length} · penalidade ${pTxt} · ${num(s.fator, 2)}x da referência${i === this.iRef ? ' · <strong>referência</strong>' : ''}`;
    const K = s.estrut_s.length, j = cam ? cam.Ks.indexOf(K) : -1;
    this.$('[data-r="kpis"]').innerHTML = [
      kpi('Penalidade', pTxt, `${num(s.fator, 2)}x da referência`),
      kpi('Segmentos combinados', s.comb_s.length + 1, i === this.iRef ? 'referência' : `F1 vs. ref. ${num(s.f1.combinada, 2)}`),
      kpi('Segmentos estruturais', cam ? K + 1 : '—', j >= 0 ? `ótimo de ${num(cam.inf[j], 2)} a ${Number.isFinite(cam.sup[j]) ? num(cam.sup[j], 2) : '∞'}` : ''),
      kpi('Segmentos funcionais', s.func_s.length + 1, s.pen_func !== null ? `penalidade l2 ${num(s.pen_func, 2)}` : 'sem IGG'),
      kpi('Custo Q estrutural', j >= 0 ? num(cam.Q[j], 1) : '—', '−2 log-verossimilhança'),
      kpi('Resíduos', s.aud.shapiro_p !== undefined && s.aud.shapiro_p !== null ? `SW ${num(s.aud.shapiro_p, 3)}` : '—', s.aud.ljung_box_p !== undefined && s.aud.ljung_box_p !== null ? `Ljung-Box ${num(s.aud.ljung_box_p, 3)}` : 'auditoria não aplicável'),
    ].join('');
    GP.grafPasso(this.$('[data-r="graf-passo"]'), a, s, { anterior: ant, alvo: this.alvo, titulo: `SRE ${esc(sre || '')} · passo ${i + 1}/${this.passos.length} · penalidade ${pTxt}` });
    const linhas = M.explicarPasso(a, s, ant, cam, this.alvo, this.ctx.p);
    this.$('[data-r="explicacao"]').innerHTML = `<h3>O que aconteceu neste passo</h3><ul>${linhas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
    this.detalhesFusoes(s);
    this.raiz.querySelectorAll('.mini').forEach((m) => m.classList.toggle('sel', Number(m.dataset.i) === i));
    if (!silencioso) this.resumo();
    this.aoMudarPasso(s, i, this.rotulo(s));
  }

  rotulo(s) {
    return this.alvo === 'estrutural' ? `combinada, penalidade ${num(s.penalidade, 2)}` : `combinada, α_km ${num(s.penalidade, 4)}`;
  }

  detalhesFusoes(s) {
    const { a } = this.ctx;
    const nomes = { funcional: 'Funcional (Welch no IGG)', estrutural: 'Estrutural (Welch + Brown-Forsythe no d0)', combinada: 'Combinada (d0: média e variância; IGG: média)' };
    const blocos = TIPOS.map((t) => {
      const f = s.fusoes[t];
      if (!f.length) return `<p><strong>${nomes[t]}:</strong> nenhuma fusão${t === 'estrutural' && !this.ctx.p.FUNDIR_ESTRUT ? ' (desligada no modelo, como em Biswas & Kuna)' : ''}.</p>`;
      return `<p><strong>${nomes[t]}:</strong> ${f.length} quebra(s) removida(s) por não haver diferença significativa entre os vizinhos (p > ${num(this.ctx.p.ALPHA_TESTE, 2)}): `
        + f.map((x) => `km ${num(a.ini[x.quebra], 1)} (p = ${num(x.p, 3)})`).join(', ') + '.</p>';
    });
    blocos.push(`<p>PELT bruto antes das fusões: funcional ${s.bruto.funcional}, estrutural ${s.bruto.estrutural}, combinada ${s.bruto.combinada} quebras.</p>`);
    if (s.cand_func.length) blocos.push(`<p><strong>Penalidade funcional:</strong> ${s.cand_func.length} candidatas na faixa; venceu ${num(s.pen_func, 3)} (menor BIC).</p>`);
    this.$('[data-r="fusoes"]').innerHTML = blocos.join('');
    if (s.cand_func.length) GP.grafBicFuncional(this.$('[data-r="graf-bic"]'), s.cand_func, s.pen_func);
  }

  resumo() {
    const { a, cam, betaMin } = this.ctx;
    GP.grafSegmentosPen(this.$('[data-r="graf-nseg"]'), this.passos, this.alvo, this.iRef, this.iSel, (i) => this.selecionar(i));
    const elC = this.$('[data-r="graf-crops"]');
    if (cam && cam.Ks.length > 1) {
      const crops = cam.Ks.map((k, j) => ({ k_quebras: k, beta_inf: cam.inf[j], beta_sup: Number.isFinite(cam.sup[j]) ? cam.sup[j] : null }));
      const marcas = this.alvo === 'estrutural'
        ? this.passos.map((s, i) => ({ beta: s.penalidade, cor: GP.corPasso(i, this.passos.length, this.iRef), largura: i === this.iSel ? 3 : i === this.iRef ? 2.2 : 1.1 }))
        : [{ beta: this.ctx.betaRef, cor: GP.corPasso(0, 1, 0), largura: 2.2, rotulo: 'penalidade estrutural (fixa neste modo)' }];
      grafCrops(elC, crops, betaMin ?? cam.inf[cam.inf.length - 1], marcas, null);
    } else {
      elC.innerHTML = '<p class="sub vazio">Sem caminho CROPS (SRE sem d0 suficiente).</p>';
    }
    GP.grafFaixasPassos(this.$('[data-r="graf-faixas"]'), a, this.passos, this.alvo, this.iRef, this.iSel, (i) => this.selecionar(i));
  }

  minis() {
    const { a } = this.ctx;
    const caixa = this.$('[data-r="minis"]');
    this.obs?.disconnect();
    caixa.innerHTML = this.passos.map((s, i) => `<button type="button" class="mini ${i === this.iRef ? 'ref' : ''} ${i === this.iSel ? 'sel' : ''}" data-i="${i}">
      <span class="mini-tit">${i + 1}. penalidade ${this.alvo === 'estrutural' ? num(s.penalidade, 2) : num(s.penalidade, 4)}${i === this.iRef ? ' · ref.' : ''}</span>
      <span class="mini-sub">${s.estrut_s.length + 1} estrut. · ${s.func_s.length + 1} func. · ${s.comb_s.length + 1} comb.</span>
      <span class="mini-graf"></span></button>`).join('');
    caixa.querySelectorAll('.mini').forEach((b) => b.addEventListener('click', () => { this.selecionar(Number(b.dataset.i)); this.$('[data-r="graf-passo"]').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    // desenha só quando o mini-gráfico aparece na tela
    this.obs = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (!e.isIntersecting) return;
      const i = Number(e.target.dataset.i);
      GP.grafPassoMini(e.target.querySelector('.mini-graf'), a, this.passos[i], { anterior: i > 0 ? this.passos[i - 1] : null, alvo: this.alvo, ref: i === this.iRef });
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
