# 03 — O Artigo (ENACOR 2026)

> Fonte completa: `segmentacao-linear/artigo_enacor_v2/ARTIGO_ENACOR_2026.md`.
> Título: *"Segmentação Linear Homogênea de Pavimentos: Comparação entre Métodos
> Clássicos, Clustering Não-Supervisionado, Change-Point, Aprendizado Supervisionado e Ensemble"*.

## O que o artigo faz

Compara métodos de segmentação homogênea aplicados a dados reais da rodovia **GO-010**
(265 registros, ~52,57 km, intervalos elementares médios de ~198 m), usando `d0`
(estrutural) e `iri_medio` (funcional) como núcleo da análise.

## Métodos comparados

| Grupo | Métodos |
|---|---|
| **Clássicos (univariados)** | CDA (Cumulative Difference) e MCV (Method of Concomitant Variations) |
| **Clustering** | K-Means (com linearização 1D) e Ward 1D (com conectividade espacial) |
| **Change-point** | PELT (Pruned Exact Linear Time) |
| **Supervisionado** | Random Forest (refinamento iterativo com predição OOB) |
| **Ensemble** | Consenso de fronteira Ward 1D + MCV + PELT |

## Métricas usadas (sem ground truth)

- **Intrínsecas:** Silhouette, Davies-Bouldin, Calinski-Harabász.
- **Extrínseca (proxy):** acurácia de um XGBoost treinado para prever os rótulos a partir das features (quanto mais "explicável", melhor).
- **Operacional:** nº de segmentos dentro do intervalo de comprimento 600 m – 4000 m.

## Resultados principais

| Método | N segmentos | Silhouette | DB | CH | R² XGBoost D0 (%) |
|---|---|---|---|---|---|
| CDA | 16 | −0.266 | 6.82 | 11.02 | 51.4 |
| Ensemble | 16 | −0.224 | 5.50 | 11.23 | 52.2 |
| K-Means | 20 | −0.242 | 12.97 | 14.09 | 60.2 |
| MCV | 20 | −0.241 | 8.98 | 10.56 | 51.6 |
| **PELT** | **14** | **−0.211** | **6.27** | **12.63** | **51.9** |
| Random Forest | 30 | −0.289 | 7.26 | 8.75 | 57.3 |
| Ward 1D | 14 | −0.208 | 5.94 | 12.77 | 51.5 |

### Conclusões do artigo

- **PELT** (`combo_roll_z`, β=43.666) foi a melhor configuração global: 14 segmentos, melhor equilíbrio separação × interpretabilidade.
- **Ward 1D** (k=2) foi a principal alternativa multivariada com contiguidade garantida.
- A **restrição de comprimento (600–4000 m)** é decisiva: sem ela, métodos como CDA/MCV/K-Means/Random Forest fragmentam demais.
- O piso operacional do trecho era **14 segmentos** (comprimento total / 4000 m).
- Recomenda-se ampliar features (bacia deflectométrica, espessuras, módulos retroanalisados, histórico).

## Implicação para o trabalho atual

O artigo validou PELT e Ward 1D como os melhores métodos. O trabalho **atual**
(`segmentacao_rede.ipynb`) estende o PELT para **malha inteira**, com penalidade
proporcional à extensão e uma lógica de **subsegmentação em duas etapas** que prioriza
**quebrar nos pontos de mudança** (extremos do CDA) em vez de maximizar a homogeneidade.
