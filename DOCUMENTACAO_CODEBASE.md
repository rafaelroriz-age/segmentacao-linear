# Documentação do Codebase — Segmentação Homogênea de Pavimentos (SGP)

> **Propósito desta documentação:** Descrever com precisão o que este repositório faz, como funciona internamente e quais são os pontos de extensão, para que um agente possa criar uma versão de produção simplificada — que apenas segmente os trechos usando Ward 1D e PELT, sem a camada de comparação/pesquisa entre métodos.

---

## 1. Objetivo do Projeto

Este repositório implementa a **segmentação linear homogênea de pavimentos rodoviários** para o SGP (Sistema de Gerenciamento de Pavimentos) da Dynatest Engenharia. A segmentação homogênea divide um trecho rodoviário (SRE) em sub-trechos com comportamento estrutural e funcional uniforme, tornando-os gerenciáveis para fins de conservação e manutenção.

O projeto nasceu de um artigo científico para o ENACOR 2026, que compara métodos clássicos (CDA) com métodos automáticos (Ward 1D e PELT). Dois scripts de produção foram extraídos do contexto de pesquisa: `segmentacao_homogenea_sgp.py` e `segmentacao_homogenea_sgp_v2.py`.

---

## 2. Estrutura de Arquivos

```
segmentacao-linear/
│
├── ── SCRIPTS DE PRODUÇÃO (alvo da versão simplificada) ──────────────────────
│   ├── segmentacao_homogenea_sgp.py        # v1 — produção, WARD + PELT por SRE
│   └── segmentacao_homogenea_sgp_v2.py     # v2 — idêntica à v1, versão atual
│
├── ── PIPELINE (biblioteca compartilhada) ────────────────────────────────────
│   └── pipeline/
│       ├── __init__.py
│       ├── preprocessing.py    # Leitura de dados + feature engineering
│       ├── clustering.py       # Todos os algoritmos de segmentação
│       ├── evaluation.py       # Métricas intrínsecas e extrínsecas
│       ├── audit.py            # Auditoria estatística avançada
│       ├── autoresearch.py     # Varredura sistemática de hiperparâmetros
│       ├── feature_catalog.py  # Catálogo central de features com glossário
│       ├── export_excel.py     # Exportação Excel estilizada
│       └── visualization.py   # Geração de gráficos Plotly
│
├── ── APPS STREAMLIT (pesquisa/artigo) ────────────────────────────────────────
│   ├── app.py                  # App comparativo: CDA × Ward 1D × PELT
│   └── app_artigo.py           # Idem, com variante CDA usando Dc
│
├── ── SCRIPTS DE EXPERIMENTO (pesquisa) ───────────────────────────────────────
│   ├── train.py                # AutoResearch — GO-020, varredura Ward+PELT
│   ├── train_pelt_deflexao.py  # AutoResearch foco PELT, deflexão
│   ├── autorun.py              # Execução em lote de experimentos
│   ├── autorun_experimentos.py # Idem, variante
│   ├── experimento_GO334.py    # Experimento rodovia GO-334
│   ├── go010_artigo_experimento.py # Experimento rodovia GO-010
│   ├── run_artigo.py           # Gera saídas do artigo
│   ├── artigo_completo_enacor.py  # Gera conteúdo do artigo ENACOR
│   ├── roteiro_enacor.py       # Roteiro da apresentação ENACOR
│   ├── gerar_artigo_word.py    # Gera documento Word do artigo
│   ├── check_output.py         # Verifica saídas geradas
│   ├── collect_results.py      # Coleta resultados de experimentos
│   ├── _analyze_results.py     # Analisa e ranqueia resultados
│   └── _top_results.py         # Exibe melhores configurações
│
├── ── DADOS DE ENTRADA ─────────────────────────────────────────────────────────
│   ├── 20260611-112405.xlsx    # Dataset principal (multi-SRE, produção)
│   ├── 010_dados_pesquisa.xlsx / _dc.xlsx  # GO-010 (pesquisa)
│   ├── iri_GO_334.xlsx / fwd_GO_334.xlsx   # GO-334 (pesquisa)
│   └── Segmentação homogênea_GO-020_apenas_est&deflec.xlsx  # GO-020
│
├── ── SAÍDAS E RESULTADOS ──────────────────────────────────────────────────────
│   ├── segmentacao_homogenea_sgp.xlsx      # Saída de produção validada
│   ├── segmentacao_homogenea_*.xlsx        # Saídas com timestamp
│   ├── results/                            # JSONs de experimentos
│   ├── artigo_enacor_v2/                   # Artefatos do artigo
│   ├── relatorio_experimentos/             # Relatórios de autorun
│   └── artigo_output/                      # Tabelas e figuras do artigo
│
└── requirements.txt                        # Dependências Python
```

