# AGENTS.md — Segmentação Homogênea Linear (SGP)

> Documentação para agentes de IA (GitHub Copilot, Cursor, etc.) sobre o propósito,
> estrutura e convenções deste repositório.

---

## O que é este sistema

Sistema de **segmentação homogênea linear de rodovias** desenvolvido para o SGP (Sistema de Gerência de Pavimentos) da Dynatest. Recebe dados de levantamento de campo (deflexões FWD e IRI) e divide trechos rodoviários em segmentos homogêneos, agrupando regiões com comportamento estrutural semelhante para apoiar decisões de manutenção.

**Contexto científico:** Implementa e compara os algoritmos CDA (AASHTO/DNIT), Ward 1D e PELT, conforme descrito no artigo ENACOR 2026 (*Segmentação Homogênea: CDA × Ward 1D × PELT*).

---

## Estrutura do repositório

```
segmentacao-linear/
├── AGENTS.md                        ← este arquivo
├── segmentacao_homogenea_sgp_v2.py  ← CLI de produção (SGP)
├── segmentacao_homogenea_sgp.py     ← CLI versão anterior (obsoleto)
├── app.py                           ← Streamlit app (artigo científico)
├── app_artigo.py                    ← Streamlit app variante
├── requirements.txt                 ← dependências Python
├── pipeline/                        ← pacote central (ver pipeline/README.md)
│   ├── preprocessing.py             ← leitura de dados + feature engineering
│   ├── clustering.py                ← todos os métodos de segmentação
│   ├── evaluation.py                ← métricas intrínsecas e extrínsecas
│   ├── audit.py                     ← validação estatística avançada
│   ├── visualization.py             ← gráficos Plotly
│   ├── export_excel.py              ← exportação Excel formatado
│   ├── feature_catalog.py           ← glossário de features
│   └── autoresearch.py              ← varredura de hiperparâmetros
├── artigo_enacor_v2/                ← artefatos e resultados do artigo
├── results/                         ← outputs de experimentos
└── relatorio_experimentos/          ← relatórios de AutoResearch
```

---

## Scripts de entrada (entry points)

| Script | Propósito | Como executar |
|---|---|---|
| `segmentacao_homogenea_sgp_v2.py` | Produção SGP — segmenta por SRE, WARD e PELT | `python segmentacao_homogenea_sgp_v2.py --input arquivo.xlsx` |
| `app.py` | App Streamlit para pesquisa/artigo (CDA × Ward × PELT) | `streamlit run app.py` |
| `app_artigo.py` | App Streamlit variante do artigo | `streamlit run app_artigo.py` |
| `autorun.py` | Execução em lote de experimentos | `python autorun.py` |
| `train.py` | Treinamento/benchmark de configurações | `python train.py` |

**Ambiente conda:** `SGP`
```powershell
conda activate SGP
python segmentacao_homogenea_sgp_v2.py --input 20260611-112405.xlsx
```

---

## Formato de entrada

Arquivo Excel (`.xlsx`) com as colunas obrigatórias:

| Coluna | Tipo | Descrição |
|---|---|---|
| `sre` | str/int | Código do Segmento Rodoviário de Estudo |
| `km_inicial` | float | Início do intervalo (km) |
| `km_final` | float | Fim do intervalo (km) |
| `iri_medio` | float | IRI médio do intervalo (m/km) |
| `d0` | float | Deflexão máxima — bacia FWD (μm) |
| `dc` | float | Deflexão característica — bacia FWD (μm) |

Segmentos com `km_final <= km_inicial` ou valores nulos em colunas obrigatórias são ignorados.

---

## Formato de saída (`segmentacao_homogenea_sgp_v2.py`)

Excel com **4 abas**:

| Aba | Método | Feature de deflexão |
|---|---|---|
| `WARD_d0` | Ward 1D hierárquico | d0 (deflexão máxima) |
| `WARD_dc` | Ward 1D hierárquico | dc (deflexão característica) |
| `PELT_d0` | PELT change-point | d0 |
| `PELT_dc` | PELT change-point | dc |

Colunas de cada aba: `sre`, `seg_id`, `km_ini_km`, `km_fim_km`, `comprimento_km`,
`n_pontos`, `iri_medio`, `iri_std`, `d0_medio`, `d0_std`, `dc_medio`, `dc_std`,
`silhouette`, `xgb_accuracy`.

---

## Módulo `pipeline/`

### `preprocessing.py`
- `carregar_dados(path)` — lê Excel, detecta colunas automaticamente
- `agregar_120m(df, ...)` — agrupa pontos em segmentos intervalares
- `construir_features(seg, vars_clustering)` — engenharia de features (20+ variáveis)

### `clustering.py`
Todos os métodos retornam `(labels, breakpoints_ou_labels_raw, objeto_ajustado)`.

**Grupo A — Métodos tradicionais de engenharia rodoviária:**
- `cda_segmentation(valores, confianca)` — Cumulative Difference Approach (AASHTO/DNIT)
- `mcv_segmentation(valores, janela, limiar)` — Média Corrida com Variância
- `shs_segmentation(valores, alpha, min_size)` — Student's t Sequential (SHS)

**Grupo B — Clustering clássico + linearização:**
- `ward1d_linear(X_scaled, k)` — Ward hierárquico com conectividade 1D
- `kmeans_linear(X_scaled, k)` — K-Means com `linearizar_labels()`
- `gmm_linear(X_scaled, k, covariance_type)` — Gaussian Mixture
- Também: DBSCAN, HDBSCAN, Affinity Propagation, Spectral, SOM, UMAP+KMeans

