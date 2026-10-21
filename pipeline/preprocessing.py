"""
Pipeline de Segmentação Homogênea — leitura da tabela segmentada e engenharia de features.

Formato de entrada esperado:
- km_inicial
- km_final
- iri_medio
- d0
"""

import pandas as pd
import numpy as np


def _serie_numerica(valores):
    serie = pd.Series(pd.to_numeric(valores, errors='coerce'))
    if serie.notna().any():
        return serie.interpolate(limit_direction='both')
    return serie.fillna(0.0)


def _enriquecer_segmentos(seg):
    """Cria features locais para manter o pipeline compatível e incluir IRI."""
    base = seg.copy()

    if 'km_centro' not in base.columns:
        if 'km_ini' in base.columns and 'km_fim' in base.columns:
            base['km_centro'] = 0.5 * (base['km_ini'] + base['km_fim'])
        else:
            base['km_centro'] = np.arange(len(base), dtype=float)

    if 'comprimento_m' not in base.columns and {'km_ini', 'km_fim'}.issubset(base.columns):
        base['comprimento_m'] = base['km_fim'] - base['km_ini']

    deflexao = _serie_numerica(base.get('Deflexao', pd.Series(dtype=float)))
    iri = _serie_numerica(base.get('iri_medio', pd.Series(np.nan, index=base.index)))

    roll3_def = deflexao.rolling(3, center=True, min_periods=1)
    roll5_def = deflexao.rolling(5, center=True, min_periods=1)
    roll3_iri = iri.rolling(3, center=True, min_periods=1)
    roll5_iri = iri.rolling(5, center=True, min_periods=1)

    if 'Deflexao_std' in base.columns:
        base['Deflexao_std'] = pd.to_numeric(base['Deflexao_std'], errors='coerce')
        base['Deflexao_std'] = base['Deflexao_std'].fillna(roll3_def.std().fillna(0.0))
    else:
        base['Deflexao_std'] = roll3_def.std().fillna(0.0)

    if 'Deflexao_max' not in base.columns:
        base['Deflexao_max'] = roll3_def.max().fillna(deflexao)
    if 'Deflexao_min' not in base.columns:
        base['Deflexao_min'] = roll3_def.min().fillna(deflexao)

    base['Deflexao'] = deflexao
    base['Deflexao_caract'] = base['Deflexao'] + base['Deflexao_std']
    base['CV_deflexao'] = base['Deflexao_std'] / base['Deflexao'].replace(0, np.nan)
    base['Deflexao_roll3'] = roll3_def.mean().fillna(deflexao)
    base['Deflexao_roll5'] = roll5_def.mean().fillna(deflexao)
    base['Deflexao_slope'] = np.gradient(deflexao.to_numpy()) if len(base) > 1 else 0.0
    base['Deflexao_range_local'] = base['Deflexao_max'] - base['Deflexao_min']

    if iri.notna().any():
        base['iri_medio'] = iri
        base['iri_std_local'] = roll3_iri.std().fillna(0.0)
        base['iri_roll3'] = roll3_iri.mean().fillna(iri)
        base['iri_roll5'] = roll5_iri.mean().fillna(iri)
        base['iri_max_local'] = roll3_iri.max().fillna(iri)
        base['iri_min_local'] = roll3_iri.min().fillna(iri)
        base['iri_range_local'] = base['iri_max_local'] - base['iri_min_local']
        base['iri_slope'] = np.gradient(iri.to_numpy()) if len(base) > 1 else 0.0
        base['d0_iri_ratio'] = base['Deflexao'] / iri.replace(0, np.nan)
        base['d0_iri_interacao'] = base['Deflexao'] * iri
    else:
        base['iri_medio'] = np.nan
        base['iri_std_local'] = 0.0
        base['iri_roll3'] = 0.0
        base['iri_roll5'] = 0.0
        base['iri_max_local'] = 0.0
        base['iri_min_local'] = 0.0
        base['iri_range_local'] = 0.0
        base['iri_slope'] = 0.0
        base['d0_iri_ratio'] = np.nan
        base['d0_iri_interacao'] = 0.0

    range_pos = base['km_centro'].max() - base['km_centro'].min()
    if range_pos > 0:
        base['posicao_rel'] = (base['km_centro'] - base['km_centro'].min()) / range_pos
    else:
        base['posicao_rel'] = 0.0

    base = base.replace([np.inf, -np.inf], np.nan)
    return base


