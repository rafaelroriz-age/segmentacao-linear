// Mira sincronizada: o km sob o cursor aparece como linha tracejada em todos os gráficos de perfil do
// SRE aberto (mesmo eixo km) e como marcador no mapa; passar o mouse no mapa move a mesma linha nos gráficos.
import { km } from './util.js';

/** aoMover(k | null) é chamado quando o cursor percorre um dos gráficos ligados */
export function criarMira(aoMover = () => {}) {
  const gds = [];

  function linha(gd) {
    let m = gd.querySelector(':scope > .mira');
    if (!m) {
      m = document.createElement('div');
      m.className = 'mira';
      m.hidden = true;
      m.innerHTML = '<span></span>';
      gd.appendChild(m);
    }
    return m;
  }

  function mostrar(k) {
    for (const gd of gds) {
      const fl = gd._fullLayout;
      if (!fl?.xaxis || !gd.isConnected) continue;
      const m = linha(gd);
      const px = k === null || k === undefined ? NaN : fl.xaxis.l2p(k);
      if (!(px >= 0 && px <= fl._size.w)) { m.hidden = true; continue; }
      m.hidden = false;
      m.style.left = `${fl._size.l + px}px`;
      m.style.top = `${fl._size.t}px`;
      m.style.height = `${fl._size.h}px`;
      m.firstChild.textContent = `km ${km(k)}`;
    }
  }

  function ligar(gd) {
    if (typeof gd === 'string') gd = document.getElementById(gd);
    if (!gd || gds.includes(gd)) return;
    gds.push(gd);
    gd.addEventListener('mousemove', (e) => {
      const fl = gd._fullLayout;
      if (!fl?.xaxis) return;
      const r = gd.getBoundingClientRect();
      const px = e.clientX - r.left - fl._size.l, py = e.clientY - r.top - fl._size.t;
      const k = px >= 0 && px <= fl._size.w && py >= 0 && py <= fl._size.h ? fl.xaxis.p2l(px) : null;
      mostrar(k);
      aoMover(k);
    });
    gd.addEventListener('mouseleave', () => { mostrar(null); aoMover(null); });
  }

  return { ligar, mostrar };
}
