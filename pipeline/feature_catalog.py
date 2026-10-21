"""Catalogo central de features e termos do pipeline."""

from __future__ import annotations

import pandas as pd


FEATURE_CATALOG = {
    'Deflexao': {
        'grupo': 'Base estrutural',
        'descricao': 'Valor medio de d0 do segmento. Representa a resposta estrutural basica do pavimento.',
        'formula': 'd0',
        'interpretacao': 'Valores maiores indicam maior deformabilidade estrutural.',
    },
    'Deflexao_caract': {
        'grupo': 'Base estrutural',
        'descricao': 'Deflexao caracteristica, combinando nivel medio e dispersao local.',
        'formula': 'Deflexao + Deflexao_std',
        'interpretacao': 'Medida mais conservadora do comportamento estrutural.',
    },
    'Deflexao_std': {
        'grupo': 'Dispersao',
        'descricao': 'Desvio padrao local da deflexao.',
        'formula': 'std local de d0',
        'interpretacao': 'Valores altos indicam heterogeneidade estrutural na vizinhanca.',
    },
    'Deflexao_max': {
        'grupo': 'Dispersao',
        'descricao': 'Maior deflexao observada na vizinhanca local.',
        'formula': 'max local de d0',
        'interpretacao': 'Ajuda a identificar picos estruturais.',
    },
    'Deflexao_min': {
        'grupo': 'Dispersao',
        'descricao': 'Menor deflexao observada na vizinhanca local.',
        'formula': 'min local de d0',
        'interpretacao': 'Ajuda a identificar vales estruturais.',
    },
    'CV_deflexao': {
        'grupo': 'Dispersao',
        'descricao': 'Coeficiente de variacao da deflexao.',
        'formula': 'Deflexao_std / Deflexao',
        'interpretacao': 'Mede variabilidade relativa, nao apenas absoluta.',
    },
    'Deflexao_roll3': {
        'grupo': 'Suavizacao',
        'descricao': 'Media movel centrada da deflexao em janela de 3 segmentos.',
        'formula': 'media movel 3 pontos de d0',
        'interpretacao': 'Suaviza ruido local preservando variacoes de curta distancia.',
    },
    'Deflexao_roll5': {
        'grupo': 'Suavizacao',
        'descricao': 'Media movel centrada da deflexao em janela de 5 segmentos.',
        'formula': 'media movel 5 pontos de d0',
        'interpretacao': 'Suavizacao mais forte, adequada para macrozonas.',
    },
    'Deflexao_slope': {
        'grupo': 'Tendencia',
        'descricao': 'Gradiente longitudinal da deflexao entre segmentos vizinhos.',
        'formula': 'gradiente de d0',
        'interpretacao': 'Mostra se a resposta estrutural esta aumentando ou diminuindo ao longo da via.',
    },
    'Deflexao_range_local': {
        'grupo': 'Dispersao',
        'descricao': 'Amplitude local da deflexao.',
        'formula': 'Deflexao_max - Deflexao_min',
        'interpretacao': 'Quantifica o contraste estrutural na regiao.',
    },
    'iri_medio': {
        'grupo': 'Base funcional',
        'descricao': 'Indice de irregularidade longitudinal medio do segmento.',
        'formula': 'IRI medio',
        'interpretacao': 'Representa a condicao funcional do pavimento.',
    },
    'iri_std_local': {
        'grupo': 'Dispersao',
        'descricao': 'Desvio padrao local do IRI.',
        'formula': 'std local de IRI',
        'interpretacao': 'Indica instabilidade funcional na vizinhanca.',
    },
    'iri_roll3': {
        'grupo': 'Suavizacao',
        'descricao': 'Media movel centrada do IRI em janela de 3 segmentos.',
        'formula': 'media movel 3 pontos de IRI',
        'interpretacao': 'Suaviza oscilacoes locais do IRI.',
    },
    'iri_roll5': {
        'grupo': 'Suavizacao',
        'descricao': 'Media movel centrada do IRI em janela de 5 segmentos.',
        'formula': 'media movel 5 pontos de IRI',
        'interpretacao': 'Destaca tendencia funcional de media escala.',
    },
    'iri_max_local': {
        'grupo': 'Dispersao',
        'descricao': 'Maior IRI observado localmente.',
        'formula': 'max local de IRI',
        'interpretacao': 'Evidencia picos de irregularidade.',
    },
    'iri_min_local': {
        'grupo': 'Dispersao',
        'descricao': 'Menor IRI observado localmente.',
        'formula': 'min local de IRI',
        'interpretacao': 'Evidencia vales de irregularidade.',
    },
    'iri_range_local': {
        'grupo': 'Dispersao',
        'descricao': 'Amplitude local do IRI.',
        'formula': 'iri_max_local - iri_min_local',
        'interpretacao': 'Mede contraste funcional entre segmentos vizinhos.',
    },
    'iri_slope': {
        'grupo': 'Tendencia',
        'descricao': 'Gradiente longitudinal do IRI.',
        'formula': 'gradiente de IRI',
        'interpretacao': 'Mostra tendencia de piora ou melhora funcional ao longo da via.',
    },
    'd0_iri_ratio': {
        'grupo': 'Interacao estrutural-funcional',
        'descricao': 'Razao entre deflexao e IRI.',
        'formula': 'Deflexao / iri_medio',
        'interpretacao': 'Compara resposta estrutural e funcional em escala relativa.',
    },
    'd0_iri_interacao': {
        'grupo': 'Interacao estrutural-funcional',
        'descricao': 'Produto entre deflexao e IRI.',
        'formula': 'Deflexao * iri_medio',
        'interpretacao': 'Destaca segmentos onde ambos os indicadores estao elevados.',
    },
    'posicao_rel': {
        'grupo': 'Contexto espacial',
        'descricao': 'Posicao relativa do segmento no trecho, normalizada entre 0 e 1.',
        'formula': '(posicao - minimo) / amplitude',
        'interpretacao': 'Ajuda a capturar macrozonas ao longo do trecho.',
    },
    'comprimento_m': {
        'grupo': 'Geometria do segmento',
        'descricao': 'Comprimento do segmento em metros.',
        'formula': 'km_fim - km_ini',
        'interpretacao': 'Controla diferencas de extensao entre segmentos.',
    },
}


