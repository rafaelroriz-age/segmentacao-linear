// Confere se o modelo do site (site/js/modelo.js) reproduz as segmentações gravadas pelo notebook v8.
// Usa site/dados-local/ (gerado por: python supabase/exportar_dados.py --so-site), que tem os mesmos
// valores do banco, já arredondados.
//
// Uso:  node tools/validar_modelo_js.mjs
//
// Resultado de referência (out/2026): ~99,8% das segmentações idênticas; as diferenças vêm do
// arredondamento do banco (d0 com 2 casas) e de empates numéricos entre quebras vizinhas. Com os dados
// sem arredondar (cache parquet do notebook), 64.267 de 64.272 saem idênticas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(RAIZ, 'site', 'dados-local');
const M = await import(pathToFileURL(path.join(RAIZ, 'site', 'js', 'modelo.js')).href);

if (!fs.existsSync(path.join(LOCAL, 'rede.json'))) {
  console.error('site/dados-local/ não encontrado: rode  python supabase/exportar_dados.py --so-site');
  process.exit(1);
}
const rede = JSON.parse(fs.readFileSync(path.join(LOCAL, 'rede.json'), 'utf-8'));
const { beta_min: betaMin, alpha_km_func: alpha, sens_tol_km: tol } = rede.meta;
const r3 = (v) => Math.round(v * 1000) / 1000;
const ok = {}, tot = {}, f1 = [];
let audOk = 0, audTot = 0;
const t0 = Date.now();

for (const arq of fs.readdirSync(path.join(LOCAL, 'sre'))) {
  const pac = JSON.parse(fs.readFileSync(path.join(LOCAL, 'sre', arq), 'utf-8'));
  if (!pac.intervalos.length) continue;
  const a = M.arraysDoBanco(pac.intervalos);
  const cam = M.temD0(a) ? M.caminhoSre(a, betaMin) : null;
  for (const c of pac.cenarios) {
    const r = M.segmentarSre(a, { alphaFunc: alpha, beta: c.beta_estrut ?? 0, cam, auditar: c.fator === 1 });
    const meu = { funcional: r.func_km, estrutural: r.estrut_km, combinada: r.comb_km };
    for (const t of Object.keys(meu)) {
      const esperado = pac.sens_fator.find((s) => s.fator === c.fator && s.tipo === t).quebras_km;
      tot[t] = (tot[t] || 0) + 1;
      if (JSON.stringify(meu[t].map(r3)) === JSON.stringify(esperado)) ok[t] = (ok[t] || 0) + 1;
      else f1.push(M.f1Quebras(esperado, meu[t], tol).f1);
    }
    const au = c.fator === 1 && pac.auditoria.find((x) => x.fator === 1);
    if (au && au.shapiro_p !== null && r.aud.shapiro_p !== undefined) {
      audTot++;
      if (['shapiro_p', 'ks_p', 'ljung_box_p'].every((k) => Math.abs(au[k] - r.aud[k]) < 2e-3)) audOk++;
    }
  }
}

console.log(`Modelo JS × notebook v8 (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
for (const t of Object.keys(tot)) console.log(`  ${t.padEnd(11)} ${ok[t]} / ${tot[t]} idênticas (${(100 * ok[t] / tot[t]).toFixed(2)}%)`);
if (f1.length) console.log(`  F1 médio das que diferem: ${(f1.reduce((x, y) => x + y, 0) / f1.length).toFixed(3)}`);
console.log(`  auditoria (Shapiro, KS e Ljung-Box a menos de 0,002): ${audOk} / ${audTot}`);
const pior = Math.min(...Object.keys(tot).map((t) => ok[t] / tot[t]));
process.exit(pior >= 0.99 ? 0 : 1);
