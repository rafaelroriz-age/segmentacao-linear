# Segmentação homogênea linear — SGP

Segmentação homogênea da malha rodoviária (SRE → intervalos de 200 m) com PELT funcional (IGG),
estrutural (d0, custo `normal` + CROPS, Biswas & Kuna 2022) e combinada, mais a análise de
sensibilidade da penalidade β para cada SRE. Contexto científico e histórico em `documentacao-ia/` e `AGENTS.md`.

## Site

`site/` é um site estático (GitHub Pages) inspirado no Atlas/SGP: painel de condição da malha,
mapa com os SREs e, ao clicar num SRE, os intervalos de 200 m no mapa, os gráficos e as tabelas da
segmentação atual (fator 1x) e de cada cenário de sensibilidade (0,25x a 3x).

Os dados não ficam no repositório: o site lê do Supabase, protegido por login e RLS.

```
segmentacao_rede_v8_sensibilidade.ipynb   modelo (v8) + cenários de β
        │  supabase/exportar_dados.py     roda as células 1-7 do notebook, sem gráficos (~9 min)
        ▼
supabase/dados/*.parquet ──► supabase/carregar_dados.py ──► Postgres (Supabase, RLS)
site/dados-local/*.json  (desenvolvimento)                    │ dados_rede() / dados_sre()
                                                               ▼
                                                     site/ (GitHub Pages, supabase-js)
```

## Banco (Supabase)

1. Aplique as migrações de `supabase/migrations/` na ordem (SQL editor, CLI ou MCP do Supabase).
2. Gere e carregue os dados:
   ```powershell
   conda activate SGP
   python supabase/exportar_dados.py
   $env:SUPABASE_DB_URL = "postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres"
   python supabase/carregar_dados.py
   ```
3. Crie os usuários em *Authentication → Users* (com e-mail confirmado) e autorize cada um:
   ```sql
   insert into acesso.usuario_autorizado (email, nome) values ('pessoa@empresa.com.br', 'Nome');
   ```
4. Recomendado: desative o cadastro público em *Authentication → Providers → Email*.

### Segurança

- RLS ligado em todas as tabelas; `anon` não tem nenhum privilégio.
- `authenticated` só tem `SELECT`, e a política exige e-mail confirmado e presente em
  `acesso.usuario_autorizado` (`public.acesso_permitido()`, `security definer`, `search_path` vazio).
- Nenhuma política de escrita: a carga usa a conexão direta do Postgres, fora da API.
- O esquema `acesso` (lista de autorizados e log) não é exposto pela API. Cada chamada de
  `dados_rede()`/`dados_sre()` grava em `acesso.log_acesso`.
- `dados_sre()` valida o código do SRE; tabelas e funções novas não ficam expostas por padrão.
- A chave `anon` em `site/js/config.js` é pública por definição. A `service_role` nunca vai para o site.

## Desenvolvimento local

Com `SUPABASE_URL` vazio em `site/js/config.js` (ou `?fonte=local` na URL), o site lê
`site/dados-local/`, gerado pelo exportador, e não pede login:

```powershell
python -m http.server 8000 --directory site
```

`python supabase/exportar_dados.py --so-site` regrava `site/dados-local/` a partir de `supabase/dados/`
sem rodar o modelo de novo.

## Git

A pasta tem planilhas, PDFs e gráficos com dados do cliente; o `.gitignore` é uma lista de permissão.
Os notebooks entram sem saídas (filtro `tools/nbstrip.py`). Em cada clone:

```powershell
git config filter.nbstrip.clean "python tools/nbstrip.py"
git config filter.nbstrip.smudge cat
```

O deploy do site é feito por `.github/workflows/pages.yml` a cada push em `main` que altere `site/`
(em *Settings → Pages*, fonte = GitHub Actions).
