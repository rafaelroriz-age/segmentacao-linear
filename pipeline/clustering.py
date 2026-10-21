"""
Pipeline de Segmentação Homogênea Linear — Clustering
Todos os métodos produzem segmentos LINEARES (contíguos espacialmente).

Categorias:
  A. Métodos tradicionais de engenharia rodoviária (CDA, MCV, SHS)
  B. Clustering clássico + linearização (K-Means, Ward, DBSCAN, HDBSCAN,
     Affinity Propagation, GMM, SOM, Spectral, UMAP+KM)
  C. Change-point detection (PELT) — já linear por natureza
  D. Métodos supervisionados adaptados (KNN, Random Forest)

Linearização:
  Todos os métodos que produzem labels não-contíguos passam pela função
  `linearizar_labels()` que converte clusters livres em segmentos contíguos,
  preservando a identidade do cluster original de cada segmento.
"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import (
    KMeans, AgglomerativeClustering, DBSCAN,
    AffinityPropagation, SpectralClustering,
)
from sklearn.mixture import GaussianMixture
from scipy.sparse import diags


def padronizar(X):
    """Padroniza features com StandardScaler (média=0, std=1)."""
    scaler = StandardScaler()
    return scaler.fit_transform(X), scaler


# ══════════════════════════════════════════════════════════════════════════════
# LINEARIZAÇÃO — Forçar contiguidade espacial
# ══════════════════════════════════════════════════════════════════════════════

def linearizar_labels(labels):
    """
    Converte labels de clustering livre em segmentos LINEARES contíguos.
    Cada vez que o label muda ao longo da sequência, um novo segmento é criado.
    Segmentos com o mesmo label original mas separados espacialmente recebem
    IDs diferentes (sufixo incremental).

    Exemplo:
        Input:  [0, 0, 1, 1, 0, 0, 2, 2]
        Output: [0, 0, 1, 1, 2, 2, 3, 3]  (cada trecho contíguo = segmento único)
    """
    n = len(labels)
    if n == 0:
        return labels.copy()

    linear = np.zeros(n, dtype=int)
    seg_id = 0
    linear[0] = seg_id

    for i in range(1, n):
        if labels[i] != labels[i - 1]:
            seg_id += 1
        linear[i] = seg_id

    return linear


# ══════════════════════════════════════════════════════════════════════════════
# A. MÉTODOS TRADICIONAIS DE ENGENHARIA RODOVIÁRIA
# ══════════════════════════════════════════════════════════════════════════════

def cda_segmentation(valores, confianca=1.0):
    """
    Cumulative Difference Approach (CDA) — AASHTO / DNIT.
    Detecta mudanças na tendência usando a diferença acumulada em relação à média.

    Algoritmo:
      1. Calcula Z_x = soma acumulada - (x/n)*Σ total
      2. Breakpoints onde Z_x cruza zero ou excede limites de confiança

    Parâmetros
    ----------
    valores : array 1D de deflexão
    confianca : multiplicador do limite (1.0 = padrão AASHTO)

    Retorna
    -------
    labels : array de segmentos lineares
    breakpoints : lista de índices de quebra
    """
    n = len(valores)
    if n < 3:
        return np.zeros(n, dtype=int), []

    media_geral = np.mean(valores)
    # Diferença acumulada
    z = np.cumsum(valores - media_geral)

    # Limites de confiança (baseado em range de Z)
    z_range = z.max() - z.min()
    if z_range < 1e-10:
        return np.zeros(n, dtype=int), []

    limite = confianca * np.sqrt(n) * np.std(valores) / np.sqrt(n)

    # Breakpoints: onde Z muda de sinal ou excede limites
    breakpoints = []
    for i in range(1, n):
        if z[i] * z[i - 1] < 0:  # cruzamento de zero
            breakpoints.append(i)
        elif abs(z[i] - z[i - 1]) > limite:  # mudança brusca
            breakpoints.append(i)

    # Remover duplicatas próximas
    if breakpoints:
        clean = [breakpoints[0]]
        for bp in breakpoints[1:]:
            if bp - clean[-1] >= 3:
                clean.append(bp)
        breakpoints = clean

    labels = np.zeros(n, dtype=int)
    seg = 0
    prev = 0
    for bp in breakpoints:
        labels[prev:bp] = seg
        seg += 1
        prev = bp
    labels[prev:] = seg

    return labels, breakpoints


def mcv_segmentation(valores, janela=5, limiar_cv=0.3):
    """
    Method of Concomitant Variations (MCV).
    Segmenta pela variabilidade local: uma nova faixa começa quando o CV
    da janela móvel excede o limiar.

    Algoritmo:
      1. Calcula CV em janela deslizante
      2. Breakpoint onde CV > limiar
      3. Cada trecho entre breakpoints é um segmento

    Parâmetros
    ----------
    valores : array 1D de deflexão
    janela : tamanho da janela deslizante (default 5)
    limiar_cv : limiar do CV para detectar mudança (default 0.3 = 30%)

    Retorna
    -------
    labels : array de segmentos lineares
    breakpoints : lista de índices de quebra
    """
    n = len(valores)
    if n < janela:
        return np.zeros(n, dtype=int), []

    breakpoints = []
    seg_start = 0

    for i in range(janela, n):
        segmento = valores[seg_start:i]
        media = np.mean(segmento)
        if abs(media) > 1e-10:
            cv = np.std(segmento) / abs(media)
        else:
            cv = 0.0

        if cv > limiar_cv and (i - seg_start) >= janela:
            breakpoints.append(i)
            seg_start = i

    labels = np.zeros(n, dtype=int)
    seg = 0
    prev = 0
    for bp in breakpoints:
        labels[prev:bp] = seg
        seg += 1
        prev = bp
    labels[prev:] = seg

    return labels, breakpoints


def shs_segmentation(valores, nivel_significancia=0.05, min_tamanho=3):
    """
    Spatial Homogeneity Segmentation (SHS).
    Segmentação sequencial por teste de hipótese: testa se adicionar o próximo
    ponto mantém a homogeneidade do segmento atual (teste t para média).

    Algoritmo:
      1. Inicia segmento com os primeiros pontos
      2. Adiciona ponto seguinte; testa se a média mudou significativamente
      3. Se sim → breakpoint e novo segmento
      4. Se não → continua acumulando

    Parâmetros
    ----------
    valores : array 1D de deflexão
    nivel_significancia : alpha para o teste t (default 0.05)
    min_tamanho : tamanho mínimo de segmento antes de testar (default 3)

    Retorna
    -------
    labels : array de segmentos lineares
    breakpoints : lista de índices de quebra
    """
    from scipy.stats import ttest_ind

    n = len(valores)
    if n < min_tamanho * 2:
        return np.zeros(n, dtype=int), []

    breakpoints = []
    seg_start = 0
    labels = np.zeros(n, dtype=int)
    seg_id = 0

    i = min_tamanho
    while i < n - min_tamanho + 1:
        seg_atual = valores[seg_start:i]
        seg_proximo = valores[i:min(i + min_tamanho, n)]

        if len(seg_atual) >= min_tamanho and len(seg_proximo) >= min_tamanho:
            _, p_value = ttest_ind(seg_atual, seg_proximo, equal_var=False)
            if p_value < nivel_significancia:
                breakpoints.append(i)
                labels[seg_start:i] = seg_id
                seg_id += 1
                seg_start = i
                i += min_tamanho
                continue
        i += 1

    labels[seg_start:] = seg_id
    return labels, breakpoints


# ══════════════════════════════════════════════════════════════════════════════
# B. CLUSTERING CLÁSSICO + LINEARIZAÇÃO
# ══════════════════════════════════════════════════════════════════════════════

def connectivity_1d(n):
    """Constrói matriz de conectividade 1D (cada ponto conectado ao vizinho)."""
    return diags([1, 1], [-1, 1], shape=(n, n)).toarray()


def kmeans_linear(X_scaled, k):
    """K-Means + linearização para segmentos contíguos."""
    km = KMeans(n_clusters=k, random_state=42, n_init=20)
    labels_raw = km.fit_predict(X_scaled)
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, km


def ward1d_linear(X_scaled, k):
    """Ward com conectividade 1D — já linear por construção."""
    conn = connectivity_1d(len(X_scaled))
    agg = AgglomerativeClustering(n_clusters=k, linkage='ward', connectivity=conn)
    labels = agg.fit_predict(X_scaled)
    # Ward 1D com conectividade já produz segmentos lineares
    return labels, labels, agg


def dbscan_linear(X_scaled, eps=0.5, min_samples=3):
    """DBSCAN + linearização."""
    db = DBSCAN(eps=eps, min_samples=min_samples)
    labels_raw = db.fit_predict(X_scaled)
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, db


def hdbscan_linear(X_scaled, min_cluster_size=5):
    """HDBSCAN + linearização."""
    import hdbscan
    clusterer = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size,
                                 prediction_data=True)
    labels_raw = clusterer.fit_predict(X_scaled)
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, clusterer


def affinity_propagation_linear(X_scaled, damping=0.8):
    """Affinity Propagation + linearização."""
    ap = AffinityPropagation(damping=damping, random_state=42, max_iter=500)
    labels_raw = ap.fit_predict(X_scaled)
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, ap


def gmm_linear(X_scaled, k, covariance_type='full'):
    """GMM + linearização."""
    g = GaussianMixture(n_components=k, covariance_type=covariance_type,
                        random_state=42, n_init=10)
    labels_raw = g.fit_predict(X_scaled)
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, g


def som_linear(X_scaled, grid_size=(3, 3), sigma=1.0, lr=0.5, epochs=1000):
    """SOM + linearização."""
    from minisom import MiniSom
    n_features = X_scaled.shape[1]
    som = MiniSom(grid_size[0], grid_size[1], n_features,
                  sigma=sigma, learning_rate=lr, random_seed=42)
    som.train(X_scaled, epochs, verbose=False)
    labels_raw = np.array([
        som.winner(x)[0] * grid_size[1] + som.winner(x)[1]
        for x in X_scaled
    ])
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, som


def spectral_linear(X_scaled, k):
    """Spectral Clustering + linearização."""
    sc = SpectralClustering(n_clusters=k, random_state=42,
                            assign_labels='kmeans', affinity='rbf')
    labels_raw = sc.fit_predict(X_scaled)
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, sc


def pelt_segmentation(X_scaled, model='rbf', min_size=3, pen=30):
    """PELT — já produz segmentos lineares por natureza."""
    import ruptures as rpt
    algo = rpt.Pelt(model=model, min_size=min_size, jump=1).fit(X_scaled)
    bkps = algo.predict(pen=pen)
    labels = np.zeros(len(X_scaled), dtype=int)
    prev = 0
    for seg_num, bp in enumerate(bkps):
        labels[prev:bp] = seg_num
        prev = bp
    return labels, bkps, algo


def umap_kmeans_linear(X_scaled, k, n_components=2, n_neighbors=15):
    """UMAP + K-Means + linearização."""
    from umap import UMAP
    reducer = UMAP(n_components=n_components, n_neighbors=n_neighbors,
                   random_state=42)
    X_umap = reducer.fit_transform(X_scaled)
    km = KMeans(n_clusters=k, random_state=42, n_init=20)
    labels_raw = km.fit_predict(X_umap)
    labels = linearizar_labels(labels_raw)
    return labels, labels_raw, X_umap, reducer, km


# ══════════════════════════════════════════════════════════════════════════════
# D. MÉTODOS SUPERVISIONADOS ADAPTADOS PARA SEGMENTAÇÃO
# ══════════════════════════════════════════════════════════════════════════════

def _features_espaciais(X_scaled, window=3):
    """
    Enriquece features com contexto espacial via rolling window.
    Adiciona: média local, diferença vs vizinho anterior, posição normalizada.
    Isso dá ao classificador informação de vizinhança que K-Means puro não usa.
    """
    n = len(X_scaled)
    X_arr = np.array(X_scaled)

    # Média móvel centrada (contexto espacial)
    X_roll = np.zeros_like(X_arr)
    half = window // 2
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        X_roll[i] = X_arr[lo:hi].mean(axis=0)

    # Diferença vs ponto anterior (gradiente local)
    X_diff = np.zeros_like(X_arr)
    X_diff[1:] = X_arr[1:] - X_arr[:-1]

    # Posição normalizada (0 a 1)
    pos = np.linspace(0, 1, n).reshape(-1, 1)

    return np.hstack([X_arr, X_roll, X_diff, pos])


def knn_segmentation(X_scaled, k_clusters, k_neighbors=5):
    """
    Segmentação via KNN com diferenciação genuína:
      1. K-Means gera labels iniciais
      2. Features aumentadas com contexto espacial (rolling window + gradiente)
      3. Predição via cross-validation (cada ponto é classificado out-of-sample)
      4. Lineariza para segmentos contíguos

    O resultado é diferente do K-Means porque:
    - Features espaciais mudam as fronteiras
    - CV garante predições out-of-sample (sem overfitting)
    - KNN suaviza fronteiras pela votação de vizinhos
    """
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.model_selection import cross_val_predict

    # Fase 1: clustering inicial
    km = KMeans(n_clusters=k_clusters, random_state=42, n_init=20)
    labels_init = km.fit_predict(X_scaled)

    # Fase 2: features aumentadas com contexto espacial
    X_aug = _features_espaciais(X_scaled, window=5)

    # Fase 3: predição out-of-sample via CV
    knn = KNeighborsClassifier(n_neighbors=min(k_neighbors, len(X_scaled) - 1))
    n_folds = min(5, k_clusters, len(X_scaled))
    labels_knn = cross_val_predict(knn, X_aug, labels_init, cv=n_folds)

    # Treinar modelo final (para feature importance / inspeção)
    knn.fit(X_aug, labels_init)

    labels = linearizar_labels(labels_knn)
    return labels, labels_knn, knn


def random_forest_segmentation(X_scaled, k_clusters, n_estimators=100):
    """
    Segmentação via Random Forest com diferenciação genuína:
      1. K-Means gera labels iniciais
      2. Features aumentadas com contexto espacial
      3. Predição via OOB (out-of-bag): cada árvore prediz apenas
         amostras que NÃO usou no bootstrap → zero overfitting
      4. Iteração: labels OOB refinados alimentam uma segunda rodada
      5. Lineariza para segmentos contíguos

    O resultado é diferente do K-Means porque:
    - Features espaciais enriquecem a decisão
    - OOB garante generalização (cada ponto classificado por ~37% das árvores
      que nunca o viram no treino)
    - Iteração converge para fronteiras mais estáveis
    - RF pondera features por importância (feature_importances_)
    """
    from sklearn.ensemble import RandomForestClassifier

    # Fase 1: clustering inicial
    km = KMeans(n_clusters=k_clusters, random_state=42, n_init=20)
    labels_init = km.fit_predict(X_scaled)

    # Fase 2: features aumentadas com contexto espacial
    X_aug = _features_espaciais(X_scaled, window=5)

    # Fase 3: treinar RF com OOB
    rf = RandomForestClassifier(
        n_estimators=max(n_estimators, 200),
        random_state=42,
        n_jobs=-1,
        oob_score=True,
        max_features='sqrt',
        min_samples_leaf=2,
    )
    rf.fit(X_aug, labels_init)
    labels_oob = np.argmax(rf.oob_decision_function_, axis=1)

    # Mapear classes OOB de volta às classes originais do RF
    classes = rf.classes_
    labels_oob = classes[labels_oob]

    # Fase 4: segunda iteração com labels OOB refinados
    rf2 = RandomForestClassifier(
        n_estimators=max(n_estimators, 200),
        random_state=123,
        n_jobs=-1,
        oob_score=True,
        max_features='sqrt',
        min_samples_leaf=2,
    )
    rf2.fit(X_aug, labels_oob)
    labels_rf = np.argmax(rf2.oob_decision_function_, axis=1)
    labels_rf = rf2.classes_[labels_rf]

    labels = linearizar_labels(labels_rf)
    return labels, labels_rf, rf2


# ══════════════════════════════════════════════════════════════════════════════
# REGRAS ESPACIAIS (Stage III — fusão de segmentos curtos)
# ══════════════════════════════════════════════════════════════════════════════

def aplicar_regras_espaciais(seg120, col_cluster, col_deflexao='Deflexao',
                              min_comprimento_m=400, max_comprimento_m=None):
    """
    Segmentos abaixo do comprimento mínimo são fundidos ao vizinho que
    minimize o desvio padrão da deflexão do segmento resultante.
    Como os labels já são lineares, esta fusão preserva a contiguidade.
    """
    seg = seg120.copy().sort_values('km_ini').reset_index(drop=True)
    labels = seg[col_cluster].values.copy()

    def get_trechos(lbls):
        trechos = []
        start = 0
        for i in range(1, len(lbls)):
            if lbls[i] != lbls[i - 1]:
                trechos.append((start, i - 1))
                start = i
        trechos.append((start, len(lbls) - 1))
        return trechos

    max_iters = 50
    _EPS = 1.0  # tolerancia FP (metros) — dados em intervalos de ~200 m

    for _ in range(max_iters):
        trechos = get_trechos(labels)
        comprimentos = [
            seg.loc[t[0]:t[1], 'comprimento_m'].sum() for t in trechos
        ]
        curtos = [
            (i, t)
            for i, (t, c) in enumerate(zip(trechos, comprimentos))
            if c < min_comprimento_m
        ]
        if not curtos:
            break

        idx, (i0, i1) = curtos[0]
        candidatos = []
        if idx > 0:
            j0, j1 = trechos[idx - 1]
            vals = np.concatenate([
                seg.loc[j0:j1, col_deflexao].values,
                seg.loc[i0:i1, col_deflexao].values
            ])
            candidatos.append(('esquerda', j0, j1, i0, i1, np.std(vals)))
        if idx < len(trechos) - 1:
            j0, j1 = trechos[idx + 1]
            vals = np.concatenate([
                seg.loc[i0:i1, col_deflexao].values,
                seg.loc[j0:j1, col_deflexao].values
            ])
            candidatos.append(('direita', i0, i1, j0, j1, np.std(vals)))

        if not candidatos:
            break
        # Filtrar candidatos que não estourem o máximo
        if max_comprimento_m is not None and max_comprimento_m > 0:
            candidatos = [
                c for c in candidatos
                if seg.loc[min(c[1],c[3]):max(c[2],c[4]), 'comprimento_m'].sum() <= max_comprimento_m + _EPS
            ]
        if not candidatos:
            break
        melhor = min(candidatos, key=lambda x: x[-1])
        lbl_destino = labels[melhor[1]]
        labels[melhor[3]:melhor[4] + 1] = lbl_destino

    if max_comprimento_m is not None and max_comprimento_m > 0:
        labels_longos = labels.copy()
        trechos = get_trechos(labels_longos)
        next_label = int(labels_longos.max()) + 1 if len(labels_longos) else 0

        for i0, i1 in trechos:
            comprimento = seg.loc[i0:i1, 'comprimento_m'].sum()
            if comprimento <= max_comprimento_m + _EPS:
                continue

            # Definir pontos de inicio de cada sub-segmento
            pontos = [i0]
            acumulado = 0.0
            for idx in range(i0, i1 + 1):
                comp_atual = float(seg.loc[idx, 'comprimento_m'])
                if acumulado + comp_atual > max_comprimento_m + _EPS and idx > pontos[-1]:
                    pontos.append(idx)
                    acumulado = comp_atual
                else:
                    acumulado += comp_atual

            # Se ultimo fragmento ficou curto demais, absorver no anterior
            # somente se nao estourar o maximo
            if len(pontos) > 2:
                comp_ultimo = seg.loc[pontos[-1]:i1, 'comprimento_m'].sum()
                if comp_ultimo < min_comprimento_m:
                    comp_penult = seg.loc[pontos[-2]:pontos[-1]-1, 'comprimento_m'].sum()
                    if comp_penult + comp_ultimo <= max_comprimento_m + _EPS:
                        pontos.pop()

            # Atribuir labels: 1o sub-segmento mantem label original
            for k in range(1, len(pontos)):
                for idx in range(pontos[k], i1 + 1 if k == len(pontos) - 1 else pontos[k + 1] if k + 1 < len(pontos) else i1 + 1):
                    labels_longos[idx] = next_label
                next_label += 1

        labels = labels_longos

    # Passo final: re-verificar e fundir segmentos ainda abaixo do minimo
    # (podem ter sido criados pela divisao de segmentos longos)
    for _ in range(max_iters):
        trechos = get_trechos(labels)
        comprimentos = [
            seg.loc[t[0]:t[1], 'comprimento_m'].sum() for t in trechos
        ]
        curtos = [
            (i, t)
            for i, (t, c) in enumerate(zip(trechos, comprimentos))
            if c < min_comprimento_m
        ]
        if not curtos:
            break
        idx, (i0, i1) = curtos[0]
        candidatos = []
        if idx > 0:
            j0, j1 = trechos[idx - 1]
            vals = np.concatenate([
                seg.loc[j0:j1, col_deflexao].values,
                seg.loc[i0:i1, col_deflexao].values
            ])
            candidatos.append(('esquerda', j0, j1, i0, i1, np.std(vals)))
        if idx < len(trechos) - 1:
            j0, j1 = trechos[idx + 1]
            vals = np.concatenate([
                seg.loc[i0:i1, col_deflexao].values,
                seg.loc[j0:j1, col_deflexao].values
            ])
            candidatos.append(('direita', i0, i1, j0, j1, np.std(vals)))
        if not candidatos:
            break
        # Filtrar candidatos que não estourem o máximo
        if max_comprimento_m is not None and max_comprimento_m > 0:
            candidatos = [
                c for c in candidatos
                if seg.loc[min(c[1],c[3]):max(c[2],c[4]), 'comprimento_m'].sum() <= max_comprimento_m + _EPS
            ]
        if not candidatos:
            break
        melhor = min(candidatos, key=lambda x: x[-1])
        lbl_destino = labels[melhor[1]]
        labels[melhor[3]:melhor[4] + 1] = lbl_destino

    seg[f'{col_cluster}_espacial'] = labels
    return seg


# ══════════════════════════════════════════════════════════════════════════════
# Ensemble — votação ponderada (Ward + MCV + PELT)
# ══════════════════════════════════════════════════════════════════════════════

def ensemble_weighted(labels_list, weights=None):
    """
    Ensemble por votação ponderada (majority voting pixel-wise).
    Cada método vota pelo label do ponto. O label final = moda ponderada.
    Depois lineariza para garantir contiguidade.
    """
    n = len(labels_list[0])
    if weights is None:
        weights = [1.0] * len(labels_list)

    final_labels = np.zeros(n, dtype=int)
    for i in range(n):
        votes = {}
        for lbls, w in zip(labels_list, weights):
            lbl = lbls[i]
            votes[lbl] = votes.get(lbl, 0) + w
        final_labels[i] = max(votes, key=votes.get)

    return linearizar_labels(final_labels)