---

## 3. Fluxo de Dados (Pipeline de Produção)

O pipeline de produção presente em `segmentacao_homogenea_sgp_v2.py` segue os seguintes passos:

```
Excel de entrada
    │  colunas: sre, km_inicial, km_final, iri_medio, d0, dc
    ▼
_preparar_sre_base()
    │  • Converte colunas para numérico
    │  • Remove linhas com km_inicial/km_final/iri_medio/deflexao nulos
    │  • Agrega pontos duplicados (sre, km_inicial, km_final) via média
    │  • Filtra trechos inválidos (km_final <= km_inicial)
    ▼
── Loop por SRE ──────────────────────────────────────────────────────────────
│   ▼
│   agregar_120m() → _preparar_segmentos_intervalares()
│       │  • Padroniza colunas para o padrão interno (km_ini, km_fim, km_centro,
│       │    comprimento_m, Deflexao, iri_medio, d0, dc)
│       │  • Converte km de km para metros (* 1000)
│       ▼
│   _enriquecer_segmentos()   [feature engineering]
│       │  Gera ~15 features derivadas por janela deslizante:
│       │  • Deflexao_std, Deflexao_max, Deflexao_min (rolling 3)
│       │  • Deflexao_caract = Deflexao + Deflexao_std
│       │  • CV_deflexao = Deflexao_std / Deflexao
│       │  • Deflexao_roll3, Deflexao_roll5 (médias móveis)
│       │  • Deflexao_slope (gradiente longitudinal)
│       │  • Deflexao_range_local = max - min local
│       │  • iri_std_local, iri_roll3, iri_roll5
│       │  • iri_max_local, iri_min_local, iri_range_local
│       │  • iri_slope (gradiente longitudinal do IRI)
│       │  • d0_iri_ratio = Deflexao / iri_medio
│       │  • d0_iri_interacao = Deflexao * iri_medio
│       │  • posicao_rel (posição normalizada 0–1 no SRE)
│       ▼
│   construir_features()
│       │  • Seleciona FEATURES_ARTIGO = ["Deflexao_caract", "iri_medio", "Deflexao"]
│       │  • Remove features com >50% de NaN
│       │  • Preenche NaN restantes com mediana
│       ▼
│   padronizar()   → StandardScaler (média=0, std=1)
│       ▼
│   _segmentar_metodo()
│       │  ┌─ WARD ─────────────────────────────────────────────────────────
│       │  │  ward1d_linear(X_scaled, k_eff)
│       │  │  • AgglomerativeClustering com linkage="ward"
│       │  │  • Matriz de conectividade tridiagonal (apenas vizinhos imediatos)
│       │  │  • k_eff = max(2, min(ward_k=10, n-1))
│       │  │  • Produz segmentos linearmente contíguos por construção
│       │  │
│       │  └─ PELT ─────────────────────────────────────────────────────────
│       │     pelt_segmentation(X_scaled, model="l2", min_size=3, pen=4)
│       │     • ruptures.Pelt — detecção exata de change-points
│       │     • Custo: l2 (soma quadrática intra-segmento)
│       │     • Penalização β=4 (balança número de segmentos)
│       │     • Gera segmentos contíguos por natureza
│       ▼
│   aplicar_regras_espaciais()
│       │  • Mescla segmentos < 600m com vizinho de menor desvio
│       │  • Divide segmentos > 5000m em partes iguais
│       │  • Iteração máx. 50 vezes até convergência
│       ▼
│   _segment_table()
│       │  • Calcula km_inicial e km_final de cada segmento homogêneo
│       │  • Média de iri_medio, d0, dc dentro do segmento
│       │  • Desvio padrão e CV de iri_medio e da deflexão usada
│       │  • Silhouette score da segmentação inteira
│       │  • XGBoost CV accuracy (proxy de explicabilidade)
│       │  • n_segmentos_sre: total de segmentos no SRE
└── fim do loop ──────────────────────────────────────────────────────────────
    ▼
gerar_excel_segmentacao()
    │  Gera 4 abas no Excel de saída:
    │  • WARD_d0  — Ward segmentando por d0 (deflexão central)
    │  • WARD_dc  — Ward segmentando por dc (deflexão característica)
    │  • PELT_d0  — PELT segmentando por d0
    │  • PELT_dc  — PELT segmentando por dc
    ▼
Excel de saída  (segmentacao_homogenea_YYYYMMDD_HHMMSS.xlsx)
```

