"""Monta o dataset novo a partir de sre_seg_200m_07_corrigida.xlsx + analitica_segmentos_200m_16-09-2026.csv.

Problema da analitica: o CSV (Metabase) perdeu o separador decimal em numeros com >= 3 casas decimais
(o "." foi lido como separador de milhar). Ex.: 2.24252999999999 virou "224.252.999.999.999".
Os digitos estao corretos; so a posicao da virgula se perdeu. Ela e recuperada escolhendo, entre as
potencias de 10 candidatas, a mais coerente com (a) o valor da mesma celula (sre, km_inicial, km_final)
no xlsx, (b) os intervalos vizinhos da propria analitica e (c) a frequencia de cada posicao por
quantidade de digitos (a posicao tem padrao: iri quase sempre 1 digito inteiro, d0 quase sempre 2).

Uso:  python montar_dataset_analitica.py
"""
import os, re, sys, json, hashlib
from datetime import datetime
import numpy as np
import pandas as pd

AQUI = os.path.dirname(os.path.abspath(__file__))
CSV_ANALITICA = os.path.join(AQUI, 'analitica_segmentos_200m_16-09-2026.csv')
XLSX_BASE = os.path.join(AQUI, 'sre_seg_200m_07_corrigida.xlsx')
CACHE_XLSX = os.path.join(AQUI, '.cache_sre_seg_200m_07_corrigida.parquet')
SAIDA_XLSX = os.path.join(AQUI, 'sre_seg_200m_08_analitica.xlsx')
SAIDA_AUDIT = os.path.join(AQUI, 'auditoria_correcao_analitica.csv')
SAIDA_PARQUET = os.path.join(AQUI, 'sre_seg_200m_08_analitica.parquet')
SAIDA_META = os.path.join(AQUI, 'sre_seg_200m_08_analitica.json')   # rastreabilidade: hash das fontes e das saidas

COLS_VALOR = ['iri_medio', 'igg', 'atr', 'd0']                       # presentes nos dois datasets
COLS_EXTRA = ['d20', 'd30', 'd45', 'd60', 'd90', 'd120', 'fc_2', 'fc_3']   # so no xlsx
COLS_TEXTO = ['rodovia', 'trecho', 'situacao', 'jurisdicao', 'principal']  # so na analitica
FAIXA_PLAUSIVEL = {'iri_medio': (0.05, 60), 'igg': (0.05, 600), 'atr': (0.05, 600), 'd0': (5, 1500)}
JANELA_VIZ = 3          # intervalos vizinhos de cada lado
P_INCERTO = 0.90        # probabilidade abaixo da qual a correcao e marcada como incerta
PADRAO_MILHAR = re.compile(r'\d{1,3}(\.\d{3})+')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for bloco in iter(lambda: f.read(1 << 20), b''):
            h.update(bloco)
    return h.hexdigest()


def ler_xlsx():
    if os.path.exists(CACHE_XLSX) and os.path.getmtime(CACHE_XLSX) >= os.path.getmtime(XLSX_BASE):
        return pd.read_parquet(CACHE_XLSX)
    usecols = ['sre', 'sre_segmento', 'km_inicial', 'km_final', 'sentido', 'faixa'] + COLS_VALOR + COLS_EXTRA
    x = pd.read_excel(XLSX_BASE, usecols=usecols)
    x.to_parquet(CACHE_XLSX, index=False)
    return x


def chave(df, ci='km_inicial', cf='km_final'):
    df['ki'] = df[ci].astype(float).round(3)
    df['kf'] = df[cf].astype(float).round(3)
    return df


def vizinhos_mediana(df, valores):
    """Mediana dos +-JANELA_VIZ intervalos vizinhos (mesmo SRE, ordenados por km), excluindo o proprio."""
    out = np.full(len(df), np.nan)
    pos = df.groupby('sre').indices
    v = np.asarray(valores, float)
    for _, idx in pos.items():
        idx = idx[np.argsort(df['ki'].to_numpy()[idx])]
        vv = v[idx]
        for j in range(len(idx)):
            w = np.r_[vv[max(0, j - JANELA_VIZ):j], vv[j + 1:j + 1 + JANELA_VIZ]]
            w = w[np.isfinite(w) & (w > 0)]
            if len(w):
                out[idx[j]] = np.median(w)
    return out


def sigma_robusto(a, b):
    ok = np.isfinite(a) & np.isfinite(b) & (a > 0) & (b > 0)
    d = np.log10(a[ok] / b[ok])
    return max(1.4826 * np.median(np.abs(d - np.median(d))), 0.05)


