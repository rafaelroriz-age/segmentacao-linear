# 04 — Histórico: o que já foi feito

## Linha do tempo

### Fase 1 — Pesquisa e artigo (ENACOR 2026)
- Criação do **pipeline de pesquisa** em `pipeline/` (preprocessing, clustering, evaluation, audit, autoresearch, visualization, export_excel).
- Implementação de **todos** os métodos: CDA, MCV, SHS, K-Means, Ward 1D, GMM, DBSCAN, HDBSCAN, SOM, Spectral, UMAP+KMeans, PELT, KNN, Random Forest, Ensemble.
- Apps Streamlit (`app.py`, `app_artigo.py`) para comparação interativa.
- Varredura de hiperparâmetros (AutoResearch) e geração do artigo (`artigo_enacor_v2/`).
- **Conclusão:** PELT e Ward 1D são os métodos vencedores.

### Fase 2 — Produção (Ward 1D + PELT por SRE)
- Extração de scripts de produção autocontidos:
  - `segmentacao_homogenea_sgp.py` (v1)
  - `segmentacao_homogenea_sgp_v2.py` (v2, atual)
- Pipeline de produção: agrega 120 m → feature engineering → Ward/PELT → regras espaciais (600 m – 5 km) → Excel com 4 abas (`WARD_d0`, `WARD_dc`, `PELT_d0`, `PELT_dc`).
- Parâmetros de produção: `min_comp_km=0.6`, `max_comp_km=5.0`, `ward_k=10`, `pelt_pen=4`.

### Fase 3 — Segmentação em malha (rede completa)
- Evolução para segmentar **vários SREs de uma vez** a partir de um único arquivo de malha (`sre_seg_200m_07_corrigida.xlsx`).
- Introdução da **penalidade por quociente de rede** (`pen = α_km × extensão_km`), calibrada no SRE 320EGO0130, para dar densidade de quebra consistente entre SREs de comprimentos diferentes.
- Scripts: `segmentacao_metodologia_rede.ipynb` e `segmentacao_rede.ipynb`.

### Fase 4 — Subsegmentação em duas etapas (em andamento)
- Experimentos de **subsegmentação hierárquica**:
  - `segmentacao_duas_etapas_hierarquica.ipynb` … `_v6.ipynb`
  - `segmentacao_duas_etapas_sensibilidade.ipynb`
  - `segmentacao_duas_etapas_d0_zi.ipynb`
- Conceito: **Etapa 1** segmenta base funcional (l2), **Etapa 2** subsegmenta estrutural (clinear sobre `aca`) dentro de cada base, com snap aos extremos do CDA.
- **Direção atual (ver `02-estado-atual.md`):** aplicar essa subsegmentação no `segmentacao_rede.ipynb`, com **margem no quociente de penalidade** e priorizando **quebrar nos pontos de mudança**.

## O que já funciona / está validado

- [x] Ward 1D com conectividade tridiagonal → segmentos contíguos.
- [x] PELT (`l2` e `clinear`) com penalidade configurável.
- [x] Regras espaciais de comprimento mínimo/máximo.
- [x] Métricas intrínsecas (Silhouette, CH, DB) e proxy extrínseco (XGBoost).
- [x] Exportação Excel (produção) e estilizada (pesquisa).
- [x] Penalidade por quociente de rede em malha.
- [x] Snap das quebras PELT aos extremos do CDA.
- [x] Seleção de penalidade por F1 contra os pontos de mudança (Etapa 2).

## O que ainda está aberto (ver `06-perguntas-para-o-modelo.md`)

- [ ] Garantir que as fronteiras caiam **exatamente** nos pontos de mudança.
- [ ] Calibrar a margem do quociente de penalidade de forma robusta.
- [ ] Equilibrar "quebrar onde muda" × comprimentos operacionais.
- [ ] Avaliar se `clinear` + snap é o melhor detector, ou se há alternativa mais direta.
