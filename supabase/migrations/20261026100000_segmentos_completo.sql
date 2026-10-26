-- Segmentos do modelo atual (fator 1) de toda a malha com todas as estatisticas da planilha do SRE
-- (desvio, erro padrao, CV, fracao medida, coerencia). Usado so no download "Segmentos da malha (Excel)";
-- o mapa continua com segmentos_rede(), que e mais leve.
-- Linhas compactas: [sre, seg_id, km_inicial, km_final, comprimento_km, n_intervalos,
--                    d0_medio, d0_desvio, d0_erro_padrao, d0_cv, d0_frac_medido,
--                    igg_medio, igg_desvio, igg_cv, iri_medio, iri_desvio, iri_cv, coerente]
create or replace function public.segmentos_rede_completo(p_tipo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if p_tipo is null or p_tipo not in ('funcional', 'estrutural', 'combinada') then
        raise exception 'tipo de segmentacao invalido' using errcode = '22023';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_array(
                   g.sre, g.seg_id, g.km_inicial, g.km_final, g.comprimento_km, g.n_intervalos,
                   g.d0_medio, g.d0_desvio, g.d0_erro_padrao, g.d0_cv, g.d0_frac_medido,
                   g.igg_medio, g.igg_desvio, g.igg_cv, g.iri_medio, g.iri_desvio, g.iri_cv, g.coerente)
               order by g.sre, g.seg_id), '[]')
        from public.segmento g
        where g.fator = 1 and g.tipo = p_tipo
    );
end;
$$;

revoke all on function public.segmentos_rede_completo(text) from public;
grant execute on function public.segmentos_rede_completo(text) to anon, authenticated;