---

## 4. Formato de Entrada

### Estrutura esperada do Excel

| Coluna       | Tipo    | Descrição                                              |
|--------------|---------|--------------------------------------------------------|
| `sre`        | str/int | Identificador da seção rodoviária (ex.: "GO-334-01")   |
| `km_inicial` | float   | Km de início do trecho (em **km**, ex.: 0.12)          |
| `km_final`   | float   | Km de fim do trecho (em **km**, ex.: 0.24)             |
| `iri_medio`  | float   | IRI médio do trecho (m/km) — condição funcional        |
| `d0`         | float   | Deflexão central FWD (×0.01mm) — condição estrutural   |
| `dc`         | float   | Deflexão característica = d0 + desvio padrão           |

- A primeira aba do Excel é lida por padrão (parâmetro `--sheet` para escolher outra).
- Linhas com `km_inicial`, `km_final`, `iri_medio` ou deflexão nulos são removidas.
- Trechos duplicados (mesmo sre+km_inicial+km_final) são agregados por média.
- O SRE precisa ter no mínimo **3 pontos** para ser processado.

---

## 5. Formato de Saída

Cada aba do Excel de saída (WARD_d0, WARD_dc, PELT_d0, PELT_dc) contém:

| Coluna                  | Descrição                                                    |
|-------------------------|--------------------------------------------------------------|
| `metodo`                | "WARD" ou "PELT"                                             |
| `atributo_deflexao`     | "d0" ou "dc"                                                 |
| `sre`                   | Identificador do SRE                                         |
| `sre_seg_h`             | ID do segmento homogêneo: `{sre}-{N}` (ex.: "GO334-3")      |
| `km_inicial`            | Km de início do segmento homogêneo                           |
| `km_final`              | Km de fim do segmento homogêneo                              |
| `desv_padrao_iri_medio` | Desvio padrão do IRI dentro do segmento                      |
| `cv_iri_medio`          | Coeficiente de variação do IRI (= std/média)                 |
| `iri`                   | IRI médio do segmento homogêneo                              |
| `d0`                    | Deflexão central média do segmento (todas as abas)           |
| `dc`                    | Deflexão característica média do segmento (todas as abas)    |
| `desv_padrao_d0`        | Desvio padrão de d0 (apenas nas abas _d0)                    |
| `cv_d0`                 | CV de d0 (apenas nas abas _d0)                               |
| `desv_padrao_dc`        | Desvio padrão de dc (apenas nas abas _dc)                    |
| `cv_dc`                 | CV de dc (apenas nas abas _dc)                               |
| `silhouette`            | Índice Silhouette da segmentação no SRE                      |
| `xgboost_accuracy_cv`   | Acurácia XGBoost 5-fold (proxy de qualidade, opcional)       |
| `n_segmentos_sre`       | Número total de segmentos homogêneos no SRE                  |

---

## 6. Parâmetros dos Algoritmos

### Classe `Params` (valores padrão de produção)

```python
@dataclass
class Params:
    min_comp_km: float = 0.6     # Comprimento mínimo de segmento = 600m
    max_comp_km: float = 5.0     # Comprimento máximo de segmento = 5000m
    ward_k: int = 10             # Número inicial de clusters para Ward
    pelt_model: str = "l2"       # Modelo de custo PELT: "l2" (soma quadrática)
    pelt_min_size: int = 3       # Mínimo de pontos por segmento PELT
    pelt_pen: int = 4            # Penalidade β do PELT
```

### Features usadas no clustering

```python
FEATURES_ARTIGO = ["Deflexao_caract", "iri_medio", "Deflexao"]
```
- `Deflexao_caract` = `Deflexao + Deflexao_std` (deflexão + variabilidade local)
- `iri_medio` = IRI médio do ponto
- `Deflexao` = valor de d0 ou dc, conforme a base sendo processada

---

