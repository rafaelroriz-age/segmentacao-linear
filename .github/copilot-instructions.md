# Instruções para GitHub Copilot — Segmentação Homogênea SGP

## Contexto do projeto

Este repositório implementa um sistema de **segmentação homogênea linear de pavimentos rodoviários** para o SGP (Sistema de Gerência de Pavimentos) da Dynatest. O domínio é engenharia de pavimentos — familiarize-se com os termos antes de sugerir alterações.

## Ambiente de execução

- **Conda env:** `SGP` (`C:/Users/dynatest/anaconda3/envs/SGP/python.exe`)
- **Python:** 3.10+
- **Ativar:** `conda activate SGP`

## Arquitetura

Todo o processamento de dados vive em `pipeline/`. Os scripts na raiz são entry points que importam de `pipeline/`.

| Módulo | Responsabilidade |
|---|---|
| `pipeline/preprocessing.py` | Leitura Excel, normalização, feature engineering |
| `pipeline/clustering.py` | Algoritmos de segmentação (CDA, Ward, PELT, K-Means, GMM…) |
| `pipeline/evaluation.py` | Métricas Silhouette, Calinski-Harabász, XGBoost extrínseco |
| `pipeline/audit.py` | Gap Statistic, Bootstrap, Kruskal-Wallis, ARI cruzado |
| `pipeline/visualization.py` | Gráficos Plotly para Streamlit |
| `pipeline/export_excel.py` | Excel formatado com openpyxl |
| `pipeline/autoresearch.py` | Varredura de hiperparâmetros |

## Convenções obrigatórias

- **Unidades internas:** `km_ini` / `km_fim` em **metros**. Saída para usuário usa sufixo `_km`.
- **Deflexão genérica:** sempre renomeada para `Deflexao` internamente, independente de ser d0 ou dc.
- **Contiguidade espacial:** qualquer novo método de clustering DEVE chamar `linearizar_labels()` antes de `aplicar_regras_espaciais()`.
- **Restrição de comprimento:** padrão 0,6–5,0 km por segmento. Nunca remover sem flag explícito.
- **NaN:** interpolar com `pd.Series.interpolate(limit_direction="both")`, não dropar pontos intermediários.
- **Por SRE:** cada SRE é processado independentemente; não acumular estado entre grupos.

## Padrão de retorno dos métodos de clustering

Todos os métodos em `pipeline/clustering.py` retornam a tupla:
```python
(labels: np.ndarray, raw_output, fitted_object)
```

## Input/Output do script de produção

**Entrada:** Excel com colunas `sre`, `km_inicial`, `km_final`, `iri_medio`, `d0`, `dc`

**Saída:** Excel com abas `WARD_d0`, `WARD_dc`, `PELT_d0`, `PELT_dc`

## O que NÃO fazer

- Não refatorar `aplicar_regras_espaciais()` sem testes — contém lógica de merge iterativo sensível.
- Não usar `df.dropna()` em colunas de features intermediárias; usar interpolação.
- Não assumir continuidade entre SREs diferentes no mesmo arquivo.
- Não alterar o nome da coluna `Deflexao` sem atualizar `FEATURES_ARTIGO` em `segmentacao_homogenea_sgp_v2.py`.

## Dependências especiais

- `ruptures` — PELT (change-point detection)
- `xgboost` — avaliação extrínseca de clusters
- `openpyxl` — exportação Excel (não usar xlwt/xlrd)
- `hdbscan`, `minisom`, `umap-learn` — métodos alternativos (opcionais)
