# Documentação para IA — Segmentação Homogênea de Pavimentos (SGP)

> **Objetivo desta pasta:** reunir, em arquivos Markdown autocontidos, tudo o que um
> modelo de IA (ex.: Claude) precisa saber para entender o projeto de **segmentação
> homogênea linear de pavimentos** e ajudar nas próximas etapas. Os arquivos podem
> ser colados individualmente ou em conjunto.

---

## Índice de arquivos

| Arquivo | Conteúdo |
|---|---|
| `01-objetivo.md` | O que é a segmentação homogênea e por que o SGP precisa dela (contexto de negócio + técnico). |
| `02-estado-atual.md` | O que está sendo desenvolvido **agora** (subsegmentação em duas etapas, margem no quociente de penalidade, quebrar nos pontos de mudança). |
| `03-artigo-enacor.md` | Resumo do artigo ENACOR 2026 (CDA × Ward 1D × PELT) — métodos, resultados e conclusões. |
| `04-historico.md` | Linha do tempo do que já foi feito (pesquisa → produção → segmentação em malha). |
| `05-scripts.md` | Descrição dos scripts principais, formatos de entrada/saída e parâmetros. |
| `06-perguntas-para-o-modelo.md` | As dúvidas e pedidos específicos para o modelo de IA ajudar. |

---

## Como usar com o Claude

1. Abra `06-perguntas-para-o-modelo.md` e deixe clara a sua pergunta atual.
2. Cole primeiro `01-objetivo.md` e `02-estado-atual.md` (contexto mínimo).
3. Se precisar de contexto sobre o que já foi validado, cole `03-artigo-enacor.md` e `04-historico.md`.
4. `05-scripts.md` é útil quando a pergunta envolve código/implementação.

**Sugestão de prompt inicial para o Claude:**

> "Você é um especialista em segmentação homogênea de pavimentos e em detecção de
> pontos de mudança (change-point detection). Leia os arquivos a seguir como contexto
> do projeto e me ajude com a pergunta do arquivo `06-perguntas-para-o-modelo.md`."

---

## Glossário rápido (termos usados em todos os arquivos)

- **SGP** — Sistema de Gerenciamento de Pavimentos da Dynatest.
- **SRE** — Seção Rodoviária de Estudo (unidade básica de gerência).
- **FWD** — Falling Weight Deflectometer (mede deflexão estrutural).
- **d0** — deflexão central máxima da bacia FWD (µm) — resposta **estrutural**.
- **dc** — deflexão característica = d0 + desvio padrão (mais conservadora).
- **IRI** — International Roughness Index (m/km) — resposta **funcional**.
- **IGG** — índice funcional derivado (usado junto ao IRI na segmentação em malha).
- **aca / CDA** — diferença acumulada (Cumulative Difference Approach): `cumsum(x − média)`; seus extremos locais marcam "pontos de mudança".
- **PELT** — Pruned Exact Linear Time (algoritmo de detecção de change-points, `ruptures`).
- **Ward 1D** — clustering hierárquico com conectividade espacial (segmentos contíguos por construção).
- **CDA** — Cumulative Difference Approach (método clássico AASHTO/DNIT).
- **Penalidade (β / pen)** — parâmetro do PELT que controla o nº de quebras (maior → menos segmentos).
- **Quociente de penalidade (α_km)** — penalidade por quilômetro (`pen = α_km × extensão_km`), calibrada em um SRE de referência.
