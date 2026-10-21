"""
Exporta o modelo de segmentacao (v8) e a analise de sensibilidade para o banco e o site.

Executa as celulas 1-7 de `segmentacao_rede_v8_sensibilidade.ipynb` (leitura, helpers, calibracao,
segmentacao e cenarios de penalidade) sem gerar graficos, e grava as tabelas do banco em
`supabase/dados/*.parquet`. O fator 1.00 e exatamente o resultado da v8 (modelo atual).

Tambem grava `site/dados-local/` (mesma estrutura que as funcoes `dados_rede()` e `dados_sre()`
do banco devolvem) para rodar o site sem Supabase. As duas pastas ficam fora do git.

Uso:  python supabase/exportar_dados.py            (roda o modelo e grava tudo)
      python supabase/exportar_dados.py --so-site  (so regrava site/dados-local/ a partir de supabase/dados/)
"""
import os, re, sys, json, time, shutil, hashlib, tempfile
from datetime import datetime

import matplotlib
matplotlib.use('Agg')
import numpy as np
import pandas as pd
import geopandas as gpd

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
NOTEBOOK = os.path.join(RAIZ, 'segmentacao_rede_v8_sensibilidade.ipynb')
SHAPE_SRE = os.path.join(RAIZ, 'sre-09-2026', 'shape-sres-6aa7eaf5ad9a4.shp')
SAIDA_DB = os.path.join(AQUI, 'dados')
SAIDA_SITE = os.path.join(RAIZ, 'site', 'dados-local')

TOL_GEOM_MAPA = 0.0004      # graus (~40 m): malha inteira no mapa
TOL_GEOM_DETALHE = 0.00003  # graus (~3 m): SRE selecionado, recortado a cada 200 m
CASAS_COORD = 5

# Classes de condicao (limite superior de cada classe; a ultima vai ao infinito).
# IGG: DNIT 006/2003-PRO. IRI: DNIT/IPR-745 (2011). d0: faixas provisorias -- ajustar ao criterio do SGP.
CLASSES = {
    'iri': [('Ótimo', 1.9, '#1a9850'), ('Bom', 2.7, '#66bd63'), ('Regular', 3.5, '#e5c02a'),
            ('Ruim', 4.6, '#e07b24'), ('Péssimo', None, '#d73027')],
    'igg': [('Ótimo', 20, '#1a9850'), ('Bom', 40, '#66bd63'), ('Regular', 80, '#e5c02a'),
            ('Ruim', 160, '#e07b24'), ('Péssimo', None, '#d73027')],
    'd0':  [('Bom', 50, '#66bd63'), ('Regular', 80, '#e5c02a'), ('Ruim', None, '#e07b24')],
}


