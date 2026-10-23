// Projeto Supabase. A chave "anon" é pública por definição: quem protege os dados é o RLS do
// banco (supabase/migrations/*_seguranca.sql). Nunca coloque aqui a chave service_role.
// Com SUPABASE_URL vazio (ou ?fonte=local na URL) o site lê site/dados-local/, gerado por
// supabase/exportar_dados.py — útil para desenvolver sem acesso ao banco.
export const CONFIG = {
  SUPABASE_URL: 'https://fevplmcxfzjaznshandm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZldnBsbWN4ZnpqYXpuc2hhbmRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NzA1NzUsImV4cCI6MjEwODI0NjU3NX0.6fqiLo1uSFCeJEuf36PArkyQQLiVk2-b4S0FRf7Q-l0',
  DADOS_LOCAIS: './dados-local/',
  // Chave de navegador dos basemaps da CARTO (Positron / Dark Matter); vai na URL dos tiles, é pública.
  CARTO_KEY: 'cb1_4st2_1_c5e4bb493c02b45ea8fdbfc0',
};