def reparar_coluna(m, col):
    """m: DataFrame com a coluna `col` (texto), refmax/refmean (xlsx). Devolve (valores, corrigido, prob)."""
    lo, hi = FAIXA_PLAUSIVEL[col]
    s = m[col]
    mang = (s.notna() & s.str.fullmatch(PADRAO_MILHAR, na=False)).to_numpy()
    limpo = pd.to_numeric(s.where(~mang), errors='coerce').to_numpy()   # "45.5", "88.16": ja corretos
    ref_x = m['refmax'].fillna(m['refmean']).to_numpy(float)
    ref_x = np.where(ref_x > 0, ref_x, np.nan)
    # sigmas (em dex) estimados nas celulas ja limpas
    sd_x = sigma_robusto(limpo, ref_x)
    sd_n = sigma_robusto(limpo, vizinhos_mediana(m, limpo))
    viz = vizinhos_mediana(m, limpo)

    def candidatos(i):
        D = s.iat[i].replace('.', '')
        n, v = len(D), int(D)
        return [(n - k, v / 10 ** k) for k in range(0, n + 1) if v > 0 and lo <= v / 10 ** k <= hi]

    def pontuar(i, cands, prior, viz_i):
        sc = []
        for ni, val in cands:
            ll = np.log(prior.get((len(s.iat[i].replace('.', '')), ni), 0) + 1.0)
            if np.isfinite(ref_x[i]):
                ll -= np.log1p((np.log10(val / ref_x[i]) / sd_x) ** 2)
            if np.isfinite(viz_i):
                ll -= np.log1p((np.log10(val / viz_i) / sd_n) ** 2)
            sc.append(ll)
        return np.array(sc)

    idxs = np.flatnonzero(mang)
    out = limpo.copy(); prob = np.ones(len(m))
    zero = [i for i in idxs if int(s.iat[i].replace('.', '')) == 0]
    for i in zero:
        out[i] = 0.0
    idxs = [i for i in idxs if i not in set(zero)]
    prior = {}
    for passo in (1, 2):                     # 1: sem prior; 2: prior de (n digitos, n inteiros) dos casos confiantes
        escolha, probs = {}, {}
        for i in idxs:
            c = candidatos(i)
            if not c:
                continue
            sc = pontuar(i, c, prior, viz[i] if np.isfinite(viz[i]) else np.nan)
            p = np.exp(sc - sc.max()); p /= p.sum()
            j = int(np.argmax(p)); escolha[i] = c[j]; probs[i] = float(p[j])
        for i, (ni, val) in escolha.items():
            out[i] = val; prob[i] = probs[i]
        if passo == 1:
            for i, (ni, val) in escolha.items():
                if probs[i] > 0.97:
                    k = (len(s.iat[i].replace('.', '')), ni)
                    prior[k] = prior.get(k, 0) + 1
        # vizinhos para o passo 2: usa valores ja corrigidos (so confiantes)
        viz = vizinhos_mediana(m, np.where(np.isnan(limpo) & (prob > 0.97) & mang, out, limpo))
    return out, mang, prob


