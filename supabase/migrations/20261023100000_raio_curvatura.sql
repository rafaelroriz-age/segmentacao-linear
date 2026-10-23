-- Parametro estrutural alternativo ao d0: raio de curvatura da bacia (DNER-ME 024),
-- R = 6250 / (2 (D0 - D20)) em m. d20 fica guardado para auditoria do calculo.
-- dados_sre() ja devolve todas as colunas de intervalo (to_jsonb); intervalos_sres() ganha o raio no fim de cada linha.

alter table public.intervalo add column if not exists d20 double precision;
alter table public.intervalo add column if not exists raio double precision;
alter table public.intervalo add column if not exists raio_obs boolean not null default false;

-- Linhas compactas: [sre, km_inicial, km_final, d0, igg, iri, aca, d0_obs, igg_obs, iri_obs, raio, raio_obs]
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
                                                        i.d0_obs, i.igg_obs, i.iri_obs, i.raio, i.raio_obs) order by i.sre, i.ordem), '[]')
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

revoke all on function public.intervalos_sres(text[], boolean) from public;
grant execute on function public.intervalos_sres(text[], boolean) to anon, authenticated;
