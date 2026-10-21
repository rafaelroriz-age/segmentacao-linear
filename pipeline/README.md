# pipeline/ — Módulo Central de Segmentação Homogênea

Pacote Python que implementa todo o processamento do sistema SGP, da leitura de dados à exportação. Cada módulo tem responsabilidade única e pode ser importado independentemente.

---

## Fluxo de execução

```
carregar_dados()          preprocessing.py
      ↓
agregar_120m()            preprocessing.py   ← converte pontos em seg120 DataFrame
      ↓
construir_features()      preprocessing.py   ← engenharia de 20+ features
      ↓
padronizar()              clustering.py      ← StandardScaler (μ=0, σ=1)
      ↓
<método>_segmentation()   clustering.py      ← retorna (labels, raw, obj)
      ↓
linearizar_labels()       clustering.py      ← garante contiguidade espacial
      ↓
aplicar_regras_espaciais() segmentacao_homogenea_sgp_v2.py  ← 0.6–5.0 km
      ↓
avaliar_intrinseco()      evaluation.py      ← Silhouette, CH, DB
avaliar_extrinseco_xgb()  evaluation.py      ← XGBoost CV accuracy
      ↓
exportar_resultados()     export_excel.py    ← .xlsx com 4 abas
```

---

## `preprocessing.py`

### Funções públicas

```python
carregar_dados(path: str | Path) -> pd.DataFrame
```
Lê Excel. Detecta colunas automaticamente buscando variações de nome comuns
(`km_inicial`/`km_ini`/`KM_INI`, `d0`/`D0`/`deflexao`, etc.).

```python
agregar_120m(df, col_est, col_def, passo=40, janela=3,
             col_km_ini=None, col_km_fim=None, col_iri=None) -> pd.DataFrame
```
Converte pontos de levantamento em segmentos intervalares. Com `col_km_ini`/`col_km_fim`
presentes, apenas mapeia; sem eles, agrega por estação em janelas de `janela × passo` metros.

```python
construir_features(seg120, vars_clustering=None) -> (seg, X_df, vars_ok)
```
Enriquece o DataFrame com features derivadas e retorna a matriz X pronta para clustering.
Features criadas: `Deflexao_caract`, `Deflexao_std`, `CV_deflexao`, `Deflexao_roll3/5`,
`Deflexao_slope`, `iri_std_local`, `iri_roll3/5`, `d0_iri_ratio`, `posicao_rel`, etc.

**Contrato:**
- `km_ini` / `km_fim` em **metros**
- NaN interpolados por `interpolate(limit_direction="both")`
- Nunca dropa pontos intermediários com NaN em features

---

## `clustering.py`

### Utilitários

```python
padronizar(X: np.ndarray) -> (X_scaled, scaler)
linearizar_labels(labels: np.ndarray) -> np.ndarray
```
`linearizar_labels` é **obrigatório** para todos os métodos que produzem labels não-contíguos (K-Means, GMM, etc.) antes de chamar `aplicar_regras_espaciais`.

### Assinatura padrão de todos os métodos
```python
def <método>(X_scaled, ...) -> (labels: np.ndarray, raw_output, fitted_object)
```

### Métodos disponíveis

| Função | Categoria | Parâmetros principais |
|---|---|---|
| `cda_segmentation(valores, confianca=1.0)` | Tradicional | `confianca`: escala dos limites |
| `mcv_segmentation(valores, janela=5, limiar=0.20)` | Tradicional | — |
| `shs_segmentation(valores, alpha=0.05, min_size=5)` | Tradicional | — |
| `ward1d_linear(X_scaled, k)` | Hierárquico | `k`: nº clusters |
| `kmeans_linear(X_scaled, k)` | Particionamento | `k`: nº clusters |
| `gmm_linear(X_scaled, k, covariance_type='full')` | Probabilístico | — |
| `pelt_segmentation(X_scaled, model='rbf', min_size=3, pen=30)` | Change-point | `pen`: penalidade |
| `dbscan_linear(X_scaled, eps, min_samples)` | Densidade | — |
| `hdbscan_linear(X_scaled, min_cluster_size)` | Densidade | opcional |
| `spectral_linear(X_scaled, k)` | Espectral | — |
| `affinity_linear(X_scaled)` | Auto-k | — |
| `som_linear(X_scaled, grid_x, grid_y)` | Neural | opcional |
| `umap_kmeans_linear(X_scaled, k)` | Redução+Cluster | opcional |
| `ensemble_weighted(labels_list, weights)` | Ensemble | — |
| `knn_segmentation(X_scaled, labels_ref, k=5)` | Supervisionado | — |
| `random_forest_segmentation(X_scaled, labels_ref)` | Supervisionado | — |

