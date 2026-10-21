// Projeto Supabase. A chave "anon" é pública por definição: quem protege os dados é o RLS do
// banco (supabase/migrations/*_seguranca.sql). Nunca coloque aqui a chave service_role.
// Com SUPABASE_URL vazio (ou ?fonte=local na URL) o site lê site/dados-local/, gerado por
// supabase/exportar_dados.py — útil para desenvolver sem acesso ao banco.
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  DADOS_LOCAIS: './dados-local/',
};
