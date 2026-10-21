// Fonte de dados: Supabase (funções dados_rede / dados_sre, protegidas por RLS) ou arquivos locais
// com o mesmo formato.
import { CONFIG } from './config.js';

const local = !CONFIG.SUPABASE_URL || new URLSearchParams(location.search).get('fonte') === 'local';
let cliente = null;

export const modoLocal = local;

export function iniciarCliente() {
  if (local || cliente) return cliente;
  cliente = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cliente;
}

export async function sessaoAtual() {
  if (local) return { user: { email: 'modo local' } };
  const { data } = await iniciarCliente().auth.getSession();
  return data.session;
}

export async function entrar(email, senha) {
  const { error } = await iniciarCliente().auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
}

export async function sair() {
  if (!local) await iniciarCliente().auth.signOut();
}

async function rpc(nome, args) {
  const { data, error } = await iniciarCliente().rpc(nome, args);
  if (error) {
    if (error.code === '42501') throw new Error('Seu usuário não está autorizado a ver estes dados. Peça a liberação ao administrador.');
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
