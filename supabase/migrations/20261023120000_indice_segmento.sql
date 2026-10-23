-- segmentos_rede(p_tipo) filtra por fator e tipo na malha inteira; sem indice a consulta passava do
-- limite de tempo da API (3 s) para o tipo com mais linhas.
create index if not exists segmento_fator_tipo_idx on public.segmento (fator, tipo, sre, seg_id);
analyze public.segmento;
