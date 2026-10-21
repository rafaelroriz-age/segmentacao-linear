-- Esquema de dados da segmentacao homogenea (SGP / GOINFRA)
-- Gerado por supabase/exportar_dados.py e carregado por supabase/carregar_dados.py.
-- fator = multiplicador da penalidade estrutural (beta); fator 1 = modelo atual (v8).

create table public.sre (
    sre               text primary key,
    rodovia           text,
    classe_via        text,
    inicio            text,
    fim               text,
    km_inicial        double precision,
    km_final          double precision,
    extensao_km       double precision,
    situacao          text,
    jurisdicao        text,
    regional          smallint,
    trecho            text,
    perimetro_urbano  boolean,
    federal           text,
    tem_dados         boolean not null default false,
    n_intervalos      integer,
    iri_medio         double precision,
    igg_medio         double precision,
    d0_medio          double precision,
    n_seg_funcional   integer,
    n_seg_estrutural  integer,
    n_seg_combinada   integer,
    beta_estrut       double precision,
    classe_iri        text,
    classe_igg        text,
    classe_d0         text,
    geom_mapa         jsonb not null,   -- [[lon, lat], ...] simplificada (~40 m), sentido do km crescente
    geom_detalhe      jsonb not null    -- idem (~3 m), usada para recortar os intervalos de 200 m
);
create index sre_regional_idx on public.sre (regional);

-- intervalos de ~200 m (sinais do modelo; *_obs = valor medido, senao interpolado)
create table public.intervalo (
    sre         text not null references public.sre (sre) on delete cascade,
    ordem       integer not null,
    km_inicial  double precision not null,
    km_final    double precision not null,
    d0          double precision,
    igg         double precision,
    iri         double precision,
    aca         double precision,
    d0_obs      boolean not null,
    igg_obs     boolean not null,
    iri_obs     boolean not null,
    primary key (sre, ordem)
);

create table public.segmento (
    fator           double precision not null,
    tipo            text not null check (tipo in ('funcional', 'estrutural', 'combinada')),
    sre             text not null references public.sre (sre) on delete cascade,
    seg_id          integer not null,
    km_inicial      double precision not null,
    km_final        double precision not null,
    comprimento_km  double precision,
    n_intervalos    integer,
    d0_medio        double precision,
    d0_desvio       double precision,
    d0_erro_padrao  double precision,
    d0_cv           double precision,
    d0_frac_medido  double precision,
    igg_medio       double precision,
    igg_desvio      double precision,
    igg_cv          double precision,
    iri_medio       double precision,
    iri_desvio      double precision,
    iri_cv          double precision,
    coerente        boolean,
    primary key (sre, fator, tipo, seg_id)
);

-- penalidades e numero de quebras de cada SRE em cada cenario
create table public.cenario (
    fator                double precision not null,
    sre                  text not null references public.sre (sre) on delete cascade,
    n_intervalos         integer,
    extensao_km          double precision,
    frac_d0_medido       double precision,
    pen_func             double precision,
    beta_estrut          double precision,
    origem_beta          text,
    beta_cotovelo_sre    double precision,
    k_cotovelo_sre       integer,
    beta_zero_quebras    double precision,
    n_solucoes_crops     integer,
    piso_var_d0          double precision,
    quebras_func_pelt    integer,
    quebras_func         integer,
    quebras_estrut_pelt  integer,
    quebras_estrut       integer,
    quebras_comb_pelt    integer,
    quebras_comb         integer,
    primary key (sre, fator)
);

-- auditoria dos residuos estruturais (Biswas & Kuna, 2022, "Test of Assumptions")
create table public.auditoria (
    fator                 double precision not null,
    sre                   text not null references public.sre (sre) on delete cascade,
    beta                  double precision,
    n_residuos            integer,
    n_segmentos           integer,
    shapiro_w             double precision,
    shapiro_p             double precision,
    ks_d                  double precision,
    ks_p                  double precision,
    shapiro_p_res_bruto   double precision,
    normalidade_ok        boolean,
    acf_lag1              double precision,
    acf_max_abs           double precision,
    banda_acf_95          double precision,
    lags_fora_banda       integer,
    n_lags                integer,
    ljung_box_q           double precision,
    ljung_box_p           double precision,
    independencia_ok      boolean,
    brown_forsythe_p      double precision,
    heterocedastico       boolean,
    razao_desvio_max_min  double precision,
    erro_padrao_medio     double precision,
    primary key (sre, fator)
);

-- caminho CROPS: segmentacoes otimas do PELT 'normal' e o intervalo de beta de cada uma
create table public.crops (
    sre           text not null references public.sre (sre) on delete cascade,
    k_quebras     integer not null,
    custo_q       double precision,
    beta_inf      double precision,
    beta_sup      double precision,   -- null = infinito
    cotovelo_sre  boolean,
    escolhido     boolean,
    primary key (sre, k_quebras)
);

-- sensibilidade por SRE: quebras de cada cenario e concordancia com a referencia (fator 1)
create table public.sens_fator (
    sre           text not null references public.sre (sre) on delete cascade,
    fator         double precision not null,
    tipo          text not null check (tipo in ('funcional', 'estrutural', 'combinada')),
    n_segmentos   integer not null,
    quebras_km    jsonb not null,
    recall_ref    double precision,
    precisao_ref  double precision,
    f1_ref        double precision,
    identico_ref  boolean,
    primary key (sre, fator, tipo)
);

-- faixa de beta em que a segmentacao estrutural da referencia continua otima
create table public.sens_sre (
    sre                text primary key references public.sre (sre) on delete cascade,
    beta_ref           double precision,
    k_ref              integer,
    beta_estavel_inf   double precision,
    beta_estavel_sup   double precision,
    fator_estavel_inf  double precision,
    fator_estavel_sup  double precision,
    tem_d0             boolean
);

create table public.sens_rede (
    fator     double precision primary key,
    metricas  jsonb not null
);

create table public.diag_rede (
    beta            double precision primary key,
    quebras_rede    integer,
    quebras_por_km  double precision
);

create table public.calib_func (
    alpha_km        double precision primary key,
    soma_bic        double precision,
    quebras_por_km  double precision
);

-- km de pista por classe de condicao; regional 0 = malha inteira
create table public.resumo_classes (
    parametro  text not null check (parametro in ('iri', 'igg', 'd0')),
    regional   smallint not null,
    classe     text not null,
    km         double precision not null,
    primary key (parametro, regional, classe)
);

create table public.classe_limite (
    parametro   text not null check (parametro in ('iri', 'igg', 'd0')),
    ordem       smallint not null,
    classe      text not null,
    limite_sup  double precision,   -- null = sem limite superior
    cor         text not null check (cor ~ '^#[0-9a-fA-F]{6}$'),
    primary key (parametro, ordem)
);

create table public.parametro (
    parametro  text primary key,
    valor      text
);

create table public.meta (
    chave  text primary key,
    valor  jsonb
);
