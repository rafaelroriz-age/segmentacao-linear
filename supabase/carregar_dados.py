"""
Carrega supabase/dados/*.parquet (gerados por exportar_dados.py) no Postgres do Supabase.

Substitui todo o conteudo das tabelas numa unica transacao (TRUNCATE + COPY): ou entra a carga
inteira, ou nada muda. Usa a conexao direta do Postgres, nunca a API publica.

Uso (PowerShell):
    $env:SUPABASE_DB_URL = "postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres"
    python supabase/carregar_dados.py

A string de conexao fica no painel do Supabase (Project Settings > Database). Nao grave a senha em
arquivo do repositorio.
"""
import io, os, sys, json
from urllib.parse import urlparse, unquote
import pandas as pd
import psycopg2

AQUI = os.path.dirname(os.path.abspath(__file__))
DADOS = os.path.join(AQUI, 'dados')

# ordem de carga (sre primeiro por causa das chaves estrangeiras)
TABELAS = ['sre', 'intervalo', 'segmento', 'cenario', 'auditoria', 'crops', 'sens_fator', 'sens_sre',
           'sens_rede', 'diag_rede', 'calib_func', 'resumo_classes', 'classe_limite', 'parametro', 'meta']


def tipos_colunas(cur, tabela):
    cur.execute("select column_name, data_type from information_schema.columns "
                "where table_schema = 'public' and table_name = %s", (tabela,))
    return dict(cur.fetchall())


def preparar(df, tipos):
    faltam = set(df.columns) - set(tipos)
    if faltam:
        sys.exit(f'colunas sem correspondencia no banco: {sorted(faltam)}')
    df = df.copy()
    for c in df.columns:
        if tipos[c] in ('integer', 'smallint', 'bigint'):
            df[c] = pd.to_numeric(df[c]).round().astype('Int64')
        elif tipos[c] == 'boolean':
            df[c] = df[c].map(lambda v: None if v is None or (isinstance(v, float) and pd.isna(v)) else bool(v))
    return df


def main():
    # Tenta ler da variável de ambiente primeiro, depois de um argumento
    url = os.environ.get('SUPABASE_DB_URL')
    if not url and len(sys.argv) > 1:
        url = sys.argv[1]
    if not url:
        sys.exit('Uso: python carregar_dados.py "postgresql://postgres:senha@host:5432/postgres"\n'
                 'Ou defina a variável de ambiente SUPABASE_DB_URL.')
    meta = json.load(open(os.path.join(DADOS, 'meta.json'), encoding='utf-8'))
    print(f"Dados gerados em {meta['gerado_em']} a partir de {meta['entrada']}")

    # parametros separados em vez da URI: no Windows em portugues a URI completa falha com UnicodeDecodeError
    u = urlparse(url)
    conexao = dict(host=u.hostname, port=u.port or 5432, user=unquote(u.username or ''),
                   password=unquote(u.password or ''), dbname=(u.path or '/postgres').lstrip('/') or 'postgres',
                   sslmode='require', connect_timeout=15)
    with psycopg2.connect(**conexao) as con, con.cursor() as cur:
        cur.execute('truncate ' + ', '.join(f'public.{t}' for t in TABELAS))
        for t in TABELAS:
            df = pd.read_parquet(os.path.join(DADOS, f'{t}.parquet'))
            df = preparar(df, tipos_colunas(cur, t))
            buf = io.StringIO()
            df.to_csv(buf, index=False, header=False, na_rep='')
            buf.seek(0)
            cols = ', '.join(f'"{c}"' for c in df.columns)
            cur.copy_expert(f"copy public.{t} ({cols}) from stdin with (format csv, null '')", buf)
            print(f'  {t:15s} {len(df):>8d} linhas')
        cur.execute('analyze')
    print('Carga concluida.')


if __name__ == '__main__':
    main()
