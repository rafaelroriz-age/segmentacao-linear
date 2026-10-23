// Fonte de dados: Supabase (funções dados_rede, dados_sre, segmentos_rede e intervalos_sres, leitura pública)
// ou arquivos locais com o mesmo formato (site/dados-local/, gerado por supabase/exportar_dados.py).
import { CONFIG } from './config.js';

const local = !CONFIG.SUPABASE_URL || new URLSearchParams(location.search).get('fonte') === 'local';
let cliente = null;

export const modoLocal = local;

export function iniciarCliente() {
  if (local || cliente) return cliente;
  cliente = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cliente;
}

async function rpc(nome, args) {
  const { data, error } = await iniciarCliente().rpc(nome, args);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function json(caminho) {
  const r = await fetch(CONFIG.DADOS_LOCAIS + caminho);
  if (!r.ok) throw new Error(`Arquivo local não encontrado: ${caminho} (rode supabase/exportar_dados.py)`);
  return r.json();
}

const cacheSre = new Map();

export async function carregarRede() {
  return local ? json('rede.json') : rpc('dados_rede');
}

export async function carregarSre(sre) {
  if (!cacheSre.has(sre)) {
    const p = local ? json(`sre/${encodeURIComponent(sre)}.json`) : rpc('dados_sre', { p_sre: sre });
    cacheSre.set(sre, p);
    p.catch(() => cacheSre.delete(sre));
  }
  return cacheSre.get(sre);
}

// segmentos homogêneos do modelo atual de toda a malha: [{sre, seg_id, km_inicial, km_final, d0_medio, igg_medio, iri_medio}]
const cacheSegRede = new Map();
export function carregarSegmentosRede(tipo) {
  if (!cacheSegRede.has(tipo)) {
    const p = (local ? json(`segmentos_${tipo}.json`) : rpc('segmentos_rede', { p_tipo: tipo }))
      .then((linhas) => linhas.map(([sre, seg_id, km_inicial, km_final, d0_medio, igg_medio, iri_medio]) => ({ sre, seg_id, km_inicial, km_final, d0_medio, igg_medio, iri_medio })));
    cacheSegRede.set(tipo, p);
    p.catch(() => cacheSegRede.delete(tipo));
  }
  return cacheSegRede.get(tipo);
}

// intervalos de 200 m (dataset original) de vários SREs; com geom = true também a geometria detalhada
export async function carregarIntervalos(sres, geom = false) {
  const out = { intervalos: {}, geom: {} };
  if (local) {
    await Promise.all(sres.map(async (s) => {
      const pac = await carregarSre(s);
      out.intervalos[s] = pac.intervalos;
      if (geom) out.geom[s] = pac.sre.geom_detalhe;
    }));
    return out;
  }
  for (let i = 0; i < sres.length; i += 300) {
    const parte = sres.slice(i, i + 300);
    const r = await rpc('intervalos_sres', { p_sres: parte, p_geom: geom });
    parte.forEach((s) => { out.intervalos[s] = []; });
    for (const [sre, km_inicial, km_final, d0, igg, iri, aca, d0_obs, igg_obs, iri_obs, raio, raio_obs] of r.intervalos) {
      out.intervalos[sre].push({ km_inicial, km_final, d0, igg, iri, aca, d0_obs, igg_obs, iri_obs, raio, raio_obs: !!raio_obs });
    }
    Object.assign(out.geom, r.geom || {});
  }
  return out;
}
