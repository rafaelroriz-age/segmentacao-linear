"""
Pipeline de Segmentação Homogênea — Visualização
Gráficos Plotly para o app Streamlit.
"""

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots


# Paleta de cores para clusters
CORES_CLUSTER = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
    '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5',
]


def plot_clusters_rodovia(seg, col_cluster, col_deflexao='Deflexao',
                           titulo=None):
    """Gráfico de dispersão dos segmentos ao longo da rodovia, coloridos por cluster."""
    if titulo is None:
        titulo = f"Deflexão por estação — {col_cluster}"

    fig = px.scatter(
        seg, x='km_ini', y=col_deflexao,
        color=seg[col_cluster].astype(str),
        hover_data=['km_ini', 'km_fim', col_deflexao, 'Deflexao_std'],
        title=titulo,
        labels={'km_ini': 'Posição (m)', col_deflexao: 'Deflexão média (μm)'},
        color_discrete_sequence=CORES_CLUSTER,
    )
    fig.update_layout(
        legend_title_text='Cluster',
        template='plotly_white',
        height=450,
    )
    return fig


def plot_boxplot_clusters(seg, col_cluster, col_deflexao='Deflexao'):
    """Boxplot da deflexão por cluster."""
    fig = px.box(
        seg, x=seg[col_cluster].astype(str), y=col_deflexao,
        color=seg[col_cluster].astype(str),
        title=f"Distribuição da deflexão por cluster — {col_cluster}",
        labels={'x': 'Cluster', col_deflexao: 'Deflexão (μm)'},
        color_discrete_sequence=CORES_CLUSTER,
    )
    fig.update_layout(showlegend=False, template='plotly_white', height=400)
    return fig


def plot_perfil_longitudinal(seg, col_cluster, col_deflexao='Deflexao'):
    """Perfil longitudinal da deflexão com barras de fundo coloridas por cluster."""
    clusters = seg[col_cluster].values
    unique_cls = sorted(set(clusters))
    color_map = {str(c): CORES_CLUSTER[i % len(CORES_CLUSTER)]
                 for i, c in enumerate(unique_cls)}

    fig = go.Figure()

    # Barras de fundo para cada cluster
    for c in unique_cls:
        mask = clusters == c
        fig.add_trace(go.Bar(
            x=seg.loc[mask, 'km_ini'],
            y=seg.loc[mask, col_deflexao],
            name=f'Cluster {c}',
            marker_color=color_map[str(c)],
            opacity=0.6,
        ))

    # Linha contínua da deflexão
    fig.add_trace(go.Scatter(
        x=seg['km_ini'], y=seg[col_deflexao],
        mode='lines', name='Deflexão',
        line=dict(color='black', width=1.5),
    ))

    fig.update_layout(
        barmode='overlay',
        title=f'Perfil longitudinal — {col_cluster}',
        xaxis_title='Posição (m)',
        yaxis_title='Deflexão (μm)',
        template='plotly_white',
        height=400,
    )
    return fig


def plot_heatmap_metricas(df_comp):
    """Heatmap das métricas comparativas entre métodos."""
    cols_num = ['silhouette', 'calinski', 'davies_bouldin', 'XGB_Accuracy_CV', 'Std_Intra']
    cols_presentes = [c for c in cols_num if c in df_comp.columns]
    if not cols_presentes:
        return go.Figure()

    df_plot = df_comp.set_index('Método')[cols_presentes].astype(float)

    fig = px.imshow(
        df_plot.T, text_auto='.3f',
        aspect='auto',
        title='Heatmap de métricas comparativas',
        color_continuous_scale='RdYlGn',
    )
    fig.update_layout(height=350, template='plotly_white')
    return fig


def plot_segmentos_mapa(seg, col_cluster):
    """Gráfico de barras horizontais representando cada segmento na rodovia."""
    clusters = seg[col_cluster].values
    unique_cls = sorted(set(clusters))
    color_map = {c: CORES_CLUSTER[i % len(CORES_CLUSTER)]
                 for i, c in enumerate(unique_cls)}

    fig = go.Figure()
    for _, row in seg.iterrows():
        c = row[col_cluster]
        fig.add_trace(go.Bar(
            x=[row['km_fim'] - row['km_ini']],
            y=['Rodovia'],
            base=row['km_ini'],
            orientation='h',
            marker_color=color_map[c],
            name=f'Cluster {c}',
            showlegend=False,
            hovertext=(
                f"Cluster {c}<br>"
                f"Início: {row['km_ini']:.0f}m<br>"
                f"Fim: {row['km_fim']:.0f}m<br>"
                f"Deflexão: {row['Deflexao']:.1f}"
            ),
            hoverinfo='text',
        ))

    # Legenda manual
    for c in unique_cls:
        fig.add_trace(go.Bar(
            x=[0], y=['Rodovia'], base=0, orientation='h',
            marker_color=color_map[c],
            name=f'Cluster {c}', showlegend=True,
        ))

    fig.update_layout(
        barmode='stack',
        title=f'Mapa de segmentos — {col_cluster}',
        xaxis_title='Posição (m)',
        template='plotly_white',
        height=200,
    )
    return fig


def plot_radar_clusters(seg, col_cluster, features):
    """Gráfico radar do perfil médio de cada cluster."""
    cols_existem = [f for f in features if f in seg.columns]
    if len(cols_existem) < 3:
        return go.Figure()

    medias = seg.groupby(col_cluster)[cols_existem].mean()
    # Normalizar 0-1 para radar
    mins = medias.min()
    maxs = medias.max()
    rng = maxs - mins
    rng[rng == 0] = 1
    norm = (medias - mins) / rng

    fig = go.Figure()
    for c in norm.index:
        vals = norm.loc[c].values.tolist()
        vals.append(vals[0])  # fechar o polígono
        cats = cols_existem + [cols_existem[0]]
        fig.add_trace(go.Scatterpolar(
            r=vals, theta=cats, fill='toself',
            name=f'Cluster {c}',
        ))
    fig.update_layout(
        polar=dict(radialaxis=dict(visible=True, range=[0, 1])),
        title=f'Perfil radar por cluster — {col_cluster}',
        template='plotly_white',
        height=450,
    )
    return fig