def _preparar_segmentos_intervalares(df, col_km_ini, col_km_fim, col_iri, col_def):
    """Padroniza uma tabela já segmentada em km_inicial/km_final/iri_medio/d0."""
    base = df.copy()
    for coluna in [col_km_ini, col_km_fim, col_def]:
        base[coluna] = pd.to_numeric(base[coluna], errors='coerce')
    if col_iri and col_iri in base.columns:
        base[col_iri] = pd.to_numeric(base[col_iri], errors='coerce')

    obrigatorias = [col_km_ini, col_km_fim, col_def]
    base = base.dropna(subset=obrigatorias).sort_values(col_km_ini).reset_index(drop=True)

    seg = pd.DataFrame({
        'seg_id': np.arange(1, len(base) + 1),
        'km_ini_km': base[col_km_ini],
        'km_fim_km': base[col_km_fim],
        'km_ini': base[col_km_ini] * 1000.0,
        'km_fim': base[col_km_fim] * 1000.0,
        'km_centro_km': 0.5 * (base[col_km_ini] + base[col_km_fim]),
        'km_centro': 0.5 * (base[col_km_ini] + base[col_km_fim]) * 1000.0,
        'comprimento_m': (base[col_km_fim] - base[col_km_ini]) * 1000.0,
        'Deflexao': base[col_def],
        'iri_medio': base[col_iri] if col_iri and col_iri in base.columns else np.nan,
        'n_pontos': 1,
    })

    for col in base.select_dtypes(include=np.number).columns:
        if col not in {col_km_ini, col_km_fim, col_def, col_iri}:
            seg[f'{col}_med'] = base[col].values

    return _enriquecer_segmentos(seg)


def carregar_dados(filepath):
    """Carrega dados de deflexão a partir de arquivo Excel ou CSV."""
    if hasattr(filepath, 'name'):
        # Streamlit UploadedFile
        nome = filepath.name
    else:
        nome = str(filepath)

    if nome.endswith('.xlsx') or nome.endswith('.xls'):
        df = pd.read_excel(filepath)
    else:
        # Tenta detectar separador automaticamente
        try:
            df = pd.read_csv(filepath, sep=None, engine='python')
        except Exception:
            df = pd.read_csv(filepath)
    return df


def agregar_120m(
    df,
    col_est='Estacao_m',
    col_def='Deflexao',
    passo=40,
    janela=3,
    col_km_ini=None,
    col_km_fim=None,
    col_iri=None,
):
    """
    Padroniza a tabela segmentada de entrada no formato usado pelo pipeline.

    Parâmetros
    ----------
    df : DataFrame com os segmentos de entrada
    col_def : nome da coluna de d0
    col_km_ini : nome da coluna de km inicial
    col_km_fim : nome da coluna de km final
    col_iri : nome da coluna de IRI médio

    Retorna
    -------
    DataFrame de segmentos padronizado com estatísticas descritivas.
    """
    if not (col_km_ini and col_km_fim and col_km_ini in df.columns and col_km_fim in df.columns and col_def in df.columns):
        raise ValueError(
            "A entrada deve conter as colunas km_inicial, km_final e d0 "
            "ou os nomes equivalentes informados na interface."
        )

    return _preparar_segmentos_intervalares(df, col_km_ini, col_km_fim, col_iri, col_def)


def construir_features(seg120, vars_clustering=None):
    """
    Constrói features derivadas para clustering.

    Parâmetros
    ----------
    seg120 : DataFrame de segmentos de 120m
    vars_clustering : lista de colunas a usar. Se None, usa deflexão + extras.

    Retorna
    -------
    seg : DataFrame enriquecido
    X : DataFrame com as features selecionadas para clustering
    vars_ok : lista de nomes das features efetivamente usadas
    """
    seg = _enriquecer_segmentos(seg120)

    if vars_clustering is None:
        if 'iri_medio' in seg.columns and seg['iri_medio'].notna().any():
            vars_clustering = [
                'Deflexao_caract', 'iri_medio', 'CV_deflexao',
                'Deflexao_slope', 'iri_slope', 'd0_iri_ratio',
                'Deflexao_range_local', 'iri_range_local', 'posicao_rel',
            ]
        else:
            vars_clustering = ['Deflexao_caract', 'Deflexao_std', 'CV_deflexao']
        extras = [c for c in seg.columns if c.endswith('_med')]
        vars_clustering.extend(extras)

    # Remover colunas com muitos nulos
    vars_ok = [v for v in vars_clustering if v in seg.columns and seg[v].isnull().mean() < 0.5]
    X = seg[vars_ok].replace([np.inf, -np.inf], np.nan)
    X = X.fillna(X.median(numeric_only=True)).fillna(0.0)

    return seg, X, vars_ok