## 7. Algoritmos Implementados

### 7.1. Ward 1D com Conectividade Espacial (`ward1d_linear`)

**Onde:** `segmentacao_homogenea_sgp_v2.py` + `pipeline/clustering.py`

```python
def ward1d_linear(X_scaled, k: int):
    conn = diags([1, 1], [-1, 1], shape=(n, n)).toarray()  # matriz tridiagonal
    agg = AgglomerativeClustering(n_clusters=k, linkage="ward", connectivity=conn)
    labels = agg.fit_predict(X_scaled)
    return labels, labels, agg
```

- Garante contiguidade espacial por construção (cada ponto só pode fundir com vizinhos).
- Não requer pós-processamento de linearização.
- `k=10` (padrão); efetivo = `max(2, min(10, n-1))`.

### 7.2. PELT — Pruned Exact Linear Time (`pelt_segmentation`)

**Onde:** `segmentacao_homogenea_sgp_v2.py` + `pipeline/clustering.py`

```python
def pelt_segmentation(X_scaled, model="l2", min_size=3, pen=4):
    import ruptures as rpt
    algo = rpt.Pelt(model=model, min_size=min_size, jump=1).fit(X_scaled)
    bkps = algo.predict(pen=pen)
    # converte breakpoints em labels contíguos
    ...
```

- Minimiza $\sum \mathcal{C}(segmento) + \beta \cdot m$ (Killick et al., 2012).
- `model="l2"`: custo = soma dos quadrados intra-segmento.
- `pen=4`: controla número de segmentos (maior pen → menos segmentos).
- Gera segmentos naturalmente contíguos.

### 7.3. Regras Espaciais (`aplicar_regras_espaciais`)

Pós-processamento aplicado a ambos os métodos:

1. **Mescla segmentos curtos** (< `min_comprimento_m=600m`): o segmento curto é absorvido pelo vizinho cujo desvio padrão conjunto é menor.
2. **Divide segmentos longos** (> `max_comprimento_m=5000m`): o segmento é dividido em partes com comprimento aproximadamente igual.
3. **Iteração** até convergência (máx. 50 iterações).

---

## 8. Módulos do Pipeline (Biblioteca Compartilhada)

### `pipeline/preprocessing.py`
- `carregar_dados(path)`: lê Excel/CSV e detecta colunas automaticamente.
- `_enriquecer_segmentos(seg)`: gera ~15 features derivadas por janela deslizante.
- `agregar_120m(df, ...)`: padroniza tabela segmentada para o formato interno.
- `construir_features(seg, vars_clustering)`: seleciona features e trata NaN.

### `pipeline/clustering.py`
Contém **todos** os algoritmos de segmentação, incluindo os não usados em produção:
- CDA, MCV, SHS (métodos clássicos de engenharia rodoviária)
- KMeans, Ward 1D, DBSCAN, HDBSCAN, Affinity Propagation, GMM, SOM, Spectral, UMAP+KMeans
- PELT (change-point)
- KNN, Random Forest (supervisionados adaptados)
- Ensemble (combinação de Ward + MCV + PELT)
- `linearizar_labels(labels)`: converte clusters livres em segmentos contíguos.
- `aplicar_regras_espaciais(...)`: aplica restrições de comprimento mínimo/máximo.

### `pipeline/evaluation.py`
- `avaliar_intrinseco(X_scaled, labels)`: Silhouette, Calinski-Harabász, Davies-Bouldin.
- `avaliar_extrinseco_xgb(X_scaled, labels)`: acurácia XGBoost 5-fold como proxy.
- `variancia_intra(seg, col_cluster, col_feature)`: variância dentro de cada cluster.
- `perfil_clusters(seg, col_cluster, features)`: média de cada feature por cluster.

### `pipeline/audit.py`
Usado apenas nos apps de pesquisa:
- `gap_statistic(X_scaled, max_k)`: determina k ótimo (Tibshirani, 2001).
- `estabilidade_bootstrap(X_scaled, labels, ...)`: robustez dos clusters.
- `teste_kruskal_wallis(seg, col_cluster, features)`: significância estatística.
- `homogeneidade_intra(seg, col_cluster, features)`: CV e std por cluster.
- `matriz_ari_cruzado(label_dict)`: concordância entre métodos (ARI).
- `feature_importance_xgb(X_scaled, labels, feature_names)`: importância de features.

