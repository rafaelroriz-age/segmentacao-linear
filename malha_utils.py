"""Utilidades para segmentação da malha completa.

- Agrega por sre_segmento (média de d0 e iri_medio entre sentido/faixa)
- Usa km_inicial/km_final reais da tabela (não acumulação sintética)
- Ward 1D com conectividade ESPARSA (seguro para GOs grandes)
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.sparse import diags
from sklearn.cluster import AgglomerativeClustering

from segmentacao_homogenea_sgp_v2 import (
    _preparar_segmentos_intervalares,
    construir_features,
    padronizar,
    FEATURES_ARTIGO,
)


def carregar_agregado(path: str) -> pd.DataFrame:
    """Lê o Excel, agrega por sre_segmento (média) usando km reais da tabela."""
    df = pd.read_excel(path)
    for c in ["d0", "iri_medio", "km_inicial", "km_final"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df["seg_num"] = pd.to_numeric(
        df["sre_segmento"].astype(str).str.split("-").str[-1], errors="coerce"
    )
    # Primeiros 6 caracteres: 3 de GO + 3 de eixo (EGO, UGO, AGO, CGO…)
    # Cada GO×eixo é processado independentemente.
    df["go"] = df["sre"].astype(str).str[:6]

    # Média entre sentido/faixa de cada sre_segmento; km real da tabela
    agg = (
        df.groupby(["go", "sre", "sre_segmento", "seg_num"], as_index=False)
        .agg(
            d0=("d0", "mean"),
            iri_medio=("iri_medio", "mean"),
            km_inicial=("km_inicial", "min"),
            km_final=("km_final", "max"),
        )
    )

    # Ordena dentro de cada GO×eixo por km real
    agg = agg.sort_values(["go", "km_inicial"]).reset_index(drop=True)

    # Preserva os valores ORIGINAIS (com NaN) para a saída — 0 é dado válido,
    # ausência de dado deve aparecer como '-', nunca como 0.
    agg["d0_orig"] = agg["d0"]
    agg["iri_orig"] = agg["iri_medio"]

    # Versões PREENCHIDAS (interpolação + mediana) usadas apenas no clustering
    for c in ["d0", "iri_medio"]:
        agg[c] = agg.groupby("go")[c].transform(
            lambda s: s.interpolate(limit_direction="both")
        )
    # GOs inteiramente NaN -> preenche com mediana global (só para clustering)
    for c in ["d0", "iri_medio"]:
        agg[c] = agg[c].fillna(agg[c].median())

    return agg


def pelt_jump(X_scaled, model: str = "l2", min_size: int = 3, pen: float = 8, jump: int = 5):
    """PELT com `jump` configurável (rápido para GOs grandes).

    jump>1 acelera drasticamente o PELT (grade de candidatos a cada `jump` pontos),
    mantendo a metodologia change-point. Retorna (labels, breakpoints).
    """
    import ruptures as rpt

    algo = rpt.Pelt(model=model, min_size=min_size, jump=jump).fit(X_scaled)
    bkps = algo.predict(pen=pen)
    labels = np.zeros(len(X_scaled), dtype=int)
    prev = 0
    for seg_num, bp in enumerate(bkps):
        labels[prev:bp] = seg_num
        prev = bp
    return labels, bkps


def connectivity_1d_sparse(n: int):
    """Conectividade 1D esparsa (vizinhos imediatos)."""
    return diags([1, 1], [-1, 1], shape=(n, n))


def ward1d_sparse(X_scaled, k: int):
    """Ward 1D com conectividade esparsa (memória segura para GOs grandes)."""
    n = len(X_scaled)
    k_eff = max(2, min(k, n - 1))
    conn = connectivity_1d_sparse(n)
    agg = AgglomerativeClustering(n_clusters=k_eff, linkage="ward", connectivity=conn)
    labels = agg.fit_predict(X_scaled)
    return labels


def preparar_go(g_go: pd.DataFrame, features=None):
    """Constrói seg enriquecido + X_scaled (base d0) para uma GO.

    Anexa também `sre` e `sre_segmento` (via km_inicial) para rastrear cada ponto.
    """
    if features is None:
        features = FEATURES_ARTIGO
    seg = _preparar_segmentos_intervalares(
        g_go, col_km_ini="km_inicial", col_km_fim="km_final",
        col_iri="iri_medio", col_def="d0",
    )
    seg_e, X_df, vars_ok = construir_features(seg, vars_clustering=features)
    X_scaled, _ = padronizar(X_df.values)

    # Rastreabilidade: mapeia km_inicial -> sre / sre_segmento / valores originais
    cols_map = [c for c in ["km_inicial", "sre", "sre_segmento", "d0_orig", "iri_orig"] if c in g_go.columns]
    if "km_inicial" in cols_map and "km_ini_km" in seg_e.columns:
        mapa = g_go[cols_map].drop_duplicates("km_inicial")
        seg_e = seg_e.merge(mapa, left_on="km_ini_km", right_on="km_inicial", how="left")

    return seg_e, X_scaled, vars_ok