def main():
    print('Lendo analitica...')
    c = pd.read_csv(CSV_ANALITICA, sep=';', dtype=str, encoding='utf-8')
    chave(c)
    print('Lendo xlsx base (cache se existir)...')
    x = chave(ler_xlsx())

    # referencia por celula no xlsx: max entre sentido/faixa (a analitica parece guardar o pior caso)
    g = x.groupby(['sre', 'ki', 'kf'])
    ref = {col: pd.DataFrame({'refmax': g[col].max(), 'refmean': g[col].mean()}).reset_index() for col in COLS_VALOR}

    resumo, audit = [], []
    for col in COLS_VALOR:
        m = c[['sre', 'ki', 'kf', col]].merge(ref[col], on=['sre', 'ki', 'kf'], how='left')
        assert len(m) == len(c)
        val, mang, prob = reparar_coluna(m, col)
        c[col + '_orig'] = c[col]
        c[col] = val
        c[col + '_corrigido'] = mang
        c[col + '_p'] = prob
        inc = mang & (prob < P_INCERTO)
        resumo.append((col, int(c[col + '_orig'].notna().sum()), int(mang.sum()), int(inc.sum())))
        a = c.loc[inc, ['sre', 'sre_segmento', 'km_inicial', 'km_final', col + '_orig', col, col + '_p']].copy()
        a.columns = ['sre', 'sre_segmento', 'km_inicial', 'km_final', 'texto_original', 'valor_corrigido', 'prob']
        a.insert(0, 'coluna', col)
        a['ref_xlsx_max'] = m.loc[inc, 'refmax'].to_numpy()
        audit.append(a)
    audit = pd.concat(audit)
    audit.to_csv(SAIDA_AUDIT, index=False, sep=';', decimal=',', encoding='utf-8-sig')
    print(pd.DataFrame(resumo, columns=['coluna', 'n_nao_nulos', 'n_corrigidos', 'n_incertos']).to_string(index=False))

    # ---- comparacao com o xlsx nas celulas correspondentes ----
    print('\nComparacao (analitica corrigida x xlsx max entre sentido/faixa), celulas em comum:')
    for col in COLS_VALOR:
        m = c[['sre', 'ki', 'kf', col]].merge(ref[col], on=['sre', 'ki', 'kf'], how='inner')
        both = m[col].notna() & m['refmax'].notna()
        d = m.loc[both, col] - m.loc[both, 'refmax']
        print(f"  {col:9s} comuns={both.sum():6d} iguais={np.isclose(d, 0, atol=1e-6).mean():.3f} "
              f"analitica>xlsx={(d > 1e-6).mean():.3f} analitica<xlsx={(d < -1e-6).mean():.3f} "
              f"| so analitica={int((m[col].notna() & m['refmax'].isna()).sum())} "
              f"| so xlsx (analitica vazia)={int((m[col].isna() & m['refmax'].notna()).sum())}")

    # ---- monta o dataset: analitica (prioridade) + celulas so do xlsx ----
    ex = x.groupby(['sre', 'ki', 'kf'])[COLS_EXTRA + COLS_VALOR].max().reset_index()
    seg = x.groupby(['sre', 'ki', 'kf'])['sre_segmento'].first().reset_index()
    ex = ex.merge(seg, on=['sre', 'ki', 'kf'])
    base = c[['sre', 'sre_segmento', 'ki', 'kf', 'segmento'] + COLS_TEXTO + COLS_VALOR +
             [k + '_corrigido' for k in COLS_VALOR] + [k + '_p' for k in COLS_VALOR]].copy()
    base = base.merge(ex[['sre', 'ki', 'kf'] + COLS_EXTRA], on=['sre', 'ki', 'kf'], how='left')
    base['fonte_valores'] = 'analitica'
    base['preenchido_xlsx'] = ''
    for col in COLS_VALOR:                              # analitica vazia -> completa com o xlsx
        mm = base[['sre', 'ki', 'kf']].merge(ex[['sre', 'ki', 'kf', col]], on=['sre', 'ki', 'kf'], how='left')[col].to_numpy()
        falta = base[col].isna().to_numpy() & np.isfinite(mm)
        base.loc[falta, col] = mm[falta]
        base.loc[falta, 'preenchido_xlsx'] += col + ';'
    so_x = ex.merge(base[['sre', 'ki', 'kf']], on=['sre', 'ki', 'kf'], how='left', indicator=True)
    so_x = so_x[so_x['_merge'] == 'left_only'].drop(columns='_merge')
    so_x['segmento'] = '200m'
    so_x['fonte_valores'] = 'xlsx'
    so_x['preenchido_xlsx'] = ''
    for col in COLS_VALOR:
        so_x[col + '_corrigido'] = False
    novo = pd.concat([base, so_x], ignore_index=True)
    novo['km_inicial'] = novo['ki']; novo['km_final'] = novo['kf']
    novo['corrigidas'] = novo[[k + '_corrigido' for k in COLS_VALOR]].apply(
        lambda r: ';'.join(k for k in COLS_VALOR if r[k + '_corrigido']), axis=1)
    novo['correcao_incerta'] = (novo[[k + '_p' for k in COLS_VALOR]].fillna(1).min(axis=1) < P_INCERTO) & (novo['corrigidas'] != '')
    ordem = (['sre', 'sre_segmento'] + COLS_TEXTO + ['km_inicial', 'km_final', 'segmento'] + COLS_VALOR + COLS_EXTRA +
             ['fonte_valores', 'preenchido_xlsx', 'corrigidas', 'correcao_incerta'])
    novo = novo[ordem].sort_values(['sre', 'km_inicial']).reset_index(drop=True)
    print(f"\nDataset novo: {len(novo)} linhas, {novo['sre'].nunique()} SREs | "
          f"fonte analitica={int((novo.fonte_valores == 'analitica').sum())} xlsx={int((novo.fonte_valores == 'xlsx').sum())}")
    print('nao nulos:', {k: int(novo[k].notna().sum()) for k in COLS_VALOR})
    print('linhas com correcao incerta:', int(novo['correcao_incerta'].sum()))
    novo.to_excel(SAIDA_XLSX, index=False)
    novo.to_parquet(SAIDA_PARQUET, index=False)
    meta = {'gerado_em': datetime.now().isoformat(timespec='seconds'), 'script': os.path.basename(__file__),
            'fontes': {os.path.basename(p): {'sha256': sha256(p), 'bytes': os.path.getsize(p),
                                             'modificada_em': datetime.fromtimestamp(os.path.getmtime(p)).isoformat(timespec='seconds')}
                       for p in (CSV_ANALITICA, XLSX_BASE)},
            'linhas': int(len(novo)), 'sres': int(novo['sre'].nunique()),
            'linhas_por_fonte': novo['fonte_valores'].value_counts().to_dict(),
            'valores_corrigidos': {k: int(v) for k, _, v, _ in resumo}, 'correcoes_incertas': int(novo['correcao_incerta'].sum()),
            'saidas': {os.path.basename(p): sha256(p) for p in (SAIDA_XLSX, SAIDA_PARQUET, SAIDA_AUDIT)}}
    json.dump(meta, open(SAIDA_META, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print('Salvo:', SAIDA_XLSX, SAIDA_PARQUET, SAIDA_META, '| auditoria:', SAIDA_AUDIT)


if __name__ == '__main__':
    main()