---

## `evaluation.py`

```python
avaliar_intrinseco(X_scaled, labels) -> dict | None
# keys: n_clusters, silhouette, calinski, davies_bouldin, n_outliers

avaliar_extrinseco_xgb(X_scaled, labels) -> dict
# keys: xgb_accuracy_cv, xgb_accuracy_std

variancia_intra(seg, col_cluster, col_deflexao) -> pd.DataFrame
# std e CV por segmento contíguo

perfil_clusters(seg, col_cluster, cols) -> pd.DataFrame
# média, std, min, max por cluster
```

**Interpretação das métricas:**
- Silhouette ∈ [-1, 1] — quanto maior, melhor separação
- Calinski-Harabász — quanto maior, melhor
- Davies-Bouldin — quanto menor, melhor
- XGBoost accuracy — quanto maior, mais explicável pelas features

---

## `audit.py`

```python
gap_statistic(X_scaled, max_k=10, n_refs=10) -> pd.DataFrame
# colunas: k, gap, s_k, k_otimo

estabilidade_bootstrap(X_scaled, labels, n_iter=50) -> dict
# keys: ari_mean, ari_std, estavel (bool)

teste_kruskal_wallis(seg, col_cluster, col_deflexao) -> dict
# keys: estatistica, p_valor, significativo

homogeneidade_intra(seg, col_cluster, col_deflexao) -> pd.DataFrame
# CV e std por cluster

matriz_ari_cruzado(dict_labels: dict[str, np.ndarray]) -> pd.DataFrame
# matriz NxN de ARI entre pares de métodos

feature_importance_xgb(X_scaled, labels, feature_names) -> pd.DataFrame
# importância de cada feature para separar os clusters
```

---

## `visualization.py`

Todas as funções retornam `plotly.graph_objects.Figure` prontas para `st.plotly_chart()`.

```python
plot_clusters_rodovia(seg, col_cluster, col_deflexao='Deflexao', titulo=None)
plot_boxplot_clusters(seg, col_cluster, col_deflexao='Deflexao')
plot_perfil_longitudinal(seg, col_cluster, col_deflexao='Deflexao')
```

---

## `export_excel.py`

```python
exportar_resultados(resultados: dict[str, pd.DataFrame], path: str | Path)
```
Grava Excel com:
- Uma aba por método/base (ex: `WARD_d0`, `PELT_dc`)
- Formatação condicional por valor de IRI/deflexão
- Gráficos de barras/linha embutidos (openpyxl nativo)
- Aba `Glossario` com `feature_catalog` e `term_glossary`

---

## `feature_catalog.py`

Glossário centralizado de todas as features usadas no pipeline.

```python
FEATURE_CATALOG: dict[str, dict]  # feature → {grupo, descricao, formula, interpretacao}
feature_glossary_dataframe() -> pd.DataFrame  # tabela para Excel/Streamlit
term_glossary_dataframe() -> pd.DataFrame     # termos do domínio
```

---

## `autoresearch.py`

Varredura sistemática de hiperparâmetros para comparação de métodos.

```python
class AutoResearch:
    def run(self, seg120, X_scaled, feature_names, ...) -> pd.DataFrame
    # Retorna tabela com todas as configurações e métricas (silhouette, xgb, n_clusters)
```

**Grids pré-definidos:**
- `PELT_PENALTY_GRID = [3, 8, 21, 55]`
- `PELT_MODEL_GRID = ['rbf', 'l2']`
- `CDA_CONF_GRID = [0.75, 1.0, 1.25, 1.5, 2.0]`
- `FEATURE_DESCRICOES = {'basicas', 'slope', 'ratio', 'completas', 'full', ...}`

---

## Adicionando um novo método de clustering

1. Implemente em `clustering.py` com assinatura `(X_scaled, ...) -> (labels, raw, obj)`
2. Chame `linearizar_labels(labels)` no retorno
3. Adicione ao grid do `autoresearch.py` se for para pesquisa
4. Atualize `METODO_COL` em `app.py` se for expor no Streamlit