### `pipeline/autoresearch.py`
Varredura sistemática de hiperparâmetros de todos os métodos. Usado pelos scripts de pesquisa (`train.py`, `autorun.py`, etc.). Não é usado em produção.

### `pipeline/feature_catalog.py`
Catálogo completo de todas as features com grupo, fórmula, descrição e interpretação. Inclui funções para gerar tabelas markdown e glossário para exportação.

### `pipeline/export_excel.py`
Exportação Excel com openpyxl: cabeçalhos estilizados, alternância de cores, formatação condicional (verde/amarelo/vermelho), gráficos nativos do Excel, glossário de termos.

### `pipeline/visualization.py`
Gráficos Plotly: perfil longitudinal com segmentos coloridos, histogramas, matrizes de correlação, silhouette plots.

---

## 9. Apps Streamlit (Pesquisa)

### `app.py` e `app_artigo.py`
Interface interativa para análise comparativa:
- Carrega Excel com dados de uma rodovia
- Executa CDA (manual), Ward 1D e PELT
- Exibe perfil longitudinal colorido por método
- Calcula e exibe métricas de avaliação (Silhouette, XGBoost, etc.)
- Gera relatório Excel formatado
- Botão de download dos resultados

**Para rodar:** `streamlit run app.py` ou `streamlit run app_artigo.py`

---

## 10. Scripts de Pesquisa e Experimentos

| Script                        | Descrição                                                       |
|-------------------------------|-----------------------------------------------------------------|
| `train.py`                    | AutoResearch GO-020: varredura completa Ward+PELT+KMeans+Ensemble |
| `train_pelt_deflexao.py`      | Foco em PELT para dados de deflexão                             |
| `autorun.py`                  | Executa múltiplos experimentos em sequência                     |
| `autorun_experimentos.py`     | Variante do autorun com configurações específicas               |
| `experimento_GO334.py`        | Experimento específico para a rodovia GO-334                    |
| `go010_artigo_experimento.py` | Experimento específico para a rodovia GO-010                    |
| `run_artigo.py`               | Gera figuras e tabelas para o artigo ENACOR                     |
| `artigo_completo_enacor.py`   | Gera rascunho completo do artigo                                |
| `roteiro_enacor.py`           | Roteiro para apresentação oral no ENACOR                        |
| `gerar_artigo_word.py`        | Exporta o artigo para formato Word (.docx)                      |
| `check_output.py`             | Verifica integridade dos arquivos de saída                      |
| `collect_results.py`          | Coleta e consolida resultados de múltiplos experimentos         |
| `_analyze_results.py`         | Analisa distribuição dos resultados                             |
| `_top_results.py`             | Lista melhores configurações por métrica                        |

---

## 11. Dependências

```
streamlit>=1.28      # Apps web interativos (apenas pesquisa)
pandas>=1.5          # Manipulação de dados
numpy>=1.23          # Operações numéricas
scipy>=1.10          # Matrizes esparsas (conectividade Ward)
scikit-learn>=1.2    # AgglomerativeClustering, StandardScaler, Silhouette
matplotlib>=3.6      # Gráficos estáticos
seaborn>=0.12        # Visualizações estatísticas
plotly>=5.13         # Gráficos interativos
hdbscan>=0.8.33      # HDBSCAN (apenas pesquisa)
minisom>=2.3         # Self-Organizing Maps (apenas pesquisa)
ruptures>=1.1        # PELT (change-point detection) ← NECESSÁRIO
umap-learn>=0.5      # UMAP (apenas pesquisa)
xgboost>=1.7         # Avaliação extrínseca (opcional, graceful degradation)
openpyxl>=3.0        # Leitura/escrita de Excel ← NECESSÁRIO
tabulate>=0.9        # Tabelas texto
```

**Dependências mínimas para a versão simplificada (apenas Ward + PELT):**
- `pandas`, `numpy`, `scipy`, `scikit-learn`, `ruptures`, `openpyxl`
- `xgboost` é opcional (o código degrada graciosamente sem ele)

---

## 12. Como Executar (Produção)

```bash
# Ativar ambiente conda
conda activate SGP

# Execução básica
python segmentacao_homogenea_sgp_v2.py --input 20260611-112405.xlsx

# Com arquivo de saída explícito
python segmentacao_homogenea_sgp_v2.py --input 20260611-112405.xlsx --output resultado.xlsx

# Com aba específica
python segmentacao_homogenea_sgp_v2.py --input 20260611-112405.xlsx --sheet "Dados" --output resultado.xlsx
```

