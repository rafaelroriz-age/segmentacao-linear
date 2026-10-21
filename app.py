"""
Segmentação Homogênea LINEAR — App para Artigo Científico
3 métodos: CDA (clássico, d0 bruto), Ward 1D e PELT (multivariados).

CDA usa deflexão máxima bruta (d0) conforme Thomas & Papagiannakis (1997).
Ward 1D e PELT usam 3 features: Deflexao_caract, iri_medio, CV_deflexao.
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from pathlib import Path
from io import BytesIO
from sklearn.metrics import silhouette_score

from pipeline.preprocessing import carregar_dados, agregar_120m, construir_features
from pipeline.clustering import (
    padronizar, cda_segmentation, ward1d_linear, pelt_segmentation,
    aplicar_regras_espaciais,
)
from pipeline.evaluation import (
    avaliar_intrinseco, avaliar_extrinseco_xgb, variancia_intra,
    perfil_clusters,
)
from pipeline.audit import (
    gap_statistic, estabilidade_bootstrap,
    teste_kruskal_wallis, homogeneidade_intra,
    matriz_ari_cruzado, feature_importance_xgb,
)

# ── Paletas e constantes ──────────────────────────────────────────────────────
CORES_METODO = {'CDA': '#1f77b4', 'Ward 1D': '#2ca02c', 'PELT': '#d62728'}
PAL = px.colors.qualitative.Dark2  # cores distinguíveis para segmentos
METODO_COL = {
    'CDA': 'cluster_cda',
    'CDA (Dc)': 'cluster_cda_dc',
    'Ward 1D': 'cluster_ward1d',
    'PELT': 'cluster_pelt',
}
TODOS_METODOS = list(METODO_COL.keys())  # ['CDA', 'CDA (Dc)', 'Ward 1D', 'PELT']

def _feat_info_label(nome, vars_ok):
    """Rótulo de features usado em títulos de gráficos."""
    if nome == 'CDA':
        return 'd0 bruto'
    elif nome == 'CDA (Dc)':
        return 'Dc (deflexão caract.)'
    else:
        return ', '.join(vars_ok)

# ── Configuração da página ────────────────────────────────────────────────────
st.set_page_config(
    page_title="Artigo — Segmentação Linear (CDA × Ward 1D × PELT)",
    page_icon="📄", layout="wide",
)
st.title("📄 Segmentação Homogênea Linear — CDA × Ward 1D × PELT")
st.caption(
    "CDA: deflexão bruta d0 (univariado, AASHTO). "
    "Ward 1D e PELT: d0+σ, IRI, CV (multivariado)."
)


# ══════════════════════════════════════════════════════════════════════════════
# FUNÇÕES AUXILIARES
# ══════════════════════════════════════════════════════════════════════════════
def _km_acumulado(seg):
    seg = seg.copy()
    seg['km_acum'] = seg['comprimento_m'].cumsum() / 1000.0
    return seg


def _stats_por_segmento(seg, col_cl):
    """Calcula Std e CV de d0, Dc e IRI para cada segmento contíguo."""
    labels = seg[col_cl].values
    trechos, start = [], 0
    for i in range(1, len(labels)):
        if labels[i] != labels[i - 1]:
            trechos.append((start, i - 1))
            start = i
    trechos.append((start, len(labels) - 1))

    has_dc = 'Deflexao_caract' in seg.columns
    has_iri = 'iri_medio' in seg.columns and seg['iri_medio'].notna().any()

    rows = []
    km_acum = 0.0
    for idx, (i0, i1) in enumerate(trechos):
        b = seg.iloc[i0:i1 + 1]
        comp = float(b['comprimento_m'].sum())
        n = len(b)
        # d0
        d_mean = float(b['Deflexao'].mean())
        d_min = float(b['Deflexao'].min())
        d_max = float(b['Deflexao'].max())
        d_std = float(b['Deflexao'].std()) if n > 1 else 0.0
        d_cv = round(d_std / d_mean, 3) if d_mean > 0 else None
        row = {
            'Segmento': idx + 1,
            'km_ini': round(km_acum, 2),
            'km_fim': round(km_acum + comp / 1000.0, 2),
            'Comp. (m)': round(comp, 0),
            'n': n,
            'd0 média': round(d_mean, 1),
            'd0 mín': round(d_min, 1),
            'd0 máx': round(d_max, 1),
            'd0 σ': round(d_std, 1),
            'd0 CV': d_cv,
        }
        # Dc (Deflexao_caract)
        if has_dc:
            dc_mean = float(b['Deflexao_caract'].mean())
            dc_min = float(b['Deflexao_caract'].min())
            dc_max = float(b['Deflexao_caract'].max())
            dc_std = float(b['Deflexao_caract'].std()) if n > 1 else 0.0
            dc_cv = round(dc_std / dc_mean, 3) if dc_mean > 0 else None
            row.update({
                'Dc média': round(dc_mean, 1),
                'Dc mín': round(dc_min, 1),
                'Dc máx': round(dc_max, 1),
                'Dc σ': round(dc_std, 1),
                'Dc CV': dc_cv,
            })
        # IRI
        if has_iri:
            iri_mean = float(b['iri_medio'].mean())
            iri_min = float(b['iri_medio'].min())
            iri_max = float(b['iri_medio'].max())
            iri_std = float(b['iri_medio'].std()) if n > 1 else 0.0
            iri_cv = round(iri_std / iri_mean, 3) if iri_mean and iri_mean > 0 else None
            row.update({
                'IRI média': round(iri_mean, 2),
                'IRI mín': round(iri_min, 2),
                'IRI máx': round(iri_max, 2),
                'IRI σ': round(iri_std, 2),
                'IRI CV': iri_cv,
            })
        else:
            row.update({'IRI média': None, 'IRI mín': None, 'IRI máx': None, 'IRI σ': None, 'IRI CV': None})
        rows.append(row)
        km_acum += comp / 1000.0
    return pd.DataFrame(rows)


_COLOR_DEFL = '#1f77b4'   # azul – deflexão
_COLOR_IRI  = '#d62728'   # vermelho – IRI
_BG_COLORS = [             # 20 cores pastel suaves por segmento
    '#ADD8E6',   # azul bebê
    '#FFDAB9',   # pêssego claro
    '#B8E9B2',   # verde menta
    '#FFC0CB',   # rosa bebê
    '#D8BFF1',   # lavanda
    '#DEC7B7',   # bege suave
    '#FAC8DC',   # rosa pálido
    '#E6E6B4',   # amarelo palha
    '#B4E6E6',   # ciano pastel
    '#FFE4C4',   # bisque
    '#C8EEC8',   # verde claro
    '#FFD2C8',   # salmão pálido
    '#DCD0EB',   # lilás suave
    '#E1D2C8',   # bege rosado
    '#FCDCE6',   # rosa algodão
    '#EEEEC8',   # creme suave
    '#C8E6F0',   # azul gelo
    '#D7F0D2',   # menta clara
    '#FFEBCD',   # damasco pálido
    '#D2DCF0',   # azul névoa
]
_BG_OPACITY = 0.25          # opacidade única p/ todas as faixas


def _fig_segmentos_dual(seg, col_cl, titulo, col_defl='Deflexao', label_defl='d0 (μm)'):
    """Gráfico único com 2 eixos Y: deflexão (esquerda, azul) e IRI (direita, vermelho),
    com fundo suave alternado por segmento."""
    labels = seg[col_cl].values
    has_iri = 'iri_medio' in seg.columns and seg['iri_medio'].notna().any()

    # Agrupar segmentos contíguos
    segs_uniq = []
    start, cur = 0, labels[0]
    for i in range(1, len(labels)):
        if labels[i] != cur:
            segs_uniq.append((start, i - 1, cur))
            start, cur = i, labels[i]
    segs_uniq.append((start, len(labels) - 1, cur))

    fig = make_subplots(specs=[[{'secondary_y': True}]])

    # Fundo por segmento (vrect)
    for seg_idx, (i0, i1, lbl) in enumerate(segs_uniq):
        sl = seg.iloc[i0:i1 + 1]
        x0 = sl['km_acum'].iloc[0]
        x1 = sl['km_acum'].iloc[-1]
        bg = _BG_COLORS[seg_idx % len(_BG_COLORS)]
        fig.add_vrect(x0=x0, x1=x1, fillcolor=bg, opacity=_BG_OPACITY,
                      layer='below', line_width=0)

    # Linha contínua de deflexão (único trace)
    fig.add_trace(go.Scatter(
        x=seg['km_acum'], y=seg[col_defl],
        mode='lines+markers',
        marker=dict(color=_COLOR_DEFL, size=3),
        line=dict(color=_COLOR_DEFL, width=1.8),
        name=label_defl,
    ), secondary_y=False)

    # Linha contínua de IRI (único trace)
    if has_iri:
        fig.add_trace(go.Scatter(
            x=seg['km_acum'], y=seg['iri_medio'],
            mode='lines+markers',
            marker=dict(color=_COLOR_IRI, size=3, symbol='diamond'),
            line=dict(color=_COLOR_IRI, width=1.5, dash='dash'),
            name='IRI (m/km)',
        ), secondary_y=True)

    # Fronteiras verticais + labels de segmento
    for seg_idx, (i0, i1, lbl) in enumerate(segs_uniq):
        sl = seg.iloc[i0:i1 + 1]
        if seg_idx > 0:
            x_front = sl['km_acum'].iloc[0]
            fig.add_vline(x=x_front, line_dash='dot', line_color='grey', opacity=0.45)
        # Label do segmento no topo
        x_mid = (sl['km_acum'].iloc[0] + sl['km_acum'].iloc[-1]) / 2
        fig.add_annotation(
            x=x_mid, y=1.0, yref='paper', text=f'S{seg_idx+1}',
            showarrow=False, font=dict(size=7, color='grey'),
        )

    fig.update_yaxes(
        title_text=label_defl, color=_COLOR_DEFL, secondary_y=False,
        gridcolor='rgba(80,80,80,0.30)', gridwidth=1,      # cinza escuro
    )
    if has_iri:
        fig.update_yaxes(
            title_text='IRI (m/km)', color=_COLOR_IRI, secondary_y=True,
            gridcolor='rgba(0,0,0,0.15)', gridwidth=0.5,   # preto leve
            griddash='dot',
        )
    fig.update_xaxes(title_text='Distância acumulada (km)',
                     gridcolor='rgba(200,200,200,0.4)')
    fig.update_layout(
        height=460, template='plotly_white',
        plot_bgcolor='rgba(0,0,0,0)',   # fundo transparente p/ vrects aparecerem
        title_text=titulo,
        legend=dict(orientation='h', yanchor='top', y=-0.22,
                    xanchor='center', x=0.5, font=dict(size=9)),
        margin=dict(b=140),
    )
    return fig


def _fig_stats_barras(df_stats, titulo):
    """Barras agrupadas de Std e CV para d0, Dc e IRI por segmento."""
    has_dc = 'Dc σ' in df_stats.columns and df_stats['Dc σ'].notna().any()
    has_iri = 'IRI σ' in df_stats.columns and df_stats['IRI σ'].notna().any()
    n_cols = 1 + int(has_dc) + int(has_iri)
    titles = ['d0']
    if has_dc:
        titles.append('Dc')
    if has_iri:
        titles.append('IRI')
    fig = make_subplots(rows=1, cols=n_cols, subplot_titles=titles)
    segs = df_stats['Segmento'].astype(str)
    # d0
    fig.add_trace(go.Bar(x=segs, y=df_stats['d0 σ'], name='d0 σ',
                         marker_color='#1f77b4'), row=1, col=1)
    fig.add_trace(go.Bar(x=segs, y=df_stats['d0 CV'], name='d0 CV',
                         marker_color='#aec7e8'), row=1, col=1)
    c = 2
    # Dc
    if has_dc:
        fig.add_trace(go.Bar(x=segs, y=df_stats['Dc σ'], name='Dc σ',
                             marker_color='#9467bd'), row=1, col=c)
        fig.add_trace(go.Bar(x=segs, y=df_stats['Dc CV'], name='Dc CV',
                             marker_color='#c5b0d5'), row=1, col=c)
        c += 1
    # IRI
    if has_iri:
        fig.add_trace(go.Bar(x=segs, y=df_stats['IRI σ'], name='IRI σ',
                             marker_color='#ff7f0e'), row=1, col=c)
        fig.add_trace(go.Bar(x=segs, y=df_stats['IRI CV'], name='IRI CV',
                             marker_color='#ffbb78'), row=1, col=c)
    fig.update_layout(height=350, template='plotly_white', title_text=titulo,
                       barmode='group')
    fig.update_xaxes(title_text='Segmento')
    return fig


def _fig_mapa_segmentos(seg, col_cl, titulo):
    """Barra horizontal com segmentos coloridos ao longo do km."""
    labels = seg[col_cl].values
    segs_uniq = []
    start, cur = 0, labels[0]
    for i in range(1, len(labels)):
        if labels[i] != cur:
            segs_uniq.append((start, i - 1, cur))
            start, cur = i, labels[i]
    segs_uniq.append((start, len(labels) - 1, cur))

    fig = go.Figure()
    for seg_idx, (i0, i1, _) in enumerate(segs_uniq):
        sl = seg.iloc[i0:i1 + 1]
        x0 = sl['km_acum'].iloc[0] - sl.iloc[0]['comprimento_m'] / 1000.0
        width = sl['comprimento_m'].sum() / 1000.0
        fig.add_trace(go.Bar(
            x=[width], y=[''], base=x0, orientation='h',
            marker_color=PAL[seg_idx % len(PAL)],
            name=f'Seg {seg_idx + 1}', showlegend=True,
            text=f'{seg_idx + 1}', textposition='inside',
        ))
    fig.update_layout(
        height=280, template='plotly_white', title_text=titulo,
        barmode='stack', xaxis_title='Distância acumulada (km)',
        legend=dict(orientation='h', yanchor='top', y=-0.35,
                    xanchor='center', x=0.5, font=dict(size=7)),
        margin=dict(l=40, r=20, t=40, b=100),
    )
    return fig


# ══════════════════════════════════════════════════════════════════════════════
# SIDEBAR
# ══════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    st.header("⚙️ Configurações")
    uploaded = st.file_uploader("Carregar dados (Excel / CSV)",
                                type=['xlsx', 'xls', 'csv'])
    st.caption("Formato: km_inicial, km_final, iri_medio, d0")

    col_km_ini = st.text_input("Coluna km inicial", value="km_inicial")
    col_km_fim = st.text_input("Coluna km final", value="km_final")
    col_iri = st.text_input("Coluna IRI médio", value="iri_medio")
    col_def = st.text_input("Coluna d0", value="d0")

    st.subheader("Hiperparâmetros")

    with st.expander("CDA (univariado — d0 bruto)"):
        cda_conf = st.slider("Confiança (λ)", 0.5, 3.0, 1.0, 0.25,
                              help="AASHTO: λ=1.0 (Thomas & Papagiannakis, 1997)")

    with st.expander("Ward 1D (multivariado — 3 features)"):
        ward_k = st.slider("Número de clusters (k)", 2, 20, 7,
                            help="Gap Statistic sugere k ótimo; default 7")

    with st.expander("PELT (multivariado — 3 features)"):
        pelt_model = st.selectbox("Modelo de custo", ['l2', 'rbf'], index=0)
        pelt_min_size = st.slider("Tamanho mínimo de segmento", 2, 10, 3)
        pelt_pen = st.slider("Penalização (β)", 1, 100, 12)

    st.subheader("Regras Espaciais")
    min_comp = st.slider("Comprimento mínimo (m)", 200, 4000, 600, 100)
    max_comp = st.slider("Comprimento máximo (m)", 1000, 10000, 4000, 200)

    st.subheader("Features (Ward 1D e PELT)")
    feature_options = [
        'Deflexao_caract', 'iri_medio', 'CV_deflexao',
        'Deflexao', 'Deflexao_std', 'Deflexao_roll5', 'iri_roll5',
        'd0_iri_ratio', 'posicao_rel',
    ]
    features_selecionadas = st.multiselect(
        "🎯 Indicadores para clustering multivariado",
        options=feature_options,
        default=['Deflexao_caract', 'iri_medio', 'CV_deflexao'],
        help="CDA sempre usa d0 bruto. Estes indicadores são para Ward/PELT.",
    )

    executar = st.button("▶️ Executar Pipeline", type="primary",
                         use_container_width=True)

if 'pipeline_requested' not in st.session_state:
    st.session_state['pipeline_requested'] = False
if executar:
    st.session_state['pipeline_requested'] = True

# ── Tela inicial ──────────────────────────────────────────────────────────────
if uploaded is None:
    st.info("⬆️ Faça upload dos dados GO-010 na barra lateral para começar.")
    st.markdown("""
    ### Métodos neste artigo

    | Método | Tipo | Feature(s) | Referência |
    |--------|------|------------|------------|
    | **CDA** | Clássico (AASHTO) | d0 bruto (univariado) | Thomas & Papagiannakis (1997) |
    | **Ward 1D** | Clustering hierárquico | d0+σ, IRI, CV (multivariado) | Ward Jr. (1963) |
    | **PELT** | Change-point detection | d0+σ, IRI, CV (multivariado) | Killick et al. (2012) |

    **Justificativa**: O CDA clássico utiliza a deflexão máxima bruta (d0), conforme
    a literatura original. Ward 1D e PELT incorporam indicadores de engenharia
    (deflexão característica, IRI e coeficiente de variação) para segmentação
    multivariada, permitindo comparação direta entre abordagens uni e multivariada.
    """)
    st.stop()

# ══════════════════════════════════════════════════════════════════════════════
# CARREGAMENTO
# ══════════════════════════════════════════════════════════════════════════════
df_raw = carregar_dados(uploaded)

tab_dados, tab_pipeline, tab_auditoria, tab_autoresearch = st.tabs([
    "📋 Dados & Features",
    "🔬 Pipeline & Resultados",
    "📊 Auditoria Estatística",
    "🤖 AutoResearch",
])

# ═══════════════════════════════════════════════════════════════════════════════
# ABA 1 — DADOS & FEATURES
# ═══════════════════════════════════════════════════════════════════════════════
with tab_dados:
    st.subheader("1. Dados brutos — GO-010 (GOINFRA)")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Registros", len(df_raw))
    c2.metric("Colunas", len(df_raw.columns))
    if col_def in df_raw.columns:
        c3.metric("d0 médio", f"{df_raw[col_def].mean():.1f} μm")
    if col_iri in df_raw.columns:
        c4.metric("IRI médio", f"{df_raw[col_iri].mean():.2f} m/km")
    st.dataframe(df_raw.head(20), use_container_width=True)

    # Pré-processamento
    st.subheader("2. Segmentos pré-processados")
    seg120 = agregar_120m(df_raw, col_def=col_def, col_km_ini=col_km_ini,
                           col_km_fim=col_km_fim, col_iri=col_iri)
    seg120 = _km_acumulado(seg120)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Segmentos", len(seg120))
    extensao = seg120['km_acum'].iloc[-1] if len(seg120) > 0 else 0
    c2.metric("Extensão", f"{extensao:.2f} km")
    c3.metric("Comp. médio", f"{seg120['comprimento_m'].mean():.0f} m")
    c4.metric("d0 médio", f"{seg120['Deflexao'].mean():.1f} μm")
    st.dataframe(seg120.head(20), use_container_width=True)

    # Estatísticas descritivas
    st.subheader("3. Estatísticas descritivas")
    st.caption("**[Artigo — Tabela 1]**")
    desc_cols = [c for c in ['Deflexao', 'iri_medio', 'comprimento_m'] if c in seg120.columns]
    st.dataframe(seg120[desc_cols].describe().round(3), use_container_width=True)

    # Estatísticas globais d0 e IRI
    st.subheader("4. Estatísticas globais — d0 e IRI")
    col_a, col_b = st.columns(2)
    with col_a:
        st.markdown("**Deflexão (d0)**")
        d0 = seg120['Deflexao']
        st.write(f"Média: {d0.mean():.1f} μm | σ: {d0.std():.1f} μm | CV: {d0.std() / d0.mean():.3f}")
    with col_b:
        if 'iri_medio' in seg120.columns and seg120['iri_medio'].notna().any():
            st.markdown("**IRI**")
            iri = seg120['iri_medio']
            st.write(f"Média: {iri.mean():.2f} m/km | σ: {iri.std():.2f} m/km | CV: {iri.std() / iri.mean():.3f}")

    # Histogramas
    st.subheader("5. Distribuição dos dados")
    st.caption("**[Artigo — Figura 1]**")
    col1, col2 = st.columns(2)
    with col1:
        fig_h = px.histogram(seg120, x='Deflexao', nbins=30,
                              title='Deflexão (d0)',
                              labels={'Deflexao': 'd0 (μm)', 'count': 'Freq.'},
                              template='plotly_white', color_discrete_sequence=['#1f77b4'])
        fig_h.update_layout(height=320)
        st.plotly_chart(fig_h, use_container_width=True)
    with col2:
        if 'iri_medio' in seg120.columns and seg120['iri_medio'].notna().any():
            fig_h2 = px.histogram(seg120, x='iri_medio', nbins=30,
                                   title='IRI',
                                   labels={'iri_medio': 'IRI (m/km)', 'count': 'Freq.'},
                                   template='plotly_white', color_discrete_sequence=['#ff7f0e'])
            fig_h2.update_layout(height=320)
            st.plotly_chart(fig_h2, use_container_width=True)

    # Perfil longitudinal
    st.subheader("6. Perfil longitudinal bruto")
    st.caption("**[Artigo — Figura 2]**")
    fig_perfil = make_subplots(rows=2, cols=1, shared_xaxes=True,
                                subplot_titles=('Deflexão d0', 'IRI'))
    fig_perfil.add_trace(go.Scatter(
        x=seg120['km_acum'], y=seg120['Deflexao'],
        mode='lines+markers', name='d0', marker=dict(size=3),
        line=dict(color='#1f77b4', width=1)),
        row=1, col=1)
    if 'iri_medio' in seg120.columns:
        fig_perfil.add_trace(go.Scatter(
            x=seg120['km_acum'], y=seg120['iri_medio'],
            mode='lines+markers', name='IRI', marker=dict(size=3),
            line=dict(color='#ff7f0e', width=1)),
            row=2, col=1)
    fig_perfil.update_layout(height=450, template='plotly_white',
                              title_text='Perfil longitudinal — GO-010')
    fig_perfil.update_xaxes(title_text='Distância acumulada (km)', row=2, col=1)
    fig_perfil.update_yaxes(title_text='d0 (μm)', row=1, col=1)
    fig_perfil.update_yaxes(title_text='IRI (m/km)', row=2, col=1)
    st.plotly_chart(fig_perfil, use_container_width=True)

    # Features
    st.subheader("7. Indicadores para clustering")
    st.caption("**[Artigo — Tabela 2]**")
    if not features_selecionadas:
        st.warning("Selecione ao menos um indicador na barra lateral.")
        st.stop()

    seg120, X_df, vars_ok = construir_features(seg120, vars_clustering=features_selecionadas)
    st.info(f"**CDA**: d0 bruto (univariado). **Ward 1D e PELT**: {', '.join(vars_ok)}")

    feat_desc = {
        'Deflexao': 'Deflexão média d0 (μm)',
        'iri_medio': 'IRI médio (m/km)',
        'CV_deflexao': 'Coeficiente de variação de d0 (σ/μ)',
        'Deflexao_caract': 'Deflexão característica d0+σ (μm)',
        'Deflexao_std': 'Desvio padrão local de d0 (μm)',
        'Deflexao_roll5': 'Média móvel de d0 (janela 5)',
        'iri_roll5': 'Média móvel do IRI (janela 5)',
        'd0_iri_ratio': 'Razão d0/IRI',
        'posicao_rel': 'Posição relativa [0,1]',
    }
    ft = pd.DataFrame({
        'Indicador': vars_ok,
        'Descrição': [feat_desc.get(f, f) for f in vars_ok],
    })
    st.dataframe(ft, use_container_width=True, hide_index=True)

    # Correlação
    st.subheader("8. Matriz de correlação")
    corr = X_df[vars_ok].corr().round(3)
    max_corr = corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool)).abs().max().max()
    fig_corr = px.imshow(corr.values, x=vars_ok, y=vars_ok, text_auto='.3f',
                          color_continuous_scale='RdBu_r', aspect='auto',
                          title=f'Correlação (máx off-diag: {max_corr:.3f})')
    fig_corr.update_layout(template='plotly_white', height=380,
                            xaxis=dict(tickangle=-45))
    st.plotly_chart(fig_corr, use_container_width=True)

# ═══════════════════════════════════════════════════════════════════════════════
# ABA 2 — PIPELINE & RESULTADOS
# ═══════════════════════════════════════════════════════════════════════════════
with tab_pipeline:
    if not st.session_state.get('pipeline_requested', False):
        st.info("Clique em **▶️ Executar Pipeline** na barra lateral.")
        st.stop()

    # Preparar dados
    seg120, X_df, vars_ok = construir_features(seg120, vars_clustering=features_selecionadas)
    X = X_df.values
    X_scaled, scaler = padronizar(X)
    defl_vals = seg120['Deflexao'].values
    seg120 = _km_acumulado(seg120)

    progress = st.progress(0, text="Iniciando pipeline...")

    # ── CDA (d0 bruto — univariado) ──────────────────────────────────────────
    progress.progress(0.1, text="CDA (d0 bruto)...")
    lbls_cda, bkps_cda = cda_segmentation(defl_vals, confianca=cda_conf)
    seg120['cluster_cda'] = lbls_cda

    # ── CDA (Dc — univariado) ────────────────────────────────────────────────
    progress.progress(0.2, text="CDA (Dc)...")
    dc_vals = seg120['Deflexao_caract'].values
    lbls_cda_dc, bkps_cda_dc = cda_segmentation(dc_vals, confianca=cda_conf)
    seg120['cluster_cda_dc'] = lbls_cda_dc

    # ── Ward 1D (multivariado) ────────────────────────────────────────────────
    progress.progress(0.4, text="Ward 1D (multivariado)...")
    lbls_ward, _, _ = ward1d_linear(X_scaled, ward_k)
    seg120['cluster_ward1d'] = lbls_ward

    # ── PELT (multivariado) ───────────────────────────────────────────────────
    progress.progress(0.7, text="PELT (multivariado)...")
    lbls_pelt, bkps_pelt, _ = pelt_segmentation(
        X_scaled, model=pelt_model, min_size=pelt_min_size, pen=pelt_pen)
    seg120['cluster_pelt'] = lbls_pelt

    progress.progress(1.0, text="Pipeline concluído ✅")

    # ══════════════════════════════════════════════════════════════════════════
    # TABELA COMPARATIVA PRÉ-REGRAS ESPACIAIS
    # ══════════════════════════════════════════════════════════════════════════
    st.header("Resultados — Segmentação Inicial")
    st.subheader("📊 Tabela comparativa de métricas")
    st.caption("**[Artigo — Tabela 4]** Antes das regras espaciais")

    rows_met = []
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        lbls = seg120[col_cl].values
        n_seg = len(set(lbls))
        sil = silhouette_score(X_scaled, lbls) if n_seg > 1 else None
        xgb_res = avaliar_extrinseco_xgb(X_scaled, lbls)
        xgb_acc = xgb_res.get('xgb_accuracy_cv') if isinstance(xgb_res, dict) else None
        vi = variancia_intra(X_scaled, lbls)
        # CV intra d0
        cvs = []
        for c in sorted(set(lbls)):
            mask = lbls == c
            if mask.sum() > 1:
                cd = seg120.loc[mask, 'Deflexao']
                mu = cd.mean()
                if mu > 0:
                    cvs.append(cd.std() / mu)
        cv_intra = float(np.mean(cvs)) if cvs else None
        rows_met.append({
            'Método': nome,
            'Features': _feat_info_label(nome, vars_ok),
            'Nº Seg.': n_seg,
            'Silhouette': round(sil, 4) if sil is not None else None,
            'XGB 5-fold': f'{xgb_acc:.1%}' if xgb_acc else '—',
            'Std Intra': round(vi, 4) if vi else None,
            'CV Intra': round(cv_intra, 3) if cv_intra is not None else None,
        })
    df_met = pd.DataFrame(rows_met)
    st.dataframe(df_met, use_container_width=True, hide_index=True)

    # ══════════════════════════════════════════════════════════════════════════
    # GRÁFICOS DE SEGMENTOS INICIAIS (d0 + IRI)
    # ══════════════════════════════════════════════════════════════════════════
    st.subheader("🗺️ Segmentos lineares — antes das regras espaciais")
    st.caption("**[Artigo — Figura 3]** d0/Dc e IRI por segmento (eixos duplos), com fronteiras")

    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        if col_cl not in seg120.columns:
            continue
        feat_info = _feat_info_label(nome, vars_ok)
        # Gráfico com d0
        fig_d0 = _fig_segmentos_dual(seg120, col_cl, f'{nome} — d0 + IRI ({feat_info})',
                                      col_defl='Deflexao', label_defl='d0 (μm)')
        st.plotly_chart(fig_d0, use_container_width=True)
        # Gráfico com Dc (Deflexão característica)
        if 'Deflexao_caract' in seg120.columns:
            fig_dc = _fig_segmentos_dual(seg120, col_cl, f'{nome} — Dc + IRI ({feat_info})',
                                          col_defl='Deflexao_caract', label_defl='Dc (μm)')
            st.plotly_chart(fig_dc, use_container_width=True)

    # Std e CV por segmento (antes das regras)
    st.subheader("📉 Desvio padrão e CV por segmento (inicial)")
    st.caption("**[Artigo — Figura 4]** Homogeneidade por segmento")
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        if col_cl not in seg120.columns:
            continue
        df_stats = _stats_por_segmento(seg120, col_cl)
        with st.expander(f"**{nome}** — {len(df_stats)} segmentos", expanded=(nome not in ('CDA', 'CDA (Dc)'))):
            st.dataframe(df_stats, use_container_width=True, hide_index=True)
            fig_st = _fig_stats_barras(df_stats, f'{nome} — σ e CV por segmento')
            st.plotly_chart(fig_st, use_container_width=True)

    # Boxplots
    st.subheader("📦 Distribuição por cluster")
    st.caption("**[Artigo — Figura 5]**")
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        if col_cl not in seg120.columns:
            continue
        st.markdown(f"**{nome}**")
        fig_box = go.Figure()
        lbls = seg120[col_cl].values
        for c in sorted(set(lbls)):
            mask = lbls == c
            fig_box.add_trace(go.Box(
                y=seg120.loc[mask, 'Deflexao'], name=f'Seg {c}',
                marker_color=PAL[c % len(PAL)],
            ))
        fig_box.update_layout(template='plotly_white', height=350,
                               yaxis_title='d0 (μm)',
                               title_text=f'{nome} — Distribuição d0 por cluster')
        st.plotly_chart(fig_box, use_container_width=True)

    # ══════════════════════════════════════════════════════════════════════════
    # REGRAS ESPACIAIS + RESULTADOS FINAIS
    # ══════════════════════════════════════════════════════════════════════════
    st.header(f"Resultados — Após Regras Espaciais ({min_comp}–{max_comp} m)")
    st.caption(
        "Regras espaciais conforme HAAS; HUDSON; ZANIEWSKI (1994): "
        "segmentos homogêneos devem ter extensão compatível com unidades "
        "de intervenção em nível de rede."
    )

    seg_adj_dict = {}
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        if col_cl not in seg120.columns:
            continue
        seg_adj = aplicar_regras_espaciais(
            seg120, col_cl, min_comprimento_m=min_comp,
            max_comprimento_m=max_comp)
        col_esp = f'{col_cl}_espacial'
        if col_esp in seg_adj.columns:
            seg_adj_dict[nome] = (seg_adj, col_esp)

    # Tabela comparativa pós-regras
    st.subheader("📊 Comparação inicial vs. final")
    st.caption("**[Artigo — Tabela 5]**")
    rows_comp = []
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        n_ini = len(set(seg120[col_cl].values)) if col_cl in seg120.columns else '—'
        if nome in seg_adj_dict:
            seg_a, col_e = seg_adj_dict[nome]
            n_fin = len(set(seg_a[col_e].values))
        else:
            n_fin = '—'
        rows_comp.append({
            'Método': nome, 'Seg. iniciais': n_ini,
            'Seg. finais': n_fin, 'Intervalo': f'{min_comp}–{max_comp} m',
        })
    st.dataframe(pd.DataFrame(rows_comp), use_container_width=True, hide_index=True)

    # GRÁFICOS PÓS-REGRAS ESPACIAIS (d0/Dc + IRI)
    st.subheader("🗺️ Segmentos lineares — após regras espaciais")
    st.caption("**[Artigo — Figura 6]**")

    for nome in TODOS_METODOS:
        if nome not in seg_adj_dict:
            continue
        seg_a, col_e = seg_adj_dict[nome]
        seg_a = _km_acumulado(seg_a)
        feat_info = _feat_info_label(nome, vars_ok)
        # d0 + IRI
        fig_d0 = _fig_segmentos_dual(seg_a, col_e, f'{nome} — d0 + IRI pós-regras ({feat_info})',
                                      col_defl='Deflexao', label_defl='d0 (μm)')
        st.plotly_chart(fig_d0, use_container_width=True)
        # Dc + IRI
        if 'Deflexao_caract' in seg_a.columns:
            fig_dc = _fig_segmentos_dual(seg_a, col_e, f'{nome} — Dc + IRI pós-regras ({feat_info})',
                                          col_defl='Deflexao_caract', label_defl='Dc (μm)')
            st.plotly_chart(fig_dc, use_container_width=True)

    # Mapa de segmentos pós-regras
    st.subheader("🗺️ Mapa linear de segmentos (pós-regras)")
    st.caption("**[Artigo — Figura 7]**")
    for nome in TODOS_METODOS:
        if nome not in seg_adj_dict:
            continue
        seg_a, col_e = seg_adj_dict[nome]
        seg_a = _km_acumulado(seg_a)
        fig_m = _fig_mapa_segmentos(seg_a, col_e, f'{nome} — mapa final')
        st.plotly_chart(fig_m, use_container_width=True)

    # Tabela detalhada + stats pós-regras
    st.subheader("📋 Tabela detalhada dos segmentos finais")
    st.caption("**[Artigo — Tabela 6]** σ e CV de d0, Dc e IRI por segmento final")

    # Auxiliar: média ponderada pela distância (Comp. (m))
    def _wmean(df, col, wcol='Comp. (m)'):
        s = df[[col, wcol]].dropna()
        if s.empty or s[wcol].sum() == 0:
            return None
        return float((s[col] * s[wcol]).sum() / s[wcol].sum())

    # ── Tabela compacta comparativa (para colar no artigo) ─────────────
    _summary_rows = []
    for nome in TODOS_METODOS:
        if nome not in seg_adj_dict:
            continue
        seg_a, col_e = seg_adj_dict[nome]
        df_st = _stats_por_segmento(seg_a, col_e)
        w = df_st['Comp. (m)']
        row = {
            'Método': nome,
            'Nº Seg': len(df_st),
            # d0
            'd0 σ̄w': round(_wmean(df_st, 'd0 σ'), 2) if _wmean(df_st, 'd0 σ') is not None else None,
            'd0 CV̄w': round(_wmean(df_st, 'd0 CV'), 3) if _wmean(df_st, 'd0 CV') is not None else None,
            'd0 σ (min–máx)': f"{df_st['d0 σ'].min():.1f}–{df_st['d0 σ'].max():.1f}",
            'd0 CV (min–máx)': f"{df_st['d0 CV'].min():.3f}–{df_st['d0 CV'].max():.3f}",
        }
        # Dc
        if 'Dc σ' in df_st.columns:
            row.update({
                'Dc σ̄w': round(_wmean(df_st, 'Dc σ'), 2) if _wmean(df_st, 'Dc σ') is not None else None,
                'Dc CV̄w': round(_wmean(df_st, 'Dc CV'), 3) if _wmean(df_st, 'Dc CV') is not None else None,
                'Dc σ (min–máx)': f"{df_st['Dc σ'].min():.1f}–{df_st['Dc σ'].max():.1f}",
                'Dc CV (min–máx)': f"{df_st['Dc CV'].min():.3f}–{df_st['Dc CV'].max():.3f}",
            })
        # IRI
        if df_st['IRI σ'].notna().any():
            row.update({
                'IRI σ̄w': round(_wmean(df_st, 'IRI σ'), 3) if _wmean(df_st, 'IRI σ') is not None else None,
                'IRI CV̄w': round(_wmean(df_st, 'IRI CV'), 3) if _wmean(df_st, 'IRI CV') is not None else None,
                'IRI σ (min–máx)': f"{df_st['IRI σ'].min():.2f}–{df_st['IRI σ'].max():.2f}",
                'IRI CV (min–máx)': f"{df_st['IRI CV'].dropna().min():.3f}–{df_st['IRI CV'].dropna().max():.3f}",
            })
        _summary_rows.append(row)
    if _summary_rows:
        df_resumo = pd.DataFrame(_summary_rows)
        st.markdown("##### Resumo comparativo — σ̄ e CV̄ ponderados pela extensão (segmentos finais)")
        st.dataframe(df_resumo, use_container_width=True, hide_index=True)
        st.caption(
            "σ̄w / CV̄w = média ponderada pelo comprimento de cada segmento (m). "
            "Valores menores indicam segmentos mais homogêneos."
        )

    # Expanders individuais (detalhamento com d0 + Dc + IRI)
    for nome in TODOS_METODOS:
        if nome not in seg_adj_dict:
            continue
        seg_a, col_e = seg_adj_dict[nome]
        df_stats = _stats_por_segmento(seg_a, col_e)
        with st.expander(f"**{nome}** — {len(df_stats)} segmentos finais", expanded=False):
            st.dataframe(df_stats, use_container_width=True, hide_index=True)
            fig_st = _fig_stats_barras(df_stats, f'{nome} — σ e CV pós-regras')
            st.plotly_chart(fig_st, use_container_width=True)

    # Contagem
    st.subheader("📊 Nº segmentos por método")
    st.caption("**[Artigo — Figura 8]**")
    seg_counts = []
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        n_ini = len(set(seg120[col_cl].values)) if col_cl in seg120.columns else 0
        if nome in seg_adj_dict:
            _, col_e = seg_adj_dict[nome]
            n_fin = len(set(seg_adj_dict[nome][0][col_e].values))
        else:
            n_fin = 0
        seg_counts.append({'Método': nome, 'Iniciais': n_ini, 'Finais': n_fin})
    df_cnt = pd.DataFrame(seg_counts)
    fig_cnt = go.Figure()
    fig_cnt.add_trace(go.Bar(x=df_cnt['Método'], y=df_cnt['Iniciais'],
                              name='Iniciais', marker_color='lightblue', text=df_cnt['Iniciais']))
    fig_cnt.add_trace(go.Bar(x=df_cnt['Método'], y=df_cnt['Finais'],
                              name='Finais', marker_color='steelblue', text=df_cnt['Finais']))
    fig_cnt.update_layout(barmode='group', template='plotly_white', height=400,
                           title_text='Segmentos iniciais vs. finais (regras espaciais)')
    st.plotly_chart(fig_cnt, use_container_width=True)

    # ══════════════════════════════════════════════════════════════════════════
    # EXPORTAR EXCEL — 3 abas (CDA, Ward 1D, PELT)
    # ══════════════════════════════════════════════════════════════════════════
    st.header("📥 Exportar resultados em Excel")
    st.caption("Arquivo com abas por método (CDA, CDA_Dc, Ward_1D, PELT) + "
               "Dados_Deflexao (original ~40 m) e Dados_d0_IRI (200 m com IRI).")

    def _build_excel():
        buf = BytesIO()
        with pd.ExcelWriter(buf, engine='openpyxl') as writer:
            for nome in TODOS_METODOS:
                col_cl = METODO_COL[nome]
                sheet = nome.replace(' ', '_').replace('(', '').replace(')', '')
                start_row = 0

                # 1) Métricas gerais
                row_met = df_met[df_met['Método'] == nome]
                header_met = pd.DataFrame([['MÉTRICAS INICIAIS']], columns=[''])
                header_met.to_excel(writer, sheet_name=sheet,
                                    startrow=start_row, index=False, header=False)
                start_row += 1
                row_met.to_excel(writer, sheet_name=sheet,
                                 startrow=start_row, index=False)
                start_row += len(row_met) + 2

                # 2) Segmentos iniciais (stats)
                if col_cl in seg120.columns:
                    df_ini = _stats_por_segmento(seg120, col_cl)
                    header_ini = pd.DataFrame(
                        [['SEGMENTOS INICIAIS (σ e CV por segmento)']], columns=[''])
                    header_ini.to_excel(writer, sheet_name=sheet,
                                        startrow=start_row, index=False, header=False)
                    start_row += 1
                    df_ini.to_excel(writer, sheet_name=sheet,
                                    startrow=start_row, index=False)
                    start_row += len(df_ini) + 2

                # 3) Segmentos finais (stats pós-regras espaciais)
                if nome in seg_adj_dict:
                    seg_a, col_e = seg_adj_dict[nome]
                    df_fin = _stats_por_segmento(seg_a, col_e)
                    header_fin = pd.DataFrame(
                        [[f'SEGMENTOS FINAIS (pós-regras {min_comp}–{max_comp} m)']], columns=[''])
                    header_fin.to_excel(writer, sheet_name=sheet,
                                        startrow=start_row, index=False, header=False)
                    start_row += 1
                    df_fin.to_excel(writer, sheet_name=sheet,
                                    startrow=start_row, index=False)
                    start_row += len(df_fin) + 2

                # 4) Comparação inicial vs final
                row_comp = pd.DataFrame(rows_comp)
                row_comp = row_comp[row_comp['Método'] == nome]
                header_comp = pd.DataFrame([['COMPARAÇÃO INICIAL vs FINAL']], columns=[''])
                header_comp.to_excel(writer, sheet_name=sheet,
                                     startrow=start_row, index=False, header=False)
                start_row += 1
                row_comp.to_excel(writer, sheet_name=sheet,
                                  startrow=start_row, index=False)
                start_row += len(row_comp) + 2

                # 5) AutoResearch (se disponível)
                if st.session_state.get('ar_done', False):
                    df_ar_all = st.session_state.get('ar_df', pd.DataFrame())
                    df_ar_met = df_ar_all[df_ar_all['Método'] == nome]
                    if not df_ar_met.empty:
                        header_ar = pd.DataFrame(
                            [['AUTORESEARCH — Varredura de hiperparâmetros']], columns=[''])
                        header_ar.to_excel(writer, sheet_name=sheet,
                                           startrow=start_row, index=False, header=False)
                        start_row += 1
                        df_ar_met.to_excel(writer, sheet_name=sheet,
                                           startrow=start_row, index=False)
                        start_row += len(df_ar_met) + 2

            # 6) Aba dados originais: deflexão bruta
            try:
                df_defl_orig = pd.read_excel('deflexao_seg_homogenea.xlsx')
            except Exception:
                df_defl_orig = pd.DataFrame({'Erro': ['Arquivo deflexao_seg_homogenea.xlsx não encontrado']})
            df_defl_orig.to_excel(writer, sheet_name='Dados_Deflexao',
                                  index=False)

            # 7) Aba dados originais: d0 + IRI (200 em 200 m)
            try:
                df_d0iri_orig = pd.read_excel('010_dados_pesquisa.xlsx')
            except Exception:
                df_d0iri_orig = pd.DataFrame({'Erro': ['Arquivo 010_dados_pesquisa.xlsx não encontrado']})
            df_d0iri_orig.to_excel(writer, sheet_name='Dados_d0_IRI',
                                   index=False)

        buf.seek(0)
        return buf

    excel_buf = _build_excel()
    st.download_button(
        label="📥 Baixar Excel (CDA / Ward 1D / PELT)",
        data=excel_buf,
        file_name="resultados_segmentacao_comparativo.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        type="primary",
        use_container_width=True,
    )

# ═══════════════════════════════════════════════════════════════════════════════
# ABA 3 — AUDITORIA ESTATÍSTICA
# ═══════════════════════════════════════════════════════════════════════════════
with tab_auditoria:
    if not st.session_state.get('pipeline_requested', False):
        st.info("Execute o pipeline primeiro.")
        st.stop()

    seg120, X_df, vars_ok = construir_features(seg120, vars_clustering=features_selecionadas)
    X = X_df.values
    X_scaled, _ = padronizar(X)

    # Gap Statistic
    st.subheader("1. Gap Statistic")
    st.caption("**[Artigo — Figura 9]** Justificativa do k ótimo")
    df_gap, k_otimo = gap_statistic(X_scaled, max_k=10, n_refs=10)
    st.write(f"**k ótimo: {k_otimo}** (Tibshirani et al., 2001)")
    fig_gap = px.bar(df_gap, x='k', y='Gap', error_y='s_k',
                      title=f'Gap Statistic (k* = {k_otimo})',
                      template='plotly_white')
    fig_gap.add_vline(x=k_otimo, line_dash='dash', line_color='red',
                       annotation_text=f'k*={k_otimo}')
    fig_gap.update_layout(height=400)
    st.plotly_chart(fig_gap, use_container_width=True)

    st.markdown(f"""
    **Justificativa dos hiperparâmetros:**
    - **Ward 1D k={ward_k}**: Gap Statistic sugere k*={k_otimo}. O valor k={ward_k}
      foi adotado para produzir segmentos com comprimentos compatíveis com
      unidades de intervenção (600–4.000 m), balanceando resolução e praticidade.
    - **PELT β={pelt_pen}, modelo={pelt_model}**: A penalização β controla o trade-off
      entre número de breakpoints e ajuste dos dados (Killick et al., 2012).
      β={pelt_pen} produz segmentação com número similar ao Ward, permitindo comparação.
    - **CDA λ={cda_conf}**: Valor padrão da AASHTO (Thomas & Papagiannakis, 1997).
    """)

    # ARI cruzado
    st.subheader("2. Concordância entre métodos (ARI)")
    st.caption("**[Artigo — Figura 10]**")
    labels_dict = {}
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        if col_cl in seg120.columns:
            labels_dict[nome] = {'labels': seg120[col_cl].values}

    if len(labels_dict) >= 2:
        df_ari = matriz_ari_cruzado(labels_dict)
        fig_ari = px.imshow(df_ari.values, x=df_ari.columns.tolist(),
                             y=df_ari.index.tolist(), text_auto='.3f',
                             color_continuous_scale='RdYlGn', aspect='auto',
                             title='Matriz ARI — Concordância')
        fig_ari.update_layout(template='plotly_white', height=380)
        st.plotly_chart(fig_ari, use_container_width=True)
        st.dataframe(df_ari.round(4), use_container_width=True)

    # Kruskal-Wallis
    st.subheader("3. Kruskal-Wallis por método")
    for nome in TODOS_METODOS:
        col_cl = METODO_COL[nome]
        if col_cl not in seg120.columns:
            continue
        with st.expander(f"**{nome}**", expanded=True):
            try:
                kw = teste_kruskal_wallis(seg120, col_cl, vars_ok)
                if kw is not None and not kw.empty:
                    st.dataframe(kw, use_container_width=True, hide_index=True)
            except Exception:
                pass
            try:
                fi = feature_importance_xgb(X_scaled, seg120[col_cl].values,
                                            feature_names=vars_ok)
                if fi is not None and not fi.empty:
                    st.write("**Feature Importance (XGBoost):**")
                    st.dataframe(fi, use_container_width=True, hide_index=True)
            except Exception:
                pass

    # Bootstrap
    st.subheader("4. Estabilidade Bootstrap (Ward 1D)")
    if 'cluster_ward1d' in seg120.columns:
        try:
            ari_m, ari_s = estabilidade_bootstrap(
                X_scaled, seg120['cluster_ward1d'].values, n_boot=20)
            if ari_m is not None:
                st.metric("ARI médio", f"{ari_m:.4f} ± {ari_s:.4f}")
        except Exception as e:
            st.warning(f"Erro: {e}")

# ═══════════════════════════════════════════════════════════════════════════════
# ABA 4 — AUTO-RESEARCH (varredura de hiperparâmetros)
# ═══════════════════════════════════════════════════════════════════════════════
with tab_autoresearch:
    st.subheader("🤖 AutoResearch — Varredura Sistemática")
    st.caption(
        "Executar varredura de hiperparâmetros: CDA (d0, λ variável), "
        "Ward 1D (3 features, k variável), PELT (3 features, β×modelo variável)."
    )
    run_ar = st.button("▶️ Executar AutoResearch", type="secondary",
                        use_container_width=True)

    if run_ar or st.session_state.get('ar_done', False):
        if not st.session_state.get('ar_done', False):
            seg120, X_df, vars_ok = construir_features(
                seg120, vars_clustering=features_selecionadas)
            X = X_df.values
            X_scaled, _ = padronizar(X)
            defl_vals = seg120['Deflexao'].values
            seg120 = _km_acumulado(seg120)

            ar_rows = []
            prog = st.progress(0, text="AutoResearch...")

            # CDA sweep (d0 bruto, λ variável)
            cda_lambdas = [0.8, 1.0, 1.2]
            for i, lam in enumerate(cda_lambdas):
                lbls, _ = cda_segmentation(defl_vals, confianca=lam)
                n_seg = len(set(lbls))
                sil = silhouette_score(X_scaled, lbls) if n_seg > 1 else None
                xr = avaliar_extrinseco_xgb(X_scaled, lbls)
                xa = xr.get('xgb_accuracy_cv') if isinstance(xr, dict) else None
                vi = variancia_intra(X_scaled, lbls)
                # num seg after spatial rules
                seg120[f'_tmp_ar'] = lbls
                sa = aplicar_regras_espaciais(seg120, '_tmp_ar',
                                              min_comprimento_m=min_comp,
                                              max_comprimento_m=max_comp)
                ce = '_tmp_ar_espacial'
                n_fin = len(set(sa[ce].values)) if ce in sa.columns else n_seg
                ar_rows.append({
                    'Método': 'CDA', 'Features': 'd0',
                    'Hiperparâmetros': f'λ={lam}',
                    'Seg. ini': n_seg, 'Seg. fin': n_fin,
                    'Silhouette': round(sil, 4) if sil else None,
                    'XGB 5-fold': round(xa, 4) if xa else None,
                    'Std Intra': round(vi, 4) if vi else None,
                })
                prog.progress((i + 1) / (len(cda_lambdas) + 9))

            # Ward sweep (3 features, k variável)
            ward_ks = [5, 7, 9]
            for i, k in enumerate(ward_ks):
                lbls, _, _ = ward1d_linear(X_scaled, k)
                n_seg = len(set(lbls))
                sil = silhouette_score(X_scaled, lbls) if n_seg > 1 else None
                xr = avaliar_extrinseco_xgb(X_scaled, lbls)
                xa = xr.get('xgb_accuracy_cv') if isinstance(xr, dict) else None
                vi = variancia_intra(X_scaled, lbls)
                seg120['_tmp_ar'] = lbls
                sa = aplicar_regras_espaciais(seg120, '_tmp_ar',
                                              min_comprimento_m=min_comp,
                                              max_comprimento_m=max_comp)
                ce = '_tmp_ar_espacial'
                n_fin = len(set(sa[ce].values)) if ce in sa.columns else n_seg
                ar_rows.append({
                    'Método': 'Ward 1D', 'Features': ', '.join(vars_ok),
                    'Hiperparâmetros': f'k={k}',
                    'Seg. ini': n_seg, 'Seg. fin': n_fin,
                    'Silhouette': round(sil, 4) if sil else None,
                    'XGB 5-fold': round(xa, 4) if xa else None,
                    'Std Intra': round(vi, 4) if vi else None,
                })
                prog.progress((len(cda_lambdas) + i + 1) / (len(cda_lambdas) + 9))

            # PELT sweep (3 features, β × modelo)
            pelt_configs = [
                ('l2', 8), ('l2', 12), ('l2', 20),
                ('rbf', 8), ('rbf', 12), ('rbf', 20),
            ]
            for i, (mod, pen) in enumerate(pelt_configs):
                try:
                    lbls, _, _ = pelt_segmentation(
                        X_scaled, model=mod, min_size=3, pen=pen)
                    n_seg = len(set(lbls))
                    sil = silhouette_score(X_scaled, lbls) if n_seg > 1 else None
                    xr = avaliar_extrinseco_xgb(X_scaled, lbls)
                    xa = xr.get('xgb_accuracy_cv') if isinstance(xr, dict) else None
                    vi = variancia_intra(X_scaled, lbls)
                    seg120['_tmp_ar'] = lbls
                    sa = aplicar_regras_espaciais(seg120, '_tmp_ar',
                                                  min_comprimento_m=min_comp,
                                                  max_comprimento_m=max_comp)
                    ce = '_tmp_ar_espacial'
                    n_fin = len(set(sa[ce].values)) if ce in sa.columns else n_seg
                except Exception:
                    n_seg, n_fin, sil, xa, vi = 1, 1, None, None, None
                ar_rows.append({
                    'Método': 'PELT', 'Features': ', '.join(vars_ok),
                    'Hiperparâmetros': f'{mod}, β={pen}',
                    'Seg. ini': n_seg, 'Seg. fin': n_fin,
                    'Silhouette': round(sil, 4) if sil else None,
                    'XGB 5-fold': round(xa, 4) if xa else None,
                    'Std Intra': round(vi, 4) if vi else None,
                })
                prog.progress((len(cda_lambdas) + 3 + i + 1) / (len(cda_lambdas) + 9))

            # cleanup
            if '_tmp_ar' in seg120.columns:
                seg120 = seg120.drop(columns=['_tmp_ar'])

            st.session_state['ar_df'] = pd.DataFrame(ar_rows)
            st.session_state['ar_done'] = True
            prog.progress(1.0, text="AutoResearch concluído ✅")

        df_ar = st.session_state['ar_df']

        st.subheader("📋 Resultados da varredura")
        st.dataframe(df_ar, use_container_width=True, hide_index=True)

        # Gráfico: Silhouette por configuração
        st.subheader("📊 Silhouette por configuração")
        df_ar['Config'] = df_ar['Método'] + ' | ' + df_ar['Hiperparâmetros']
        fig_ar = px.bar(df_ar.dropna(subset=['Silhouette']),
                         x='Config', y='Silhouette', color='Método',
                         color_discrete_map=CORES_METODO,
                         template='plotly_white', text='Silhouette',
                         title='Silhouette Score — Varredura de Hiperparâmetros')
        fig_ar.update_layout(height=450, xaxis_tickangle=-45)
        st.plotly_chart(fig_ar, use_container_width=True)

        # Gráfico: Seg finais por configuração
        st.subheader("📊 Nº segmentos finais")
        fig_sf = px.bar(df_ar, x='Config', y='Seg. fin', color='Método',
                         color_discrete_map=CORES_METODO,
                         template='plotly_white', text='Seg. fin',
                         title='Segmentos finais (pós-regras espaciais)')
        fig_sf.update_layout(height=450, xaxis_tickangle=-45)
        st.plotly_chart(fig_sf, use_container_width=True)

    # ── Análise de Features (independente do botão AutoResearch) ──────────
    st.divider()
    st.subheader("🔬 Seleção de Features — Como o pipeline escolheu?")
    st.caption(
        "Resultados da varredura exaustiva de combinações de features sobre "
        "todos os métodos. Fonte: artigo_enacor_v2/resultados_features.json"
    )

    _feat_path = Path('artigo_enacor_v2/resultados_features.json')
    if _feat_path.exists():
        import json as _json
        with open(_feat_path, 'r', encoding='utf-8') as _f:
            _feat_data = _json.load(_f)
        df_feat = pd.DataFrame(_feat_data)
        df_feat['feat_str'] = df_feat['features'].apply(lambda x: ' + '.join(sorted(x)))
        df_feat['n_features'] = df_feat['features'].apply(len)

        # Filtrar métodos relevantes para o artigo
        _metodos_artigo = ['CDA', 'Ward 1D', 'PELT (beta=3)']
        _nome_map = {'PELT (beta=3)': 'PELT'}
        df_fa = df_feat[df_feat['metodo'].isin(_metodos_artigo)].copy()
        df_fa['Método'] = df_fa['metodo'].replace(_nome_map)

        # ── 1) Heatmap: Silhouette por combinação de features × método ────
        st.markdown("#### 1. Heatmap — Silhouette por combinação de features")
        _pivot_sil = df_fa.pivot_table(
            index='feat_str', columns='Método', values='silhouette', aggfunc='first'
        ).sort_index()
        # Ordenar por silhouette média decrescente
        _pivot_sil['_media'] = _pivot_sil.mean(axis=1)
        _pivot_sil = _pivot_sil.sort_values('_media', ascending=False).drop(columns='_media')

        fig_hm = go.Figure(data=go.Heatmap(
            z=_pivot_sil.values,
            x=_pivot_sil.columns.tolist(),
            y=_pivot_sil.index.tolist(),
            colorscale='RdYlGn', zmid=0,
            text=np.round(_pivot_sil.values, 3),
            texttemplate='%{text}', textfont=dict(size=10),
            colorbar=dict(title='Silhouette'),
        ))
        fig_hm.update_layout(
            template='plotly_white', height=max(400, len(_pivot_sil) * 22 + 120),
            title='Silhouette Score por combinação de features e método',
            yaxis=dict(autorange='reversed', dtick=1),
            xaxis=dict(side='top'),
        )
        st.plotly_chart(fig_hm, use_container_width=True)

        # ── 2) Bar: XGB Accuracy por combinação de features (top 15) ─────
        st.markdown("#### 2. Acurácia XGB por combinação de features (Top 15)")
        _top_xgb = (
            df_fa.groupby(['feat_str', 'Método'])['acuracia_xgboost']
            .max().reset_index()
            .sort_values('acuracia_xgboost', ascending=False)
            .head(15)
        )
        fig_xgb = px.bar(
            _top_xgb, x='acuracia_xgboost', y='feat_str', color='Método',
            orientation='h', color_discrete_map=CORES_METODO,
            template='plotly_white', text='acuracia_xgboost',
            title='Top 15 — Acurácia XGB 5-fold por combinação de features',
            labels={'acuracia_xgboost': 'Acurácia XGB', 'feat_str': 'Features'},
        )
        fig_xgb.update_traces(texttemplate='%{text:.3f}', textposition='outside')
        fig_xgb.update_layout(height=500, yaxis=dict(autorange='reversed'))
        st.plotly_chart(fig_xgb, use_container_width=True)

        # ── 3) Linha: Score vs nº de features ────────────────────────────
        st.markdown("#### 3. Evolução do Silhouette com nº de features")
        _agg_nf = (
            df_fa.groupby(['n_features', 'Método'])
            .agg(sil_mean=('silhouette', 'mean'),
                 sil_max=('silhouette', 'max'),
                 xgb_mean=('acuracia_xgboost', 'mean'))
            .reset_index()
        )
        fig_nf = px.line(
            _agg_nf, x='n_features', y='sil_max', color='Método',
            markers=True, color_discrete_map=CORES_METODO,
            template='plotly_white',
            title='Melhor Silhouette vs Nº de features (por método)',
            labels={'n_features': 'Nº de features', 'sil_max': 'Silhouette (máx)'},
        )
        fig_nf.update_layout(height=400)
        st.plotly_chart(fig_nf, use_container_width=True)

        # ── 4) Melhor combo por método (tabela resumo) ───────────────────
        st.markdown("#### 4. Melhor combinação de features por método")
        _best_rows = []
        for met in ['CDA', 'Ward 1D', 'PELT']:
            sub = df_fa[df_fa['Método'] == met].dropna(subset=['silhouette'])
            if len(sub):
                best_sil = sub.loc[sub['silhouette'].idxmax()]
                best_xgb = sub.loc[sub['acuracia_xgboost'].idxmax()]
                _best_rows.append({
                    'Método': met,
                    'Melhor por Silhouette': best_sil['feat_str'],
                    'Sil': round(best_sil['silhouette'], 4),
                    'Melhor por XGB': best_xgb['feat_str'],
                    'XGB': round(best_xgb['acuracia_xgboost'], 4),
                })
        if _best_rows:
            st.dataframe(pd.DataFrame(_best_rows), use_container_width=True, hide_index=True)

        # ── 5) Feature Importance (XGB) por método ───────────────────────
        st.markdown("#### 5. Feature Importance (XGB) por método — features selecionadas")
        _imp_frames = []
        for met_key, met_name in [('cda', 'CDA'), ('ward_1d', 'Ward 1D'), ('pelt', 'PELT')]:
            p = Path(f'artigo_enacor_v2/feat_importance_{met_key}.csv')
            if p.exists():
                _df_imp = pd.read_csv(p)
                _df_imp['Método'] = met_name
                _imp_frames.append(_df_imp)
        if _imp_frames:
            df_imp_all = pd.concat(_imp_frames, ignore_index=True)
            fig_imp = px.bar(
                df_imp_all, x='Feature', y='Importância (%)', color='Método',
                barmode='group', color_discrete_map=CORES_METODO,
                template='plotly_white', text='Importância (%)',
                title='Importância das features (XGB) para discriminar segmentos',
            )
            fig_imp.update_traces(texttemplate='%{text:.1f}%', textposition='outside')
            fig_imp.update_layout(height=450)
            st.plotly_chart(fig_imp, use_container_width=True)
            st.caption(
                "Importância calculada via XGBoost treinado para prever o label de cada "
                "segmento. Valores mais altos = feature mais discriminante."
            )
        else:
            st.info("Arquivos de feature importance não encontrados. Execute run_artigo.py.")
    else:
        st.info("Arquivo resultados_features.json não encontrado. Execute a varredura de features primeiro.")
