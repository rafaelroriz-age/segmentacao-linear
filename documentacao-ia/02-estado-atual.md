# 02 — Estado Atual: o que quero fazer agora

> Este é o ponto de trabalho mais recente e a **principal dúvida** que quero levar
> a um modelo de IA. Foco em `segmentacao-linear/segmentacao_rede.ipynb`.

## O script atual: `segmentacao_rede.ipynb`

Script de **segmentação de toda a malha** (vários SREs de uma vez), a partir de um
único arquivo Excel (`sre_seg_200m_07_corrigida.xlsx`) contendo, por intervalo de
~200 m: `sre`, `km_inicial`, `km_final`, `igg`, `iri_medio`, `d0`.

Internamente ele:
1. Agrega por SRE/intervalo e calcula `aca` = `cumsum(d0 − média(d0))` dentro de cada SRE.
2. Segmenta cada SRE com **PELT** (`ruptures`), usando uma **penalidade proporcional à extensão** (quociente de rede).
3. Produz gráficos por SRE e exporta planilha com os segmentos.

### A penalidade "quociente de rede"

Em vez de uma penalidade fixa, a penalidade é **proporcional ao comprimento do SRE**:

```
pen = α_km × extensão_km
```

- `α_km` é o **quociente de penalidade** (penalidade por km), calibrado num SRE de referência (320EGO0130).
- Para a malha: `α_km_aca ≈ 0.297` (estrutural) e `α_km_func ≈ 0.119` (funcional).
- Assim, um SRE de 10 km e um de 30 km tendem a produzir densidades de quebra semelhantes.

## O que quero mudar (direção atual)

Concluí que a **subsegmentação em duas etapas** é o caminho, mas as **fronteiras dos
subsegmentos precisam cair nos pontos de mudança**, e não apenas "maximizar a
homogeneidade intra-segmento".

### 1. Subsegmentação em duas etapas (hierárquica)

Em vez de segmentar o SRE inteiro com um único PELT:

- **Etapa 1 — base funcional (grosseira):** PELT `l2` sobre `igg` (mudança de nível), gerando segmentos-base grandes.
- **Etapa 2 — subsegmentação estrutural (fina):** dentro de cada segmento-base, PELT `clinear` sobre `aca`, gerando subsegmentos que seguem as mudanças de tendência do CDA.

> Referência de implementação: `segmentacao_duas_etapas_hierarquica_v6.ipynb`.

### 2. Margem no quociente de penalidade

Em vez de usar uma penalidade única `pen = α_km × extensão`, testar uma **banda** em
torno desse valor e **escolher a penalidade que melhor quebra nos pontos de mudança**:

```
penalidades candidatas ∈ [α_km × extensão × (1 − margem), α_km × extensão × (1 + margem)]
```

- Na Etapa 2, a escolha é feita por **F1 contra os pontos de mudança do CDA** (e não por BIC/variância intra-segmento).
- Parâmetros atuais no notebook: `MARGEM_PEN = 0.5` (±50%), `N_CAND_PEN = 9` candidatos.

### 3. Quebrar nos pontos de mudança (e não na homogeneidade)

O objetivo principal mudou: **a fronteira deve coincidir com o ponto de mudança real**
(extremo local da diferença acumulada suavizada), mesmo que isso deixe o segmento com
CV interno maior. Para isso:

- **Snap:** cada quebra do PELT é "puxada" para o extremo CDA mais próximo (dentro de `SNAP_TOL`).
- **Seleção por F1:** entre as penalidades candidatas, vence a que maximiza o casamento (F1 com margem) entre as quebras e os extremos CDA.
- **Referência CDA:** os pontos de mudança são `cda_reference_bkps(aca, janela)` — extremos locais da acumulada suavizada.

## Dúvidas/desafios atuais (resumo)

1. Como garantir que a quebra caia **exatamente** nos momentos de mudança, sem depender tanto do valor do `pen`?
2. Como calibrar a **margem** do quociente de penalidade de forma robusta (sem overfitting a um SRE)?
3. Como equilibrar "quebrar onde muda" com os requisitos operacionais de comprimento mínimo/máximo?
4. A Etapa 2 com `clinear` + snap ao CDA é a melhor abordagem, ou existe um detector de change-point mais direto para os pontos de mudança do CDA?

## Parâmetros-chave do notebook (`segmentacao_rede.ipynb`)

| Parâmetro | Valor atual | Papel |
|---|---|---|
| `MIN_SIZE` | 2 | nº mínimo de intervalos (~400 m) por segmento |
| `JUMP` | 1 | precisão da busca do ponto de quebra |
| `MODEL_FUNC` | `l2` | custo funcional (igg) |
| `MODEL_ESTRUT` | `clinear` | custo estrutural (aca) |
| `ALPHA_KM_ACA` | 0.297 | quociente de penalidade estrutural (por km) |
| `ALPHA_KM_FUNC` | 0.119 | quociente de penalidade funcional (por km) |
| `MARGEM_PEN` | 0.5 | margem (±50%) no quociente de penalidade |
| `N_CAND_PEN` | 9 | nº de penalidades candidatas na banda |
| `CDA_JANELA` | 8 | janela de suavização p/ achar extremos do CDA |
| `SNAP_TOL` | 4 | tolerância (intervalos) do snap ao extremo CDA |
| `F1_MARGIN` | 4 | tolerância (intervalos) p/ casar quebra ⇄ ponto de mudança |
