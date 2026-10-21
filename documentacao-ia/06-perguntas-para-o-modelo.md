# 06 — Perguntas para o Modelo de IA

> Cole este arquivo por último (ou apenas ele) como a sua "pergunta" ao Claude.

## Contexto em uma frase

Estou fazendo **segmentação homogênea de pavimentos** (SGP/Dynatest) com **PELT**,
e quero que as quebras coincidam com os **pontos reais de mudança** do pavimento
(extremos da diferença acumulada do CDA), em vez de simplesmente maximizar a
homogeneidade intra-segmento.

## Pergunta principal

**Como fazer o PELT quebrar exatamente nos pontos de mudança (extremos do CDA), e
como calibrar de forma robusta uma "margem" no quociente de penalidade para isso?**

Detalhes do que já tenho (ver `02-estado-atual.md`):
- Penalidade por quociente de rede: `pen = α_km × extensão_km` (`α_km_aca ≈ 0.297`).
- Subsegmentação em duas etapas: Etapa 1 (l2 sobre igg, base) → Etapa 2 (clinear sobre aca, subsegmentos).
- Snap das quebras aos extremos CDA (`SNAP_TOL`) e seleção da penalidade por **F1** contra esses extremos.
- Margem no quociente: banda `±MARGEM_PEN` com `N_CAND_PEN` candidatos.

## Perguntas específicas

1. **Detector de change-point:** Para quebrar *nos extremos do CDA*, o `clinear` + snap ao CDA é a melhor escolha, ou seria melhor usar diretamente os extremos do CDA como fronteiras (com validação PELT), ou ainda um detector tipo *kernel change-point* (rbf) / CUSUM / *BottomUp*?

2. **Margem do quociente de penalidade:** qual a forma mais robusta de calibrar `MARGEM_PEN` e `N_CAND_PEN` sem overfitting ao SRE de referência (320EGO0130)? Faz sentido selecionar a penalidade por F1 contra o CDA, ou há critério melhor (ex.: número de quebras esperado, validação cruzada por SRE)?

3. **Equilíbrio mudança × comprimento:** como conciliar "quebrar onde muda" com os limites operacionais de comprimento mínimo/máximo (600 m – 5 km)? A fusão de segmentos curtos deve ocorrer antes ou depois do snap ao CDA?

4. **Seleção da penalidade na Etapa 1:** hoje uso BIC sobre o sinal `igg` (l2). Faz sentido usar também uma referência de "pontos de mudança funcional" (ex.: mudanças de nível significativas) em vez de BIC?

5. **Sinais:** estou usando `d0` (estrutural) e `igg`/`iri_medio` (funcional). Devo incluir `dc` (deflexão característica) ou outros sinais derivados na Etapa 2?

## O que eu gostaria de receber

- Uma explicação conceitual clara da melhor forma de **detectar pontos de mudança** e **posicionar as fronteiras** neles.
- Recomendações concretas de **parâmetros** (margem, janela do CDA, snap, min_size) e como calibrá-los.
- Se aplicável, **código Python (ruptures/scikit-learn)** que implemente a abordagem recomendada, compatível com `segmentacao_rede.ipynb`.
