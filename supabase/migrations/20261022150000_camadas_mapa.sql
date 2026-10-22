-- Camadas do mapa por nivel de zoom e download do dataset original.
-- Mesmo padrao das funcoes dados_rede()/dados_sre(): somente leitura, security definer, search_path vazio,
-- parametros validados. As tabelas continuam sem nenhuma permissao direta para anon/authenticated.

-- Segmentos homogeneos do modelo atual (fator 1) de toda a malha, para o zoom intermediario.
-- Linhas compactas: [sre, seg_id, km_inicial, km_final, d0_medio, igg_medio, iri_medio]
create or replace function public.segmentos_rede(p_tipo text)
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
        select coalesce(jsonb_agg(jsonb_build_array(g.sre, g.seg_id, g.km_inicial, g.km_final, g.d0_medio, g.igg_medio, g.iri_medio)
                                  order by g.sre, g.seg_id), '[]')
        from public.segmento g
        where g.fator = 1 and g.tipo = p_tipo
    );
end;
$$;

-- Intervalos de 200 m (dataset original, depois da interpolacao do modelo) de ate 300 SREs por chamada.
-- Linhas compactas: [sre, km_inicial, km_final, d0, igg, iri, aca, d0_obs, igg_obs, iri_obs]
-- p_geom = true tambem devolve a geometria detalhada (~3 m) de cada SRE, para o zoom maximo do mapa.
create or replace function public.intervalos_sres(p_sres text[], p_geom boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if p_sres is null or cardinality(p_sres) = 0 or cardinality(p_sres) > 300 then
        raise exception 'informe de 1 a 300 SREs' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_sres) as s(c) where c is null or c !~ '^[0-9A-Z]{3,16}$') then
        raise exception 'codigo de SRE invalido' using errcode = '22023';
    end if;
    return jsonb_build_object(
        'intervalos', (
            select coalesce(jsonb_agg(jsonb_build_array(i.sre, i.km_inicial, i.km_final, i.d0, i.igg, i.iri, i.aca,
                                                        i.d0_obs, i.igg_obs, i.iri_obs) order by i.sre, i.ordem), '[]')
            from public.intervalo i
            where i.sre = any (p_sres)
        ),
        'geom', case when p_geom then (
            select coalesce(jsonb_object_agg(s.sre, s.geom_detalhe), '{}')
            from public.sre s
            where s.sre = any (p_sres)
        ) else null end
    );
end;
$$;

revoke all on function public.segmentos_rede(text) from public;
revoke all on function public.intervalos_sres(text[], boolean) from public;
grant execute on function public.segmentos_rede(text) to anon, authenticated;
grant execute on function public.intervalos_sres(text[], boolean) to anon, authenticated;
