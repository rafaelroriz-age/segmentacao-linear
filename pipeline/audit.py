"""
Pipeline de Segmentação Homogênea — Módulo de Auditoria Estatística
Valida se os clusters são estatisticamente significativos e coerentes.

Testes incluídos:
  1. Gap Statistic — número ótimo de clusters
  2. Estabilidade via Bootstrap — robustez dos clusters
  3. ANOVA / Kruskal-Wallis — diferença significativa entre clusters
  4. Teste de normalidade (Shapiro-Wilk) por cluster
  5. Homogeneidade intra-cluster (CV e std relativa)
  6. Concordância entre métodos (ARI cruzado)
  7. Feature Importance via XGBoost
  8. Resumo diagnóstico com parecer final
"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score, adjusted_rand_score
from scipy import stats


# ══════════════════════════════════════════════════════════════════════════════
# 1. GAP STATISTIC
# ══════════════════════════════════════════════════════════════════════════════

def _wk(X, labels):
    """Within-cluster sum of squares."""
    W = 0.0
    for k in set(labels):
        if k < 0:
            continue
        members = X[labels == k]
        if len(members) > 0:
            center = members.mean(axis=0)
            W += ((members - center) ** 2).sum()
    return W


def gap_statistic(X_scaled, max_k=10, n_refs=10, random_state=42):
    """
    Calcula Gap Statistic (Tibshirani et al., 2001).
    Compara W_k observado com W_k de dados aleatórios uniformes.

    Retorna
    -------
    DataFrame com k, Gap, s_k, e indicação do k ótimo.
    """
    from sklearn.cluster import KMeans

    rng = np.random.RandomState(random_state)
    mins = X_scaled.min(axis=0)
    maxs = X_scaled.max(axis=0)

    results = []
    for k in range(2, max_k + 1):
        km = KMeans(n_clusters=k, n_init=10, random_state=random_state)
        labels = km.fit_predict(X_scaled)
        log_wk = np.log(max(_wk(X_scaled, labels), 1e-10))

        ref_log_wks = []
        for _ in range(n_refs):
            X_ref = rng.uniform(mins, maxs, size=X_scaled.shape)
            ref_labels = KMeans(n_clusters=k, n_init=5,
                                random_state=rng.randint(1e6)).fit_predict(X_ref)
            ref_log_wks.append(np.log(max(_wk(X_ref, ref_labels), 1e-10)))

        gap = np.mean(ref_log_wks) - log_wk
        s_k = np.std(ref_log_wks) * np.sqrt(1 + 1.0 / n_refs)
        results.append({'k': k, 'Gap': round(gap, 4), 's_k': round(s_k, 4)})

    df = pd.DataFrame(results)

    # k ótimo: menor k tal que Gap(k) >= Gap(k+1) - s(k+1)
    k_otimo = df['k'].iloc[-1]
    for i in range(len(df) - 1):
        if df['Gap'].iloc[i] >= df['Gap'].iloc[i + 1] - df['s_k'].iloc[i + 1]:
            k_otimo = df['k'].iloc[i]
            break

    df['otimo'] = df['k'] == k_otimo
    return df, int(k_otimo)


# ══════════════════════════════════════════════════════════════════════════════
# 2. ESTABILIDADE VIA BOOTSTRAP
# ══════════════════════════════════════════════════════════════════════════════

def estabilidade_bootstrap(X_scaled, labels_original, n_boot=30, frac=0.8,
                           random_state=42):
    """
    Avalia estabilidade reamostrando os dados e recalculando K-Means.
    Retorna ARI médio entre partição original e bootstrap.

    ARI > 0.8: clusters muito estáveis
    ARI 0.6-0.8: estáveis
    ARI < 0.6: instáveis
    """
    from sklearn.cluster import KMeans

    mask_valid = labels_original >= 0
    X_valid = X_scaled[mask_valid]
    y_valid = labels_original[mask_valid]
    n = len(X_valid)
    k = len(set(y_valid))

    if k < 2 or n < 10:
        return None, None

    boot_size = int(n * frac)
    # Cap k so KMeans always has enough samples
    k_eff = min(k, boot_size - 1) if boot_size > 2 else 2
    if k_eff < 2:
        return None, None

    rng = np.random.RandomState(random_state)
    aris = []

    for _ in range(n_boot):
        idx = rng.choice(n, size=boot_size, replace=True)
        X_boot = X_valid[idx]
        y_boot_orig = y_valid[idx]

        km = KMeans(n_clusters=k_eff, n_init=5, random_state=rng.randint(1e6))
        y_boot_new = km.fit_predict(X_boot)
        ari = adjusted_rand_score(y_boot_orig, y_boot_new)
        aris.append(ari)

    return float(np.mean(aris)), float(np.std(aris))


# ══════════════════════════════════════════════════════════════════════════════
# 3. TESTES ESTATÍSTICOS ENTRE CLUSTERS
# ══════════════════════════════════════════════════════════════════════════════

def teste_kruskal_wallis(seg120, col_cluster, features):
    """
    Kruskal-Wallis (não-paramétrico) para cada feature entre clusters.
    H0: as medianas dos clusters são iguais.
    p < 0.05 → clusters significativamente diferentes nessa feature.
    """
    resultados = []
    valid = seg120[seg120[col_cluster] >= 0]
    grupos = valid.groupby(col_cluster)

    for feat in features:
        if feat not in valid.columns:
            continue
        amostras = [g[feat].dropna().values for _, g in grupos]
        amostras = [a for a in amostras if len(a) >= 2]

        if len(amostras) < 2:
            continue

        try:
            stat, p = stats.kruskal(*amostras)
            resultados.append({
                'Feature': feat,
                'H_statistic': round(stat, 4),
                'p_value': round(p, 6),
                'Significativo (p<0.05)': '✅ Sim' if p < 0.05 else '❌ Não',
            })
        except Exception:
            pass

    return pd.DataFrame(resultados)


def teste_anova(seg120, col_cluster, features):
    """
    ANOVA one-way para cada feature entre clusters.
    Mais poderoso se dados normais; Kruskal-Wallis é alternativa robusta.
    """
    resultados = []
    valid = seg120[seg120[col_cluster] >= 0]
    grupos = valid.groupby(col_cluster)

    for feat in features:
        if feat not in valid.columns:
            continue
        amostras = [g[feat].dropna().values for _, g in grupos]
        amostras = [a for a in amostras if len(a) >= 2]

        if len(amostras) < 2:
            continue

        try:
            stat, p = stats.f_oneway(*amostras)
            resultados.append({
                'Feature': feat,
                'F_statistic': round(stat, 4),
                'p_value': round(p, 6),
                'Significativo (p<0.05)': '✅ Sim' if p < 0.05 else '❌ Não',
            })
        except Exception:
            pass

    return pd.DataFrame(resultados)


# ══════════════════════════════════════════════════════════════════════════════
# 4. NORMALIDADE POR CLUSTER (Shapiro-Wilk)
# ══════════════════════════════════════════════════════════════════════════════

def teste_normalidade(seg120, col_cluster, features):
    """
    Shapiro-Wilk por cluster e feature.
    p > 0.05 → não rejeita normalidade (dados compatíveis com normal).
    """
    resultados = []
    valid = seg120[seg120[col_cluster] >= 0]

    for cluster_id in sorted(valid[col_cluster].unique()):
        subset = valid[valid[col_cluster] == cluster_id]
        for feat in features:
            if feat not in subset.columns:
                continue
            valores = subset[feat].dropna().values
            if len(valores) < 3 or len(valores) > 5000:
                continue
            try:
                stat, p = stats.shapiro(valores)
                resultados.append({
                    'Cluster': cluster_id,
                    'Feature': feat,
                    'W_statistic': round(stat, 4),
                    'p_value': round(p, 6),
                    'Normal (p>0.05)': '✅ Sim' if p > 0.05 else '❌ Não',
                })
            except Exception:
                pass

    return pd.DataFrame(resultados)


# ══════════════════════════════════════════════════════════════════════════════
# 5. HOMOGENEIDADE INTRA-CLUSTER
# ══════════════════════════════════════════════════════════════════════════════

def homogeneidade_intra(seg120, col_cluster, features):
    """
    Coeficiente de Variação (CV) dentro de cada cluster para cada feature.
    CV < 30%: cluster homogêneo
    CV 30-50%: moderadamente homogêneo
    CV > 50%: heterogêneo

    Retorna DataFrame com média, std e CV por cluster/feature.
    """
    resultados = []
    valid = seg120[seg120[col_cluster] >= 0]

    for cluster_id in sorted(valid[col_cluster].unique()):
        subset = valid[valid[col_cluster] == cluster_id]
        n = len(subset)
        for feat in features:
            if feat not in subset.columns:
                continue
            valores = subset[feat].dropna()
            if len(valores) < 2:
                continue
            media = valores.mean()
            std = valores.std()
            cv = (std / abs(media) * 100) if abs(media) > 1e-10 else np.nan

            if cv is not None and not np.isnan(cv):
                if cv < 30:
                    qualidade = '🟢 Homogêneo'
                elif cv < 50:
                    qualidade = '🟡 Moderado'
                else:
                    qualidade = '🔴 Heterogêneo'
            else:
                qualidade = '—'

            resultados.append({
                'Cluster': cluster_id,
                'Feature': feat,
                'n': n,
                'Média': round(media, 3),
                'Std': round(std, 3),
                'CV (%)': round(cv, 1) if not np.isnan(cv) else None,
                'Qualidade': qualidade,
            })

    return pd.DataFrame(resultados)


# ══════════════════════════════════════════════════════════════════════════════
# 6. CONCORDÂNCIA ENTRE MÉTODOS (ARI CRUZADO)
# ══════════════════════════════════════════════════════════════════════════════

def matriz_ari_cruzado(resultados):
    """
    Calcula ARI entre todos os pares de métodos.
    ARI > 0.8: altamente concordantes
    ARI 0.5-0.8: concordância moderada
    ARI < 0.5: discordantes (partições diferentes)
    """
    nomes = list(resultados.keys())
    n = len(nomes)
    mat = np.full((n, n), np.nan)

    for i in range(n):
        for j in range(n):
            li = resultados[nomes[i]]['labels']
            lj = resultados[nomes[j]]['labels']
            mask = (li >= 0) & (lj >= 0)
            if mask.sum() >= 2:
                mat[i, j] = adjusted_rand_score(li[mask], lj[mask])

    df = pd.DataFrame(mat, index=nomes, columns=nomes).round(3)
    return df


# ══════════════════════════════════════════════════════════════════════════════
# 7. FEATURE IMPORTANCE VIA XGBOOST
# ══════════════════════════════════════════════════════════════════════════════

def feature_importance_xgb(X_scaled, labels, feature_names):
    """
    Treina XGBoost e retorna importância de cada feature para separar clusters.
    """
    from xgboost import XGBClassifier
    from sklearn.preprocessing import LabelEncoder

    mask = labels >= 0
    X_ok = X_scaled[mask]
    y = LabelEncoder().fit_transform(labels[mask])

    if len(set(y)) < 2 or len(y) < 10:
        return pd.DataFrame()

    clf = XGBClassifier(
        n_estimators=100, max_depth=4,
        use_label_encoder=False,
        eval_metric='mlogloss', random_state=42, verbosity=0
    )
    clf.fit(X_ok, y)

    importances = clf.feature_importances_
    df = pd.DataFrame({
        'Feature': feature_names[:len(importances)],
        'Importância': np.round(importances, 4),
        'Importância (%)': np.round(importances / max(importances.sum(), 1e-10) * 100, 1),
    }).sort_values('Importância', ascending=False).reset_index(drop=True)

    return df


# ══════════════════════════════════════════════════════════════════════════════
# 8. DIAGNÓSTICO RESUMIDO
# ══════════════════════════════════════════════════════════════════════════════

def diagnostico_metodo(nome, X_scaled, labels, seg120, col_cluster, features,
                       k_otimo=None):
    """
    Gera um dicionário com parecer consolidado de um método.
    """
    from pipeline.evaluation import avaliar_intrinseco, avaliar_extrinseco_xgb

    diag = {'Método': nome}

    # Métricas intrínsecas
    intr = avaliar_intrinseco(X_scaled, labels)
    if intr is None:
        diag['Parecer'] = '❌ Clustering inválido (< 2 clusters válidos)'
        return diag

    diag['n_clusters'] = intr['n_clusters']
    diag['Silhouette'] = round(intr['silhouette'], 3)
    diag['Calinski-Harabász'] = round(intr['calinski'], 1)
    diag['Davies-Bouldin'] = round(intr['davies_bouldin'], 3)

    # Qualidade silhouette
    sil = intr['silhouette']
    if sil > 0.5:
        diag['Qualidade Silhouette'] = '🟢 Excelente'
    elif sil > 0.3:
        diag['Qualidade Silhouette'] = '🟢 Boa'
    elif sil > 0.1:
        diag['Qualidade Silhouette'] = '🟡 Moderada'
    else:
        diag['Qualidade Silhouette'] = '🔴 Fraca'

    # XGBoost accuracy
    extr = avaliar_extrinseco_xgb(X_scaled, labels)
    acc = extr.get('xgb_accuracy_cv')
    diag['XGB Accuracy'] = round(acc, 3) if acc else None

    if acc and acc > 0.85:
        diag['Explicabilidade'] = '🟢 Alta'
    elif acc and acc > 0.6:
        diag['Explicabilidade'] = '🟡 Moderada'
    else:
        diag['Explicabilidade'] = '🔴 Baixa'

    # Estabilidade bootstrap
    ari_mean, ari_std = estabilidade_bootstrap(X_scaled, labels, n_boot=20)
    if ari_mean is not None:
        diag['ARI Bootstrap'] = round(ari_mean, 3)
        if ari_mean > 0.8:
            diag['Estabilidade'] = '🟢 Estável'
        elif ari_mean > 0.6:
            diag['Estabilidade'] = '🟡 Moderada'
        else:
            diag['Estabilidade'] = '🔴 Instável'

    # Testes de separação
    kw = teste_kruskal_wallis(seg120, col_cluster, features)
    if not kw.empty:
        n_sig = (kw['p_value'] < 0.05).sum()
        diag['Features significativas'] = f"{n_sig}/{len(kw)}"
        if n_sig == len(kw):
            diag['Separação estatística'] = '🟢 Todas significativas'
        elif n_sig > 0:
            diag['Separação estatística'] = '🟡 Parcialmente significativas'
        else:
            diag['Separação estatística'] = '🔴 Nenhuma significativa'

    # Homogeneidade
    homo = homogeneidade_intra(seg120, col_cluster, features)
    if not homo.empty and 'CV (%)' in homo.columns:
        cv_vals = homo['CV (%)'].dropna()
        if len(cv_vals) > 0:
            cv_medio = cv_vals.mean()
            diag['CV Médio (%)'] = round(cv_medio, 1)
            if cv_medio < 30:
                diag['Homogeneidade'] = '🟢 Homogêneo'
            elif cv_medio < 50:
                diag['Homogeneidade'] = '🟡 Moderada'
            else:
                diag['Homogeneidade'] = '🔴 Heterogêneo'

    # k ótimo
    if k_otimo and intr['n_clusters'] != k_otimo:
        diag['k vs Gap'] = f"⚠️ k={intr['n_clusters']} (Gap sugere {k_otimo})"
    elif k_otimo:
        diag['k vs Gap'] = f"✅ k={intr['n_clusters']} = Gap ótimo"

    # Parecer final
    pontos = 0
    if sil > 0.3:
        pontos += 1
    if acc and acc > 0.7:
        pontos += 1
    if ari_mean and ari_mean > 0.7:
        pontos += 1
    if not kw.empty and (kw['p_value'] < 0.05).sum() >= len(kw) * 0.5:
        pontos += 1

    if pontos >= 3:
        diag['Parecer'] = '✅ APROVADO — clustering estatisticamente válido'
    elif pontos >= 2:
        diag['Parecer'] = '⚠️ ACEITÁVEL — com ressalvas'
    else:
        diag['Parecer'] = '❌ REPROVADO — clustering questionável'

    return diag


def auditoria_completa(resultados, seg120, features, metodo_col_map, max_k=10):
    """
    Executa auditoria completa em todos os métodos.

    Retorna
    -------
    df_diagnostico : DataFrame com parecer de cada método
    gap_df : DataFrame do Gap Statistic
    k_otimo : int
    ari_matrix : DataFrame com ARI cruzado
    """
    # Gap Statistic (usa o primeiro resultado disponível)
    primeiro = next(iter(resultados.values()))
    gap_df, k_otimo = gap_statistic(primeiro['X_scaled'], max_k=max_k)

    # Diagnóstico por método
    diagnosticos = []
    for nome, res in resultados.items():
        col_c = metodo_col_map.get(nome)
        if col_c and col_c in seg120.columns:
            diag = diagnostico_metodo(
                nome, res['X_scaled'], res['labels'],
                seg120, col_c, features, k_otimo=k_otimo
            )
            diagnosticos.append(diag)

    df_diag = pd.DataFrame(diagnosticos)

    # ARI cruzado
    ari_matrix = matriz_ari_cruzado(resultados)

    return df_diag, gap_df, k_otimo, ari_matrix
