-- API do site: duas funcoes que devolvem pacotes JSON prontos (uma chamada por tela, sem o
-- limite de 1000 linhas do PostgREST). security invoker: o RLS das tabelas continua valendo.
-- O formato e o mesmo de site/dados-local/ (gerado por supabase/exportar_dados.py).

create or replace function public.dados_rede()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not public.acesso_permitido() then
        raise exception 'acesso negado' using errcode = '42501';
    end if;
    perform acesso.registrar_acesso('rede');
    return jsonb_build_object(
        'meta',           (select coalesce(jsonb_object_agg(m.chave, m.valor), '{}') from public.meta m),
        'sres',           (select coalesce(jsonb_agg(to_jsonb(s) - 'geom_detalhe' order by s.sre), '[]') from public.sre s),
        'resumo_classes', (select coalesce(jsonb_agg(to_jsonb(r) order by r.parametro, r.regional, r.classe), '[]') from public.resumo_classes r),
        'classe_limite',  (select coalesce(jsonb_agg(to_jsonb(c) order by c.parametro, c.ordem), '[]') from public.classe_limite c),
        'sens_rede',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.fator), '[]') from public.sens_rede x),
        'diag_rede',      (select coalesce(jsonb_agg(to_jsonb(d) order by d.beta), '[]') from public.diag_rede d),
        'calib_func',     (select coalesce(jsonb_agg(to_jsonb(c) order by c.alpha_km), '[]') from public.calib_func c),
        'parametros',     (select coalesce(jsonb_agg(to_jsonb(p) order by p.parametro), '[]') from public.parametro p)
    );
end;
$$;

create or replace function public.dados_sre(p_sre text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not public.acesso_permitido() then
        raise exception 'acesso negado' using errcode = '42501';
    end if;
    if p_sre is null or p_sre !~ '^[0-9A-Z]{3,16}$' then
        raise exception 'codigo de SRE invalido' using errcode = '22023';
    end if;
    perform acesso.registrar_acesso('sre:' || p_sre);
    return jsonb_build_object(
        'sre',        (select to_jsonb(s) - 'geom_mapa' from public.sre s where s.sre = p_sre),
        'intervalos', (select coalesce(jsonb_agg(to_jsonb(i) - 'sre' order by i.ordem), '[]') from public.intervalo i where i.sre = p_sre),
        'segmentos',  (select coalesce(jsonb_agg(to_jsonb(g) - 'sre' order by g.fator, g.tipo, g.seg_id), '[]') from public.segmento g where g.sre = p_sre),
        'cenarios',   (select coalesce(jsonb_agg(to_jsonb(c) - 'sre' order by c.fator), '[]') from public.cenario c where c.sre = p_sre),
        'auditoria',  (select coalesce(jsonb_agg(to_jsonb(a) - 'sre' order by a.fator), '[]') from public.auditoria a where a.sre = p_sre),
        'crops',      (select coalesce(jsonb_agg(to_jsonb(k) - 'sre' order by k.k_quebras), '[]') from public.crops k where k.sre = p_sre),
        'sens_fator', (select coalesce(jsonb_agg(to_jsonb(f) - 'sre' order by f.fator, f.tipo), '[]') from public.sens_fator f where f.sre = p_sre),
        'sens_sre',   (select to_jsonb(e) - 'sre' from public.sens_sre e where e.sre = p_sre)
    );
end;
$$;

revoke all on function public.dados_rede() from public, anon;
revoke all on function public.dados_sre(text) from public, anon;
grant execute on function public.dados_rede() to authenticated;
grant execute on function public.dados_sre(text) to authenticated;
