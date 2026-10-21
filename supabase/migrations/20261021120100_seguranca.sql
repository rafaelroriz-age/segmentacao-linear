-- Seguranca: so leitura, so para usuarios autenticados, com e-mail confirmado e presentes na lista
-- acesso.usuario_autorizado. Ninguem escreve pela API: a carga usa a conexao direta do Postgres
-- (supabase/carregar_dados.py), que nao passa pelo PostgREST.

-- ── Esquema privado (nao exposto pela API) ────────────────────────────────────
create schema if not exists acesso;
revoke all on schema acesso from public, anon, authenticated;

create table acesso.usuario_autorizado (
    email      text primary key check (email = lower(email) and email like '%@%'),
    nome       text,
    ativo      boolean not null default true,
    criado_em  timestamptz not null default now()
);

create table acesso.log_acesso (
    id        bigint generated always as identity primary key,
    user_id   uuid not null,
    recurso   text not null,
    em        timestamptz not null default now()
);
create index log_acesso_em_idx on acesso.log_acesso (em desc);

alter table acesso.usuario_autorizado enable row level security;
alter table acesso.log_acesso enable row level security;
revoke all on all tables in schema acesso from public, anon, authenticated;

-- ── Funcoes de controle ───────────────────────────────────────────────────────
-- security definer: le acesso.* e auth.users, que o usuario nao enxerga; search_path vazio
-- impede sequestro de nomes.
create or replace function public.acesso_permitido()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from acesso.usuario_autorizado a
        join auth.users u on lower(u.email) = a.email
        where u.id = auth.uid()
          and a.ativo
          and u.email_confirmed_at is not null
    );
$$;

create or replace function acesso.registrar_acesso(p_recurso text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into acesso.log_acesso (user_id, recurso) values (auth.uid(), left(p_recurso, 64));
end;
$$;

revoke all on function public.acesso_permitido() from public, anon;
grant execute on function public.acesso_permitido() to authenticated;
-- chamada de dentro de dados_rede()/dados_sre(); o esquema acesso nao e exposto pela API, entao o
-- usuario nao consegue chama-la direto nem ler as tabelas (USAGE nao concede acesso a tabelas)
revoke all on function acesso.registrar_acesso(text) from public, anon;
grant usage on schema acesso to authenticated;
grant execute on function acesso.registrar_acesso(text) to authenticated;

-- ── Tabelas de dados: RLS + somente SELECT para authenticated ────────────────
do $$
declare
    t text;
begin
    foreach t in array array[
        'sre', 'intervalo', 'segmento', 'cenario', 'auditoria', 'crops', 'sens_fator', 'sens_sre',
        'sens_rede', 'diag_rede', 'calib_func', 'resumo_classes', 'classe_limite', 'parametro', 'meta'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from public, anon, authenticated', t);
        execute format('grant select on table public.%I to authenticated', t);
        execute format('create policy leitura_autorizada on public.%I for select to authenticated '
                       'using ((select public.acesso_permitido()))', t);
    end loop;
end;
$$;

-- tabelas e funcoes criadas depois nao ficam expostas por padrao
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
