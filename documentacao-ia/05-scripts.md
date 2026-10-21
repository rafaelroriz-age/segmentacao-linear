# 05 — Scripts Principais

## Visão geral da estrutura (`segmentacao-linear/`)

```
segmentacao-linear/
├── segmentacao_homogenea_sgp_v2.py     ← PRODUÇÃO (Ward 1D + PELT por SRE)
├── segmentacao_homogenea_sgp.py        ← v1 (obsoleta)
├── segmentacao_rede.ipynb              ← MALHA (penalidade por quociente + 2 etapas)  ← FOCO ATUAL
├── segmentacao_metodologia_rede.ipynb  ← malha (versão anterior)
├── segmentacao_duas_etapas_hierarquica*.ipynb ← referência de subsegmentação em 2 etapas
├── pipeline/                           ← biblioteca compartilhada (pesquisa)
├── app.py / app_artigo.py              ← Streamlit (pesquisa)
├── artigo_enacor_v2/                   ← artefatos do artigo
└── requirements.txt                    ← dependências
```

---

## 1. `segmentacao_homogenea_sgp_v2.py` (produção)

**Função:** segmenta cada SRE usando **Ward 1D** e **PELT**, separadamente para `d0` e `dc`.

**Execução:**
```powershell
conda activate SGP
python segmentacao_homogenea_sgp_v2.py --input 20260611-112405.xlsx
python segmentacao_homogenea_sgp_v2.py --input arquivo.xlsx --output saida.xlsx --sheet "Dados"
```

**Entrada (colunas obrigatórias):** `sre`, `km_inicial`, `km_final`, `iri_medio`, `d0`, `dc`.

**Saída (4 abas):** `WARD_d0`, `WARD_dc`, `PELT_d0`, `PELT_dc`, cada uma com
`sre`, `seg_id`, `km_ini_km`, `km_fim_km`, `comprimento_km`, `n_pontos`, `iri_medio`,
`iri_std`, `d0_medio`, `d0_std`, `dc_medio`, `dc_std`, `silhouette`, `xgb_accuracy`.

**Parâmetros (`Params`):** `min_comp_km=0.6`, `max_comp_km=5.0`, `ward_k=10`,
`pelt_model="l2"`, `pelt_min_size=3`, `pelt_pen=4`.

**Fluxo interno:**
```
Excel → _preparar_sre_base → agregar_120m → feature engineering (~15 features)
      → StandardScaler → Ward/PELT → aplicar_regras_espaciais (600m–5km)
      → _segment_table (métricas) → Excel 4 abas
```

---

## 2. `segmentacao_rede.ipynb` (malha — FOCO ATUAL)

**Função:** segmenta **toda a malha** (muitos SREs) a partir de um único arquivo, com
penalidade por **quociente de rede** e **subsegmentação em duas etapas**.

**Entrada:** `sre_seg_200m_07_corrigida.xlsx` — colunas `sre`, `km_inicial`, `km_final`,
`igg`, `iri_medio`, `d0` (intervalos de ~200 m).

**Passos:**
1. Agrega por SRE/intervalo e calcula `aca = cumsum(d0 − média(d0))`.
2. **Etapa 1 (base funcional):** PELT `l2` sobre `igg`, penalidade `α_km_func × extensão`, escolhida por BIC na banda.
3. **Etapa 2 (subsegmentos estruturais):** dentro de cada base, PELT `clinear` sobre `aca`, penalidade `α_km_aca × extensão`, escolhida por **F1 contra os pontos de mudança (extremos CDA)**.
4. Gera gráfico por SRE e exporta Excel.

**Parâmetros-chave:** ver `02-estado-atual.md`.

**Saída (Excel):** abas `ETAPA1`, `SUBSEGMENTOS`, `RESUMO`.

---

## 3. `segmentacao_duas_etapas_hierarquica_v6.ipynb` (referência)

**Função:** subsegmentação em duas etapas com dados de malha 200 m + FWD de alta resolução.

- **Etapa 1:** PELT `l2` sobre `iri`/`igg`, seleção de penalidade por BIC + silhouette, regras espaciais (min 400 m).
- **Etapa 2:** PELT `clinear` sobre `aca` (FWD), snap aos extremos CDA com intervalo de confiança AASHTO, seleção por **Composite Fitness Score** (F1 × razão Δd0 × homogeneidade), fusão por regras de engenharia (Welch / |Δd0| < CONF_Z·σ).
- Parâmetros: `CDA_JANELA=25`, `CONF_Z=0.5`, `SNAP_TOL=30`, `BUFFER_KM=0.3`, `MIN_COMP_KM_ETAPA2=0.8`.

---

## 4. `pipeline/` (biblioteca de pesquisa)

| Módulo | Conteúdo |
|---|---|
| `preprocessing.py` | leitura, agregação 120 m, feature engineering |
| `clustering.py` | CDA, MCV, SHS, KMeans, Ward 1D, GMM, DBSCAN, HDBSCAN, SOM, Spectral, PELT, KNN, Random Forest, Ensemble |
| `evaluation.py` | Silhouette, Calinski-Harabász, Davies-Bouldin, XGBoost acc |
| `audit.py` | gap statistic, bootstrap stability, Kruskal-Wallis, ARI |
| `autoresearch.py` | varredura de hiperparâmetros |
| `visualization.py` | gráficos Plotly |
| `export_excel.py` | Excel estilizado |

---

## 5. Dados de entrada (principais)

| Arquivo | Uso |
|---|---|
| `sre_seg_200m_07_corrigida.xlsx` | malha atual (segmentação em rede) |
| `20260611-112405.xlsx` | produção multi-SRE |
| `010_dados_pesquisa.xlsx` / `_dc.xlsx` | GO-010 (artigo) |
| `iri_GO_334.xlsx` / `fwd_GO_334.xlsx` | GO-334 (pesquisa) |
| `fwd_320EGO0130.xlsx` | SRE de referência p/ calibrar o quociente de penalidade |

---

## 6. Dependências principais

```
pandas, numpy, scipy, scikit-learn, ruptures (PELT), openpyxl
(opcionais: xgboost, streamlit, plotly, hdbscan, minisom, umap-learn)
```

Ambiente conda: `SGP`.
