"""
Pipeline de Segmentação Homogênea — Etapa 4
Avaliação intrínseca e extrínseca dos clusters.

Métricas intrínsecas: Silhouette, Calinski-Harabász, Davies-Bouldin.
Avaliação extrínseca: XGBoost como classificador de cluster (explicabilidade).
Variância intra-segmento e tabela comparativa de todos os métodos.

Referência: Mukhtarli (2020) — framework de avaliação com ML.
"""

import numpy as np
import pandas as pd
from sklearn.metrics import (
    silhouette_score, calinski_harabasz_score,
    davies_bouldin_score, adjusted_rand_score
)


# ── Avaliação Intrínseca ──────────────────────────────────────────────────────

def avaliar_intrinseco(X_scaled, labels):
    """
    Métricas que não precisam de rótulo externo.
    - Silhouette [-1, 1]: quanto maior, clusters mais compactos e separados.
    - Calinski-Harabász: razão variância entre/dentro clusters. Quanto maior, melhor.
    - Davies-Bouldin: média das similaridades entre clusters. Quanto menor, melhor.
    """
    mask = labels >= 0  # exclui outliers do HDBSCAN/DBSCAN
    n_valid = mask.sum()
    unique_labels = set(labels[mask])

    if n_valid < 2 or len(unique_labels) < 2:
        return None

    try:
        return {
            'n_clusters': len(unique_labels),
            'silhouette': silhouette_score(X_scaled[mask], labels[mask]),
            'calinski': calinski_harabasz_score(X_scaled[mask], labels[mask]),
            'davies_bouldin': davies_bouldin_score(X_scaled[mask], labels[mask]),
            'n_outliers': int((labels < 0).sum()),
        }
    except Exception:
        return None


# ── Avaliação Extrínseca: XGBoost como classificador ─────────────────────────

def avaliar_extrinseco_xgb(X_scaled, labels):
    """
    Treina XGBoost para prever o cluster a partir das features originais.
    Quanto maior a accuracy, mais 'explicável' é a partição pelas features.
    Referência: Mukhtarli (2020) — logistic regression e neural networks.
    """
    try:
        from xgboost import XGBClassifier
    except ImportError:
        return {'xgb_accuracy_cv': None, 'xgb_accuracy_std': None}
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import LabelEncoder

    mask = labels >= 0
    X_ok = X_scaled[mask]
    y = LabelEncoder().fit_transform(labels[mask])

    n_classes = len(set(y))
    if n_classes < 2 or len(y) < 10:
        return {'xgb_accuracy_cv': None, 'xgb_accuracy_std': None}

    # Com muitos segmentos lineares, alguns clusters têm poucas amostras.
    # Filtrar classes com pelo menos 2 amostras para viabilizar CV.
    from collections import Counter
    counts = Counter(y)
    valid_classes = {c for c, cnt in counts.items() if cnt >= 2}
    if len(valid_classes) < 2:
        return {'xgb_accuracy_cv': None, 'xgb_accuracy_std': None}

    keep = np.array([yi in valid_classes for yi in y])
    X_ok = X_ok[keep]
    y = LabelEncoder().fit_transform(y[keep])

    n_cv = min(5, len(set(y)), min(Counter(y).values()))
    if n_cv < 2:
        n_cv = 2

    clf = XGBClassifier(
        n_estimators=100, max_depth=4,
        use_label_encoder=False,
        eval_metric='mlogloss', random_state=42,
        verbosity=0
    )
    try:
        scores = cross_val_score(clf, X_ok, y, cv=n_cv, scoring='accuracy')
        return {
            'xgb_accuracy_cv': scores.mean(),
            'xgb_accuracy_std': scores.std()
        }
    except Exception:
        return {'xgb_accuracy_cv': None, 'xgb_accuracy_std': None}


# ── Variância Intra-segmento ─────────────────────────────────────────────────

def variancia_intra(X_scaled, labels):
    """Desvio padrão médio dentro de cada cluster."""
    stds = []
    for lbl in set(labels):
        if lbl < 0:
            continue
        mask = labels == lbl
        if mask.sum() > 1:
            stds.append(X_scaled[mask].std(axis=0).mean())
    return np.mean(stds) if stds else None


# ── ARI entre dois métodos ────────────────────────────────────────────────────

def comparar_ari(labels_a, labels_b):
    """Adjusted Rand Index para comparar duas partições."""
    mask = (labels_a >= 0) & (labels_b >= 0)
    if mask.sum() < 2:
        return None
    return adjusted_rand_score(labels_a[mask], labels_b[mask])


# ── Tabela comparativa de todos os métodos ────────────────────────────────────

def tabela_comparativa(resultados):
    """
    Parâmetros
    ----------
    resultados : dict {nome_metodo: {'labels': array, 'X_scaled': array}}

    Retorna
    -------
    DataFrame com todas as métricas por método, ordenado por silhouette.
    """
    rows = []
    for nome, res in resultados.items():
        metricas = avaliar_intrinseco(res['X_scaled'], res['labels'])
        if metricas is None:
            continue

        extr = avaliar_extrinseco_xgb(res['X_scaled'], res['labels'])
        std_intra = variancia_intra(res['X_scaled'], res['labels'])

        row = {
            'Método': nome,
            **metricas,
            'XGB_Accuracy_CV': extr.get('xgb_accuracy_cv'),
            'Std_Intra': round(std_intra, 4) if std_intra is not None else None,
        }
        rows.append(row)

    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values('silhouette', ascending=False)


# ── Perfil de clusters ───────────────────────────────────────────────────────

def perfil_clusters(seg120, col_cluster, features):
    """
    Calcula média e desvio padrão de cada feature por cluster.
    Retorna DataFrame formatado para relatório.
    """
    cols_existem = [f for f in features if f in seg120.columns]
    if not cols_existem:
        return pd.DataFrame()

    grupo = seg120.groupby(col_cluster)[cols_existem]
    media = grupo.mean().round(3)
    std = grupo.std().round(3)

    perfil = media.copy()
    for c in cols_existem:
        perfil[c] = media[c].astype(str) + ' ± ' + std[c].astype(str)
    perfil.insert(0, 'n_segmentos', grupo.size())
    return perfil


# ── Interpretação automática ──────────────────────────────────────────────────

def interpretar_resultado(nome_metodo, metricas, perfil_df=None):
    """
    Gera texto de interpretação para o relatório.
    """
    sil = metricas.get('silhouette', 0)
    n_k = metricas.get('n_clusters', 0)
    acc = metricas.get('XGB_Accuracy_CV')

    if sil > 0.5:
        qualidade = "excelente"
    elif sil > 0.3:
        qualidade = "boa"
    elif sil > 0.1:
        qualidade = "moderada"
    else:
        qualidade = "fraca"

    if acc and acc > 0.85:
        explicabilidade = "alta"
    elif acc and acc > 0.6:
        explicabilidade = "moderada"
    else:
        explicabilidade = "baixa"

    texto = (
        f"**{nome_metodo}** identificou **{n_k} grupos** com qualidade de separação "
        f"{qualidade} (Silhouette = {sil:.3f}). "
    )
    if acc is not None:
        texto += (
            f"A explicabilidade dos grupos por XGBoost foi {explicabilidade} "
            f"(Accuracy CV = {acc:.2f}). "
        )

    if perfil_df is not None and not perfil_df.empty:
        texto += "\n\nPerfil dos grupos:\n\n" + perfil_df.to_markdown()

    return texto