def log(msg):
    print(f'[{datetime.now():%H:%M:%S}] {msg}', flush=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for bloco in iter(lambda: f.read(1 << 20), b''):
            h.update(bloco)
    return h.hexdigest()


# ── 1. Roda o modelo a partir do proprio notebook (sem copiar codigo) ─────────
def rodar_notebook():
    nb = json.load(open(NOTEBOOK, encoding='utf-8'))
    celulas = {}
    for c in nb['cells']:
        src = ''.join(c['source'])
        m = re.match(r'#\s*─+\s*(\d+)\.', src)
        if c['cell_type'] == 'code' and m:
            celulas[int(m.group(1))] = src
    faltam = [i for i in range(1, 8) if i not in celulas]
    if faltam:
        sys.exit(f'Celulas {faltam} nao encontradas em {NOTEBOOK}')

    tmp = tempfile.mkdtemp(prefix='sgp_export_')
    ns = {'__name__': '__main__'}
    os.chdir(RAIZ)
    for i in range(1, 8):
        src = celulas[i]
        src = '\n'.join(l for l in src.splitlines() if not l.lstrip().startswith(('%', '!')))
        if i == 2:
            alvo = 'os.makedirs(OUTPUT_DIR, exist_ok=True)'
            if alvo not in src:
                sys.exit('Celula 2 mudou: nao achei a criacao de OUTPUT_DIR')
            src = src.replace(alvo, f'OUTPUT_DIR = {tmp!r}; GERAR_GRAFICOS = False')
        t0 = time.time()
        log(f'celula {i} ...')
        exec(compile(src, f'<celula {i}>', 'exec'), ns)
        log(f'celula {i} ok ({time.time() - t0:.0f}s)')
    shutil.rmtree(tmp, ignore_errors=True)
    if ns['SENS_ALVO'] != 'estrutural':
        log("AVISO: SENS_ALVO != 'estrutural'; o site descreve a sensibilidade do beta estrutural")
    return ns


# ── 2. Monta as tabelas ────────────────────────────────────────────────────────
def minusculas(df):
    return df.rename(columns={c: c.lower() for c in df.columns})


def classe_de(valor, param):
    if valor is None or not np.isfinite(valor):
        return 'Sem dado'
    for nome, sup, _ in CLASSES[param]:
        if sup is None or valor <= sup:
            return nome
    return 'Sem dado'


def coords(geom, tol):
    g = geom.simplify(tol, preserve_topology=False) if tol else geom
    if g.is_empty or len(g.coords) < 2:
        g = geom
    return [[round(x, CASAS_COORD), round(y, CASAS_COORD)] for x, y in g.coords]


def montar_tabelas(ns):
    df, grupos, sres = ns['df'], ns['grupos'], ns['sres']
    FATORES, PLOTS, I_REF = ns['FATORES'], ns['PLOTS'], ns['I_REF']

    # intervalos de 200 m (sinais usados pelo modelo; *_obs = medido antes da interpolacao)
    bruto = pd.read_excel(ns['INPUT_FILE'], usecols=lambda c: c in ('sre', 'sre_segmento', 'igg', 'iri_medio'))
    bruto['sre'] = bruto['sre'].astype(str)
    obs = bruto.groupby(['sre', 'sre_segmento']).agg(igg_obs=('igg', lambda s: s.notna().any()),
                                                     iri_obs=('iri_medio', lambda s: s.notna().any())).reset_index()
    itv = df.merge(obs, on=['sre', 'sre_segmento'], how='left', validate='1:1')
    itv['ordem'] = itv.groupby('sre').cumcount()
    intervalo = itv[['sre', 'ordem', 'km_inicial', 'km_final', 'd0', 'igg', 'iri', 'aca',
                     'd0_obs', 'igg_obs', 'iri_obs']].copy()
    for c in ('igg_obs', 'iri_obs'):
        intervalo[c] = intervalo[c].fillna(False).astype(bool)
    for c, n in (('km_inicial', 3), ('km_final', 3), ('d0', 2), ('igg', 2), ('iri', 3), ('aca', 2)):
        intervalo[c] = intervalo[c].round(n)

    # segmentos, cenarios e auditoria por fator (fator 1 = v8)
    segmento = minusculas(ns['df_seg_s'])
    cenario = minusculas(ns['df_info_s'])
    auditoria = minusculas(ns['df_aud_s'])
    crops = minusculas(ns['TAB_CROPS'])

    # sensibilidade por SRE: forma longa (sre, fator, tipo) + faixa estavel do beta
    conc, tol = ns['concordancia'], ns['SENS_TOL_KM']
    linhas = []
    for s in sres:
        ps = PLOTS[s]
        for t in ns['TIPOS']:
            k = ns['CHAVE_KM'][t]
            kr = ps[I_REF][k]
            for i, f in enumerate(FATORES):
                kc = ps[i][k]
                r_, p_ = conc(kr, kc, tol)
                R = r_ / len(kr) if len(kr) else 1.0
                P = p_ / len(kc) if len(kc) else 1.0
                linhas.append({'sre': s, 'fator': f, 'tipo': t, 'n_segmentos': len(kc) + 1,
                               'quebras_km': [round(float(x), 3) for x in kc],
                               'recall_ref': round(R, 4), 'precisao_ref': round(P, 4),
                               'f1_ref': round(2 * R * P / (R + P), 4) if R + P > 0 else 0.0,
                               'identico_ref': list(kr) == list(kc)})
    sens_fator = pd.DataFrame(linhas)
    cols_sre = ['sre', 'beta_ref', 'K_ref', 'beta_estavel_inf', 'beta_estavel_sup', 'fator_estavel_inf', 'fator_estavel_sup']
    sens_sre = minusculas(ns['SENS_POR_SRE'].reindex(columns=cols_sre + ['tem_d0']))

    sens_rede = ns['SENS_REDE'].copy()
    sens_rede = pd.DataFrame({'fator': sens_rede['fator'],
                              'metricas': [json.loads(r.to_json()) for _, r in sens_rede.drop(columns=['fator']).iterrows()]})
    diag_rede = ns['DIAG_REDE'].round(5)
    calib = ns['CURVA_FUNC'].round(6) if ns['CURVA_FUNC'] is not None else pd.DataFrame(columns=['alpha_km', 'soma_bic', 'quebras_por_km'])

    # SREs: atributos do shape + medias ponderadas por comprimento (so valores medidos) + classes
    g = gpd.read_file(SHAPE_SRE)
    g['sre'] = g['sre'].astype(str)
    comp = (intervalo['km_final'] - intervalo['km_inicial']).clip(lower=0)
    medias = {}
    for p, col, ob in (('iri', 'iri', 'iri_obs'), ('igg', 'igg', 'igg_obs'), ('d0', 'd0', 'd0_obs')):
        w = comp.where(intervalo[ob], 0.0)
        num = (intervalo[col].fillna(0) * w).groupby(intervalo['sre']).sum()
        den = w.groupby(intervalo['sre']).sum()
        medias[f'{p}_medio'] = (num / den.replace(0, np.nan)).round(3)
    med = pd.DataFrame(medias)
    ref = cenario[cenario['fator'] == 1.0].set_index('sre')

    sre_rows, geom_det = [], {}
    for _, r in g.iterrows():
        geom = r.geometry
        if geom is None or geom.is_empty:
            continue
        # o km cresce do ponto inicial para o final do SRE
        p0, pn = geom.coords[0], geom.coords[-1]
        if (pn[0] - r.lon_inicia) ** 2 + (pn[1] - r.lat_inicia) ** 2 < (p0[0] - r.lon_inicia) ** 2 + (p0[1] - r.lat_inicia) ** 2:
            geom = type(geom)(list(geom.coords)[::-1])
        s = r.sre
        m = med.loc[s] if s in med.index else pd.Series(dtype=float)
        c = ref.loc[s] if s in ref.index else None
        row = {
            'sre': s, 'rodovia': r.go, 'classe_via': r.classe, 'inicio': r.inicio, 'fim': r.fim,
            'km_inicial': round(float(r.km_inicial), 3), 'km_final': round(float(r.km_final), 3),
            'extensao_km': round(float(r.extensao), 3), 'situacao': r.situacao, 'jurisdicao': r.jurisdicao,
            'regional': int(r.regional) if pd.notna(r.regional) else None, 'trecho': r.trecho,
            'perimetro_urbano': r.perim_urb == 's', 'federal': r.federal if isinstance(r.federal, str) else None,
            'tem_dados': s in grupos,
            'n_intervalos': int(len(grupos[s]['ini'])) if s in grupos else 0,
            'iri_medio': m.get('iri_medio'), 'igg_medio': m.get('igg_medio'), 'd0_medio': m.get('d0_medio'),
            'n_seg_funcional': int(c['quebras_func']) + 1 if c is not None else None,
            'n_seg_estrutural': int(c['quebras_estrut']) + 1 if c is not None else None,
            'n_seg_combinada': int(c['quebras_comb']) + 1 if c is not None else None,
            'beta_estrut': c['beta_estrut'] if c is not None else None,
            'geom_mapa': coords(geom, TOL_GEOM_MAPA),
        }
        for p in ('iri', 'igg', 'd0'):
            row[f'classe_{p}'] = classe_de(row[f'{p}_medio'], p)
        sre_rows.append(row)
        geom_det[s] = coords(geom, TOL_GEOM_DETALHE)
    sre = pd.DataFrame(sre_rows).replace({np.nan: None})
    sre['geom_detalhe'] = sre['sre'].map(geom_det)

    # km por classe na malha (regional 0) e por regional, com intervalos de 200 m
    reg = sre.set_index('sre')['regional']
    resumo = []
    base = intervalo.assign(comp=comp, regional=intervalo['sre'].map(reg))
    for p, col, ob in (('iri', 'iri', 'iri_obs'), ('igg', 'igg', 'igg_obs'), ('d0', 'd0', 'd0_obs')):
        cls = [classe_de(v, p) if o else 'Sem dado' for v, o in zip(base[col], base[ob])]
        b = base.assign(classe=cls)
        for regional, sub in [(0, b)] + list(b.groupby('regional')):
            for k, v in sub.groupby('classe')['comp'].sum().items():
                resumo.append({'parametro': p, 'regional': int(regional), 'classe': k, 'km': round(float(v), 3)})
    resumo_classes = pd.DataFrame(resumo)

    classe_limite = pd.DataFrame([{'parametro': p, 'ordem': i, 'classe': n, 'limite_sup': sup, 'cor': cor}
                                  for p, lst in CLASSES.items() for i, (n, sup, cor) in enumerate(lst)]
                                 + [{'parametro': p, 'ordem': len(CLASSES[p]), 'classe': 'Sem dado', 'limite_sup': None,
                                     'cor': '#9e9e9e'} for p in CLASSES])

    parametros = pd.DataFrame([
        {'parametro': k, 'valor': str(v)} for k, v in [
            ('INPUT_FILE', ns['INPUT_FILE']), ('SENS_ALVO', ns['SENS_ALVO']),
            ('SENS_FATORES', ', '.join(f'{f:g}' for f in FATORES)),
            ('beta de referencia (fator 1)', round(ns['PEN_REF'], 6)), ('SENS_TOL_KM', ns['SENS_TOL_KM']),
            ('MODEL_FUNC', ns['MODEL_FUNC']), ('MODEL_ESTRUT', f"{ns['MODEL_ESTRUT']} sobre d0 bruto (Biswas & Kuna, 2022)"),
            ('MODO_PENALIDADE', ns['MODO_PENALIDADE']), ('BETA_REDE', round(ns['BETA_REDE'], 4)),
            ('BETA_COTOVELO_REDE', round(ns['BETA_COTOVELO_REDE'], 4)), ('BETA_BIC_3lnN', round(ns['BETA_BIC'], 4)),
            ('BETA_MIN_EF', round(ns['BETA_MIN_EF'], 4)), ('ALPHA_KM_FUNC_OPT', round(ns['ALPHA_KM_FUNC_OPT'], 6)),
            ('MARGEM_PEN / N_CAND_PEN', f"{ns['MARGEM_PEN']} / {ns['N_CAND_PEN']}"),
            ('MIN_SIZE / JUMP', f"{ns['MIN_SIZE']} / {ns['JUMP']}"), ('VAR_FLOOR_FRAC', ns['VAR_FLOOR_FRAC']),
            ('FUNDIR_FUNC / ESTRUT / COMB', f"{ns['FUNDIR_FUNC']} / {ns['FUNDIR_ESTRUT']} / {ns['FUNDIR_COMB']}"),
            ('ALPHA_TESTE', ns['ALPHA_TESTE']), ('BUFFER_KM / MIN_COMP_COMB_KM', f"{ns['BUFFER_KM']} / {ns['MIN_COMP_COMB_KM']}"),
            ('CV_LIMITE', ns['CV_LIMITE']),
        ]])

    entrada = os.path.join(RAIZ, ns['INPUT_FILE'])
    meta = {
        'gerado_em': datetime.now().isoformat(timespec='seconds'),
        'notebook': os.path.basename(NOTEBOOK), 'notebook_sha256': sha256(NOTEBOOK),
        'entrada': ns['INPUT_FILE'], 'entrada_sha256': sha256(entrada),
        'shape_sre': os.path.basename(SHAPE_SRE),
        'fatores': FATORES, 'fator_referencia': 1.0,
        'beta_rede': round(ns['BETA_REDE'], 4), 'beta_min': round(ns['BETA_MIN_EF'], 4),
        'beta_bic': round(ns['BETA_BIC'], 4), 'alpha_km_func': round(ns['ALPHA_KM_FUNC_OPT'], 6),
        'min_size': ns['MIN_SIZE'], 'cv_limite': ns['CV_LIMITE'], 'sens_tol_km': ns['SENS_TOL_KM'],
        'n_sres': len(sres), 'n_intervalos': int(len(intervalo)),
    }
    meta_df = pd.DataFrame([{'chave': k, 'valor': json.dumps(v)} for k, v in meta.items()])

    return {
        'sre': sre, 'intervalo': intervalo, 'segmento': segmento, 'cenario': cenario, 'auditoria': auditoria,
        'crops': crops, 'sens_fator': sens_fator, 'sens_sre': sens_sre, 'sens_rede': sens_rede,
        'diag_rede': diag_rede, 'calib_func': calib, 'resumo_classes': resumo_classes,
        'classe_limite': classe_limite, 'parametro': parametros, 'meta': meta_df,
    }, meta


# ── 3. Gravacao ───────────────────────────────────────────────────────────────
def limpar(v):
    """NaN/inf -> None e tipos numpy -> python, recursivo (para JSON)."""
    if isinstance(v, dict):
        return {k: limpar(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, np.ndarray)):
        return [limpar(x) for x in v]
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        return float(v) if np.isfinite(v) else None
    return v


def registros(df, sem=()):
    return [limpar({k: v for k, v in r.items() if k not in sem}) for r in df.to_dict('records')]


COLS_JSON = {'sre': ('geom_mapa', 'geom_detalhe'), 'sens_fator': ('quebras_km',), 'sens_rede': ('metricas',)}

# mesma ordem do ORDER BY das funcoes dados_rede()/dados_sre() (migracao *_api.sql)
ORDEM = {'sre': ['sre'], 'intervalo': ['sre', 'ordem'], 'segmento': ['sre', 'fator', 'tipo', 'seg_id'],
         'cenario': ['sre', 'fator'], 'auditoria': ['sre', 'fator'], 'crops': ['sre', 'k_quebras'],
         'sens_fator': ['sre', 'fator', 'tipo'], 'sens_rede': ['fator'], 'diag_rede': ['beta'],
         'calib_func': ['alpha_km'], 'resumo_classes': ['parametro', 'regional', 'classe'],
         'classe_limite': ['parametro', 'ordem'], 'parametro': ['parametro']}


def gravar_banco(tabs, meta):
    if os.path.isdir(SAIDA_DB):
        shutil.rmtree(SAIDA_DB)
    os.makedirs(SAIDA_DB)
    for nome, t in tabs.items():
        t2 = t.copy()
        for c in COLS_JSON.get(nome, ()):   # listas/dicts vao como texto JSON (jsonb no banco)
            t2[c] = t2[c].map(lambda v: json.dumps(limpar(v), ensure_ascii=False) if isinstance(v, (list, dict)) else None)
        t2.to_parquet(os.path.join(SAIDA_DB, f'{nome}.parquet'), index=False)
    with open(os.path.join(SAIDA_DB, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(limpar(meta), f, ensure_ascii=False, indent=1)
    log(f'banco: {len(tabs)} tabelas em {SAIDA_DB}')


def ler_banco():
    tabs = {}
    for f in os.listdir(SAIDA_DB):
        if f.endswith('.parquet'):
            nome = f[:-8]
            t = pd.read_parquet(os.path.join(SAIDA_DB, f))
            for c in COLS_JSON.get(nome, ()):
                t[c] = t[c].map(lambda v: json.loads(v) if isinstance(v, str) else None)
            tabs[nome] = t
    return tabs, json.load(open(os.path.join(SAIDA_DB, 'meta.json'), encoding='utf-8'))


def gravar_site(tabs, meta):
    """site/dados-local/: mesmo conteudo e ordem de dados_rede() e dados_sre()."""
    tabs = {k: (t.sort_values(ORDEM[k], kind='stable').reset_index(drop=True) if k in ORDEM else t) for k, t in tabs.items()}
    if os.path.isdir(SAIDA_SITE):
        shutil.rmtree(SAIDA_SITE)
    os.makedirs(os.path.join(SAIDA_SITE, 'sre'))
    rede = {
        'meta': limpar(meta),
        'sres': registros(tabs['sre'], sem=('geom_detalhe',)),
        'resumo_classes': registros(tabs['resumo_classes']),
        'classe_limite': registros(tabs['classe_limite']),
        'sens_rede': registros(tabs['sens_rede']),
        'diag_rede': registros(tabs['diag_rede']),
        'calib_func': registros(tabs['calib_func']),
        'parametros': registros(tabs['parametro']),
    }
    with open(os.path.join(SAIDA_SITE, 'rede.json'), 'w', encoding='utf-8') as f:
        json.dump(rede, f, ensure_ascii=False, separators=(',', ':'))
    por = {k: dict(tuple(tabs[k].groupby('sre', sort=False))) for k in
           ('intervalo', 'segmento', 'cenario', 'auditoria', 'crops', 'sens_fator')}
    sens_sre = tabs['sens_sre'].set_index('sre')
    vazio = pd.DataFrame()
    for _, r in tabs['sre'].iterrows():
        s = r['sre']
        pac = {'sre': limpar({k: v for k, v in r.items() if k != 'geom_mapa'})}
        for chave, tab in (('intervalos', 'intervalo'), ('segmentos', 'segmento'), ('cenarios', 'cenario'),
                           ('auditoria', 'auditoria'), ('crops', 'crops'), ('sens_fator', 'sens_fator')):
            pac[chave] = registros(por[tab].get(s, vazio), sem=('sre',))
        pac['sens_sre'] = limpar(sens_sre.loc[s].to_dict()) if s in sens_sre.index else None
        with open(os.path.join(SAIDA_SITE, 'sre', f'{s}.json'), 'w', encoding='utf-8') as f:
            json.dump(pac, f, ensure_ascii=False, separators=(',', ':'))
    log(f'site local: {len(tabs["sre"])} SREs em {SAIDA_SITE}')


if __name__ == '__main__':
    t0 = time.time()
    if '--so-site' in sys.argv:   # regrava site/dados-local/ a partir de supabase/dados/, sem rodar o modelo
        gravar_site(*ler_banco())
    else:
        ns = rodar_notebook()
        tabs, meta = montar_tabelas(ns)
        for k, t in tabs.items():
            log(f'  {k:15s} {len(t):>8d} linhas')
        gravar_banco(tabs, meta)
        gravar_site(tabs, meta)
    log(f'concluido em {time.time() - t0:.0f}s')