TERM_CATALOG = {
    'slope': 'Gradiente local: indica se a variavel esta aumentando ou diminuindo ao longo da rodovia.',
    'roll3': 'Media movel centrada em 3 segmentos: suaviza ruido local de curta distancia.',
    'roll5': 'Media movel centrada em 5 segmentos: suaviza mais e destaca macrozonas.',
    'range_local': 'Amplitude local: diferenca entre o maior e o menor valor na vizinhanca.',
    'std_local': 'Desvio padrao local: mede instabilidade ou variabilidade na vizinhanca.',
    'std': 'Desvio padrao: mede dispersao dos valores em torno da media.',
    'CV': 'Coeficiente de variacao: desvio padrao dividido pela media; mede variabilidade relativa.',
    'ratio': 'Razao entre duas variaveis: compara proporcionalmente seus niveis.',
    'interacao': 'Produto entre duas variaveis: destaca casos em que ambas estao altas ao mesmo tempo.',
    'posicao_rel': 'Posicao relativa normalizada no trecho, variando de 0 a 1.',
}


def feature_glossary_dataframe(feature_names: list[str]) -> pd.DataFrame:
    rows = []
    for name in feature_names:
        if name.endswith('_med') and name not in FEATURE_CATALOG:
            rows.append({
                'Feature': name,
                'Grupo': 'Variavel adicional',
                'Formula simplificada': 'media da coluna numerica original',
                'Descricao': 'Media de uma variavel numerica adicional presente na planilha de entrada.',
                'Interpretacao': 'Permite incorporar indicadores extras do seu banco de dados.',
            })
            continue

        meta = FEATURE_CATALOG.get(name, {
            'grupo': 'Nao catalogada',
            'formula': '-',
            'descricao': 'Feature disponivel no pipeline sem descricao detalhada cadastrada.',
            'interpretacao': 'Verifique a origem desta coluna na base processada.',
        })
        rows.append({
            'Feature': name,
            'Grupo': meta['grupo'],
            'Formula simplificada': meta['formula'],
            'Descricao': meta['descricao'],
            'Interpretacao': meta['interpretacao'],
        })
    return pd.DataFrame(rows)


def term_glossary_dataframe() -> pd.DataFrame:
    return pd.DataFrame([
        {'Termo': term, 'Significado': meaning}
        for term, meaning in TERM_CATALOG.items()
    ])


def features_markdown(feature_names: list[str]) -> str:
    df = feature_glossary_dataframe(feature_names)
    if df.empty:
        return 'Nenhuma feature ativa.'

    lines = [f'Foram utilizadas **{len(df)} features** no experimento principal:', '']
    for _, row in df.iterrows():
        lines.append(
            f"- **{row['Feature']}**: {row['Descricao']} "
            f"Formula simplificada: `{row['Formula simplificada']}`. "
            f"Interpretacao: {row['Interpretacao']}"
        )
    lines.append('')
    lines.append('**Glossario rapido dos termos**')
    lines.append('')
    for _, row in term_glossary_dataframe().iterrows():
        lines.append(f"- **{row['Termo']}**: {row['Significado']}")
    return '\n'.join(lines)