---

## 13. O que NÃO existe na versão de produção atual

Os seguintes elementos são **exclusivos da camada de pesquisa** e devem ser removidos/não replicados na versão simplificada:

1. **CDA (Cumulative Difference Algorithm)** — método manual, só nos apps Streamlit.
2. **MCV, SHS, KMeans, DBSCAN, HDBSCAN, GMM, SOM, Spectral, UMAP, Ensemble** — apenas `pipeline/clustering.py` para pesquisa.
3. **Gap Statistic, Bootstrap stability, Kruskal-Wallis** — `pipeline/audit.py`, só para pesquisa.
4. **AutoResearch / varredura de hiperparâmetros** — `pipeline/autoresearch.py`.
5. **Streamlit UI** — `app.py`, `app_artigo.py`.
6. **Métricas Calinski-Harabász e Davies-Bouldin** — só calculadas nos apps de pesquisa.
7. **Gráficos (Plotly/Matplotlib)** — `pipeline/visualization.py`.
8. **Exportação Excel estilizada** — `pipeline/export_excel.py`; a versão de produção usa `pd.ExcelWriter` simples.
9. **Datasets específicos de pesquisa** — `010_dados_pesquisa.xlsx`, `iri_GO_334.xlsx`, etc.
10. **Relatórios em Markdown** — `artigo_enacor/`, `artigo_enacor_v2/`, `relatorio_experimentos/`.

---

## 14. Objetivo para o Agente: Versão Utilizável Simplificada

### O que deve existir

A versão simplificada deve ser um **script Python de linha de comando** (sem Streamlit, sem pesquisa) que:

1. **Aceite qualquer Excel** como entrada, desde que contenha as colunas: `sre`, `km_inicial`, `km_final`, `iri_medio`, `d0`, `dc`.
2. **Execute apenas Ward 1D e PELT** (os dois métodos validados no artigo).
3. **Processe cada SRE independentemente** em loop.
4. **Aplique as regras espaciais** de comprimento mínimo (600m) e máximo (5km).
5. **Exporte o resultado em Excel** com as 4 abas: `WARD_d0`, `WARD_dc`, `PELT_d0`, `PELT_dc`.
6. **Seja parametrizável** via CLI: `--input`, `--output`, `--sheet`, e opcionalmente `--ward-k`, `--pelt-pen`, `--min-km`, `--max-km`.
7. **Seja robusto** a NaN, SREs com poucos pontos (< 3), etc.
8. **Não dependa de Streamlit**, Plotly, Matplotlib, HDBSCAN, minisom, umap-learn.

### O que pode ser preservado (mas simplificado)

- A lógica de `_enriquecer_segmentos()` para gerar as 3 features usadas.
- A função `aplicar_regras_espaciais()` (regras de comprimento).
- A geração da tabela de saída com as colunas documentadas na seção 5.
- O cálculo de Silhouette (é rápido e útil para diagnóstico).
- O cálculo de XGBoost accuracy pode ser **opcional** (flag `--sem-xgb`).

### Referência de implementação

O arquivo `segmentacao_homogenea_sgp_v2.py` já é a base ideal: é autocontido (~750 linhas), não depende dos módulos de pesquisa, e implementa exatamente o pipeline descrito acima. A versão simplificada pode partir dele, com melhorias de usabilidade (CLI mais completa, logging informativo, validação de entrada mais clara).

---

## 15. Contexto de Negócio

- **SGP**: Sistema de Gerenciamento de Pavimentos da Dynatest.
- **SRE**: Seção Rodoviária de Estudo — unidade básica de gerência de pavimentos.
- **FWD**: Falling Weight Deflectometer — equipamento que mede deflexão estrutural.
- **d0**: deflexão central (sensor central do FWD), em ×0.01mm.
- **dc**: deflexão característica = d0 médio + desvio padrão (mais conservador).
- **IRI**: International Roughness Index — mede irregularidade superficial (m/km).
- **Segmento homogêneo**: sub-trecho com comportamento estrutural/funcional uniforme, usado para planejar intervenções de manutenção.
- A segmentação é feita **separadamente para d0 e dc** pois diferentes departamentos/normas usam cada um.
