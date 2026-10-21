# 01 — Objetivo da Segmentação

## Contexto de negócio

A Dynatest Engenharia desenvolve o **SGP (Sistema de Gerenciamento de Pavimentos)**.
Uma das etapas centrais do SGP é a **segmentação homogênea linear de rodovias**:
dividir cada trecho rodoviário (SRE) em sub-trechos contíguos com comportamento
estrutural e funcional *uniforme*, para que cada unidade seja gerenciável e possa
receber decisões de manutenção/restauração específicas.

Na prática, isso significa transformar um perfil longitudinal de dados (deflexão
FWD `d0`, irregularidade `iri_medio`, índices `igg`) em **fronteiras (breakpoints)**
ao longo do km, delimitando segmentos homogêneos.

## Por que segmentar

- **Gestão:** segmentos homogêneos permitem atribuir uma única condição/intervenção por trecho.
- **Engenharia:** evita que um valor médio "dilua" trechos muito diferentes.
- **Normativo:** alinhado a AASHTO / DNIT (método CDA) e a práticas de SGP.

## As duas dimensões do problema

O pavimento é caracterizado por **duas respostas complementares**:

| Dimensão | Variável | Sinal | O que mede |
|---|---|---|---|
| **Estrutural** | `d0` (deflexão) | `aca` = diferença acumulada de `d0` | capacidade de carga do pavimento |
| **Funcional** | `iri_medio`, `igg` | nível do próprio sinal | conforto/rugosidade superficial |

A segmentação ideal leva as duas em conta, mas historicamente cada dimensão é
segmentada com uma "família" de método diferente:
- **Funcional** → mudança de **nível** (modelo `l2` no PELT).
- **Estrutural** → mudança de **inclinação/tendência** da diferença acumulada (modelo `clinear` no PELT + extremos do CDA).

## O que se busca em uma boa segmentação

1. **Fronteiras que coincidam com pontos reais de mudança** de comportamento do pavimento (não apenas segmentos estatisticamente "uniformes").
2. **Comprimentos operacionalmente viáveis** — em geral um mínimo (~600 m) e um máximo (~4–5 km) por segmento.
3. **Homogeneidade intra-segmento** razoável (baixo CV/desvio de `d0`, `iri`), mas **sem fragmentação excessiva**.
4. **Reprodutibilidade e aplicabilidade em malha inteira** (processar centenas de SREs de uma vez).

## Terminologia importante

- **Segmento homogêneo:** sub-trecho contíguo com comportamento estrutural/funcional uniforme.
- **Fronteira / breakpoint:** km onde um segmento termina e outro começa.
- **Ponto de mudança (change point):** extremo local da diferença acumulada (CDA) ou mudança abrupta de nível do sinal — é onde *idealmente* a fronteira deve cair.