**Grupo C — Change-point detection:**
- `pelt_segmentation(X_scaled, model, min_size, pen)` — PELT via `ruptures`

**Grupo D — Supervisionados:**
- `knn_segmentation(...)`, `random_forest_segmentation(...)`

**Utilidade:** `linearizar_labels(labels)` — converte clusters livres em segmentos contíguos espacialmente.

### `evaluation.py`
- `avaliar_intrinseco(X_scaled, labels)` — Silhouette, Calinski-Harabász, Davies-Bouldin
- `avaliar_extrinseco_xgb(X_scaled, labels)` — acurácia XGBoost CV como proxy de explicabilidade
- `variancia_intra(seg, col_cluster, col_deflexao)` — CV e std dentro de cada segmento
- `perfil_clusters(seg, col_cluster, cols)` — estatísticas por cluster

### `audit.py`
- `gap_statistic(X_scaled, max_k, n_refs)` — número ótimo de clusters (Tibshirani 2001)
- `estabilidade_bootstrap(X_scaled, labels, n_iter)` — robustez via ARI bootstrap
- `teste_kruskal_wallis(seg, col_cluster, col_deflexao)` — diferença entre clusters
- `matriz_ari_cruzado(dict_labels)` — concordância entre métodos
- `feature_importance_xgb(X_scaled, labels, feature_names)` — importância de features

### `visualization.py`
Funções Plotly para o app Streamlit:
- `plot_clusters_rodovia(seg, col_cluster, ...)` — dispersão por posição
- `plot_boxplot_clusters(seg, col_cluster, ...)` — distribuição por cluster
- `plot_perfil_longitudinal(seg, col_cluster, ...)` — perfil contínuo

### `export_excel.py`
- `exportar_resultados(resultados_dict, path)` — grava Excel com formatação condicional, gráficos embutidos e glossário

### `autoresearch.py`
- `AutoResearch.run(seg120, X_scaled, ...)` — varredura de hiperparâmetros com grid configurável
- Grids: `PELT_PENALTY_GRID`, `PELT_MODEL_GRID`, `CDA_CONF_GRID`, etc.

---

## Parâmetros principais (`Params` em `segmentacao_homogenea_sgp_v2.py`)

| Parâmetro | Padrão | Descrição |
|---|---|---|
| `min_comp_km` | `0.6` | Comprimento mínimo por segmento (km) |
| `max_comp_km` | `5.0` | Comprimento máximo por segmento (km) |
| `ward_k` | `10` | Número inicial de clusters Ward |
| `pelt_model` | `"l2"` | Modelo de custo PELT (`"l2"`, `"rbf"`) |
| `pelt_pen` | `4` | Penalidade PELT |
| `pelt_min_size` | `3` | Tamanho mínimo de segmento PELT (nº de pontos) |

Features padrão para clustering: `["Deflexao_caract", "iri_medio", "Deflexao"]`

---

## Convenções de código

- **Coordenadas:** `km_ini` / `km_fim` em **metros** internamente; `km_ini_km` / `km_fim_km` em **km** na saída.
- **Deflexão:** `Deflexao` = d0 ou dc dependendo da aba; `Deflexao_caract` = `Deflexao + Deflexao_std`.
- **Labels de cluster:** sempre inteiros não-negativos; `linearizar_labels()` garante contiguidade.
- **Coluna de cluster ajustado:** `<col_cluster>_espacial` após `aplicar_regras_espaciais()`.
- **Segmentos curtos:** mesclados com o vizinho de menor desvio padrão conjunto.
- **NaN em features:** interpolados (`limit_direction="both"`) ou preenchidos com mediana.

---

## Dependências principais

```
streamlit, pandas, numpy, scipy, scikit-learn
ruptures      ← PELT
xgboost       ← avaliação extrínseca
openpyxl      ← exportação Excel
plotly        ← visualizações
hdbscan, minisom, umap-learn  ← métodos alternativos
```

Instalar: `pip install -r requirements.txt` (no conda `SGP`).

---

## Fluxo de dados resumido

```
Excel entrada (d0, dc, IRI por km)
        ↓
preprocessing.py  →  seg120 (DataFrame por segmento)
        ↓
clustering.py     →  labels (array de cluster IDs)
        ↓
aplicar_regras_espaciais()  →  labels_espacial (restrição 0.6–5.0 km)
        ↓
evaluation.py     →  métricas (Silhouette, XGBoost acc)
        ↓
export_excel.py   →  .xlsx com abas WARD_d0, WARD_dc, PELT_d0, PELT_dc
```

---

## Arquivos de resultados de pesquisa

- `artigo_enacor_v2/` — CSV/JSON com métricas, figuras HTML e tabelas do artigo ENACOR 2026
- `results/` — JSONs de experimentos com configurações e scores (history.json, best_config.json)
- `relatorio_experimentos/` — relatórios Markdown + figuras HTML do AutoResearch

---

## Notas para agentes

1. **Não alterar** a lógica de `aplicar_regras_espaciais()` sem validar que os comprimentos mínimos/máximos ainda são respeitados.
2. **Coluna `Deflexao`** é usada internamente — ao adicionar nova base (ex: `d1`), seguir o padrão de renomear para `Deflexao` no `_preparar_segmentos_intervalares()`.
3. **Testes:** não há suite de testes automatizados; validação manual com `check_output.py` e comparação de planilhas.
4. **SRE por SRE:** o script de produção processa cada SRE independentemente — não assumir continuidade entre SREs diferentes.
5. **Arquivo de entrada corrente:** `20260611-112405.xlsx` (GO-334, estudos de deflexão e IRI).
