-- Rodovias duplicadas segmentadas por pista (dataset analitica_segmentacao_10-11-26.xlsx, coluna "sentido").
-- Cada pista vira uma serie propria na tabela sre: sre = SRE do shape + 'C' (pista crescente) ou 'D' (decrescente).
-- Pista simples continua com sre = codigo do shape, sre_base = sre e sentido nulo.
-- As funcoes da API usam to_jsonb(s), entao as colunas novas aparecem sem alterar dados_rede()/dados_sre().
alter table public.sre add column if not exists sre_base text;
alter table public.sre add column if not exists sentido text check (sentido in ('crescente', 'decrescente'));
create index if not exists sre_sre_base_idx on public.sre (sre_base);
