"""
Segmentação Homogênea LINEAR — App para Artigo Científico
3 métodos: CDA (manual), Ward 1D e PELT (multivariados).

CDA: segmentos definidos manualmente pelo engenheiro (planilha SH/Inicio/Fim).
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
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.ticker as mticker
import matplotlib.transforms as mtransforms
from matplotlib.patches import Rectangle

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
        return 'manual'
    elif nome == 'CDA (Dc)':
        return 'manual (Dc)'
    else:
        return ', '.join(vars_ok)

# ── Configuração da página ────────────────────────────────────────────────────
st.set_page_config(
    page_title="Artigo — Segmentação Linear (CDA × Ward 1D × PELT)",
    page_icon="📄", layout="wide",
)
st.title("📄 Segmentação Homogênea Linear — CDA × Ward 1D × PELT")
st.caption(
    "CDA: segmentos definidos manualmente pelo engenheiro. "
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

# ── Matplotlib: 20 cores RGB para fundo dos segmentos ─────────────────────────
_BG_RGBA = [(mcolors.to_rgba(c, alpha=0.22)) for c in _BG_COLORS]

_svg_counter = [0]  # mutable counter for unique keys

def _svg_download(fig, label='figura'):
    """Adiciona botão de download SVG para uma figura matplotlib."""
    buf = BytesIO()
    fig.savefig(buf, format='svg', bbox_inches='tight')
    buf.seek(0)
    _svg_counter[0] += 1
    fname = label.replace(' ', '_').replace('—', '-').replace('/', '_')
    st.download_button(
        '⬇ SVG', buf.getvalue(),
        file_name=f'{fname}.svg', mime='image/svg+xml',
        key=f'svg_{_svg_counter[0]}',
    )


def _svg_download_plotly(fig, label='figura'):
    """Adiciona botão de download SVG para uma figura Plotly."""
    svg_bytes = fig.to_image(format='svg')
    _svg_counter[0] += 1
    fname = label.replace(' ', '_').replace('—', '-').replace('/', '_')
    st.download_button(
        '⬇ SVG', svg_bytes,
        file_name=f'{fname}.svg', mime='image/svg+xml',
        key=f'svg_{_svg_counter[0]}',
    )


def _fig_segmentos_mpl(seg, col_cl, titulo, col_defl='Deflexao', label_defl='d0 (μm)'):
    """
    Gráfico de alta qualidade (matplotlib) com 2 eixos Y:
    deflexão (esquerda, azul) e IRI (direita, vermelho).
    Rótulos S1..Sn anti-sobreposição: algoritmo greedy de até 4 níveis de altura.
    Y-axis limitado aos dados; labels posicionados via transformada mista.
    """
    labels_col = seg[col_cl].values
    x = seg['km_acum'].values
    y_defl = seg[col_defl].values
    has_iri = 'iri_medio' in seg.columns and seg['iri_medio'].notna().any()
    y_iri = seg['iri_medio'].values if has_iri else None

    # Agrupar segmentos contíguos
    segs_uniq = []
    start, cur = 0, labels_col[0]
    for i in range(1, len(labels_col)):
        if labels_col[i] != cur:
            segs_uniq.append((start, i - 1, cur))
            start, cur = i, labels_col[i]
    segs_uniq.append((start, len(labels_col) - 1, cur))

    _x_total = x[-1] - x[0] if len(x) > 1 else 1.0

    # ── Meia-largura estimada de um rótulo "S12" em unidades de dados ─────
    # Largura dinâmica: garante ~0.9 pol por segmento (mín 14 pol)
    _n_segs = len(segs_uniq)
    _fig_w = max(14, _n_segs * 0.9)
    _label_half_w = _x_total * (0.40 / (_fig_w * 0.83))

    # ── Atribuir níveis greedy (4 níveis) para manter todos os rótulos ───
    _N_LEVELS = 4
    _lvl_right = {}          # borda direita ocupada em cada nível
    _lbl_info = []           # (x_mid, x_front, level)
    for i0, i1, _lbl in segs_uniq:
        sl_x = x[i0:i1 + 1]
        x_mid = (sl_x[0] + sl_x[-1]) / 2.0
        x_front = sl_x[0]

        assigned = _N_LEVELS - 1
        for lvl in range(_N_LEVELS):
            prev_right = _lvl_right.get(lvl, -1e9)
            if prev_right <= x_mid - _label_half_w * 2.1:
                assigned = lvl
                break
        _lvl_right[assigned] = x_mid + _label_half_w * 2.1
        _lbl_info.append((x_mid, x_front, assigned))

    # ── Criar figura ──────────────────────────────────────────────────────
    fig, ax1 = plt.subplots(figsize=(_fig_w, 5.2), dpi=150)
    ax1.set_facecolor('white')
    fig.patch.set_facecolor('white')

    # ── Limites Y ajustados ao dado (sem inflação) ────────────────────────
    y_max_data = float(np.nanmax(y_defl))
    y_min_data = float(np.nanmin(y_defl))
    y_range = y_max_data - y_min_data if y_max_data != y_min_data else 1.0
    y_lo = y_min_data - y_range * 0.06
    y_hi = y_max_data + y_range * 0.10
    ax1.set_ylim(y_lo, y_hi)

    # ── Transformada mista: x em dados, y em fração do eixo ──────────────
    trans = mtransforms.blended_transform_factory(ax1.transData, ax1.transAxes)
    _base_y = 1.01
    _raised_y = 1.07
    _raised2_y = 1.13
    _min_gap_for_overlap = _label_half_w * 2.8
    _placed_labels = []

    # ── Fronteiras e rótulos ──────────────────────────────────────────────
    for seg_idx, (x_mid, x_front, lvl) in enumerate(_lbl_info):
        if seg_idx > 0:
            ax1.axvline(x_front, color='#333333', linewidth=1.35,
                        linestyle=(0, (4, 3)), alpha=0.88, zorder=2)
        _y_txt = _base_y
        _overlap_base = any(abs(x_mid - p_x) < _min_gap_for_overlap and p_y == _base_y for p_x, p_y in _placed_labels)
        if _overlap_base:
            _y_txt = _raised_y
            _overlap_raised = any(abs(x_mid - p_x) < _min_gap_for_overlap and p_y == _raised_y for p_x, p_y in _placed_labels)
            if _overlap_raised:
                _y_txt = _raised2_y
        ax1.text(x_mid, _y_txt, f'S{seg_idx + 1}',
                 transform=trans, clip_on=False,
                 ha='center', va='bottom',
                 fontsize=8.8, color='#111111', fontweight='bold', zorder=4)
        _placed_labels.append((x_mid, _y_txt))

    # ── Linha de deflexão (contínua, azul) ────────────────────────────────
    ax1.plot(x, y_defl, color=_COLOR_DEFL, linewidth=1.6, marker='o',
             markersize=2.5, markerfacecolor=_COLOR_DEFL, markeredgewidth=0,
             label=label_defl, zorder=3)
    ax1.set_xlabel('Distância acumulada (km)', fontsize=12, labelpad=10, fontweight='bold')
    ax1.set_ylabel(label_defl, color=_COLOR_DEFL, fontsize=12, fontweight='bold')
    ax1.tick_params(axis='y', colors=_COLOR_DEFL, labelsize=10)
    ax1.tick_params(axis='x', labelsize=10)
    for _lbl in ax1.get_xticklabels() + ax1.get_yticklabels():
        _lbl.set_fontweight('semibold')
    ax1.yaxis.grid(True, color='#505050', alpha=0.28, linewidth=0.7, linestyle='-')
    ax1.xaxis.grid(True, color='#cccccc', alpha=0.5, linewidth=0.4)
    ax1.set_axisbelow(True)

    # ── Linha de IRI (contínua, vermelho, eixo direito) ───────────────────
    if has_iri:
        ax2 = ax1.twinx()
        iri_min = float(np.nanmin(y_iri))
        iri_max = float(np.nanmax(y_iri))
        iri_rng = iri_max - iri_min if iri_max != iri_min else 1.0
        ax2.set_ylim(iri_min - iri_rng * 0.06, iri_max + iri_rng * 0.10)
        ax2.plot(x, y_iri, color=_COLOR_IRI, linewidth=1.4, marker='D',
                 markersize=2.2, markerfacecolor=_COLOR_IRI, markeredgewidth=0,
                 label='IRI (m/km)', zorder=3)
        ax2.set_ylabel('IRI (m/km)', color=_COLOR_IRI, fontsize=12, fontweight='bold')
        ax2.tick_params(axis='y', colors=_COLOR_IRI, labelsize=10)
        for _lbl in ax2.get_yticklabels():
            _lbl.set_fontweight('semibold')
        ax2.yaxis.grid(True, color='#000000', alpha=0.12, linewidth=0.5, linestyle=':')
        ax2.set_axisbelow(True)
        ax2.spines['right'].set_color(_COLOR_IRI)
        ax2.spines['right'].set_linewidth(1.2)
        ax2.spines['top'].set_visible(False)
    else:
        ax2 = None

    ax1.spines['left'].set_color(_COLOR_DEFL)
    ax1.spines['left'].set_linewidth(1.2)
    ax1.spines['top'].set_visible(False)

    # ── Título ────────────────────────────────────────────────────────────
    fig.suptitle(titulo, fontsize=12.5, fontweight='bold', y=1.07)

    # ── Legenda combinada (abaixo do gráfico, âncora na figura) ───────────
    lines1, labels1 = ax1.get_legend_handles_labels()
    if ax2:
        lines2, labels2 = ax2.get_legend_handles_labels()
        lines1 += lines2
        labels1 += labels2
    fig.legend(lines1, labels1, loc='lower center',
               bbox_to_anchor=(0.5, 0.02), ncol=2, fontsize=10,
               frameon=True, fancybox=True, shadow=False,
               edgecolor='#b0b0b0', framealpha=0.96)

    fig.subplots_adjust(left=0.08, right=0.92, bottom=0.22, top=0.90)
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

    col_up1, col_up2 = st.columns(2)
    with col_up1:
        uploaded = st.file_uploader("📂 Dados GO-010 (Excel/CSV)",
                                    type=['xlsx', 'xls', 'csv'])
        st.caption("km_inicial, km_final, iri_medio, d0")
    with col_up2:
        uploaded_cda = st.file_uploader("📎 Segmentos CDA (manual)",
                                        type=['xlsx', 'xls', 'csv'],
                                        key='cda_upload')
        st.caption("SH, Inicio, Fim (Zi opcional)")

    col_km_ini = st.text_input("Coluna km inicial", value="km_inicial")
    col_km_fim = st.text_input("Coluna km final", value="km_final")
    col_iri = st.text_input("Coluna IRI médio", value="iri_medio")
    col_def = st.text_input("Coluna d0", value="d0")

    with st.expander("Colunas CDA (nomes)"):
        col_cda_sh = st.text_input("Coluna nº segmento", value="SH")
        col_cda_ini = st.text_input("Coluna início", value="Inicio")
        col_cda_fim = st.text_input("Coluna fim", value="Fim")

    st.subheader("Hiperparâmetros")

    with st.expander("Ward 1D (multivariado — 3 features)"):
        ward_k = st.slider("Número de clusters (k)", 2, 20, 7,
                            help="Gap Statistic sugere k ótimo; default 7")

    with st.expander("PELT (multivariado — 3 features)"):
        pelt_model = st.selectbox("Modelo de custo", ['l2', 'rbf'], index=0)
        pelt_min_size = st.slider("Tamanho mínimo de segmento", 2, 10, 3)
        pelt_pen = st.slider("Penalização (β)", 1, 100, 4)

    st.subheader("Regras Espaciais")
    min_comp = st.slider("Comprimento mínimo (m)", 200, 5000, 600, 100)
    max_comp = st.slider("Comprimento máximo (m)", 1000, 10000, 5000, 200)

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
    | **CDA** | Manual (engenheiro) | Segmentos definidos em planilha | Thomas & Papagiannakis (1997) |
    | **Ward 1D** | Clustering hierárquico | d0+σ, IRI, CV (multivariado) | Ward Jr. (1963) |
    | **PELT** | Change-point detection | d0+σ, IRI, CV (multivariado) | Killick et al. (2012) |

    **Justificativa**: O CDA clássico é feito manualmente por engenheiros, que definem
    os segmentos homogêneos com base em análise visual. Ward 1D e PELT incorporam
    indicadores de engenharia (deflexão característica, IRI e coeficiente de variação)
    para segmentação multivariada, permitindo comparação direta entre abordagens
    manual e computacional.
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
    st.subheader("1. Dados brutos — GO-334 (GOINFRA)")
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
        _svg_download_plotly(fig_h, 'histograma_d0')
    with col2:
        if 'iri_medio' in seg120.columns and seg120['iri_medio'].notna().any():
            fig_h2 = px.histogram(seg120, x='iri_medio', nbins=30,
                                   title='IRI',
                                   labels={'iri_medio': 'IRI (m/km)', 'count': 'Freq.'},
                                   template='plotly_white', color_discrete_sequence=['#ff7f0e'])
            fig_h2.update_layout(height=320)
            st.plotly_chart(fig_h2, use_container_width=True)
            _svg_download_plotly(fig_h2, 'histograma_IRI')

    # Perfil longitudinal
    st.subheader("6. Perfil longitudinal bruto")
    st.caption("**[Artigo — Figura 2]**")
    _x_km = seg120['km_acum'].values
    _y_d0 = seg120['Deflexao'].values
    _has_iri_raw = 'iri_medio' in seg120.columns and seg120['iri_medio'].notna().any()
    _y_iri_raw = seg120['iri_medio'].values if _has_iri_raw else None

    fig_perfil, _ax_d0 = plt.subplots(figsize=(14, 4.5), dpi=150)
    _ax_d0.set_facecolor('white')
    fig_perfil.patch.set_facecolor('white')

    _ax_d0.plot(_x_km, _y_d0, color=_COLOR_DEFL, linewidth=1.4, marker='o',
                markersize=2.2, markerfacecolor=_COLOR_DEFL, markeredgewidth=0,
                label='d₀ (μm)', zorder=3)
    _ax_d0.set_xlabel('Distância acumulada (km)', fontsize=12, labelpad=10, fontweight='bold')
    _ax_d0.set_ylabel('d₀ (μm)', color=_COLOR_DEFL, fontsize=12, fontweight='bold')
    _ax_d0.tick_params(axis='y', colors=_COLOR_DEFL, labelsize=10)
    _ax_d0.tick_params(axis='x', labelsize=10)
    for _lbl in _ax_d0.get_xticklabels() + _ax_d0.get_yticklabels():
        _lbl.set_fontweight('semibold')
    _ax_d0.yaxis.grid(True, color='#505050', alpha=0.28, linewidth=0.7, linestyle='-')
    _ax_d0.xaxis.grid(True, color='#cccccc', alpha=0.5, linewidth=0.4)
    _ax_d0.set_axisbelow(True)
    _ax_d0.spines['left'].set_color(_COLOR_DEFL)
    _ax_d0.spines['left'].set_linewidth(1.2)
    _ax_d0.spines['top'].set_visible(False)

    if _has_iri_raw:
        _ax_iri = _ax_d0.twinx()
        _ax_iri.plot(_x_km, _y_iri_raw, color=_COLOR_IRI, linewidth=1.2, marker='D',
                     markersize=2.0, markerfacecolor=_COLOR_IRI, markeredgewidth=0,
                     label='IRI (m/km)', zorder=3)
        _ax_iri.set_ylabel('IRI (m/km)', color=_COLOR_IRI, fontsize=12, fontweight='bold')
        _ax_iri.tick_params(axis='y', colors=_COLOR_IRI, labelsize=10)
        for _lbl in _ax_iri.get_yticklabels():
            _lbl.set_fontweight('semibold')
        _ax_iri.yaxis.grid(True, color='#000000', alpha=0.12, linewidth=0.5, linestyle=':')
        _ax_iri.set_axisbelow(True)
        _ax_iri.spines['right'].set_color(_COLOR_IRI)
        _ax_iri.spines['right'].set_linewidth(1.2)
        _ax_iri.spines['top'].set_visible(False)

        # ── Balancear eixos Y ──────────────────────────────────────────
        _d0_lo, _d0_hi = np.nanmin(_y_d0), np.nanmax(_y_d0)
        _ir_lo, _ir_hi = np.nanmin(_y_iri_raw), np.nanmax(_y_iri_raw)
        _d0_range = _d0_hi - _d0_lo if _d0_hi > _d0_lo else 1.0
        _ir_range = _ir_hi - _ir_lo if _ir_hi > _ir_lo else 1.0
        _margin = 0.08
        _ax_d0.set_ylim(_d0_lo - _margin * _d0_range, _d0_hi + _margin * _d0_range)
        _ax_iri.set_ylim(_ir_lo - _margin * _ir_range, _ir_hi + _margin * _ir_range)

        # Legenda combinada
        _ln1, _lb1 = _ax_d0.get_legend_handles_labels()
        _ln2, _lb2 = _ax_iri.get_legend_handles_labels()
        fig_perfil.legend(_ln1 + _ln2, _lb1 + _lb2, loc='lower center',
                      bbox_to_anchor=(0.5, 0.02), ncol=2, fontsize=9,
                      frameon=True, fancybox=True, shadow=False,
                      edgecolor='#cccccc')

    fig_perfil.suptitle('Perfil longitudinal bruto — d₀ e IRI',
                         fontsize=12.5, fontweight='bold', y=1.04)
    fig_perfil.tight_layout()
    fig_perfil.subplots_adjust(bottom=0.22, top=0.92)
    st.pyplot(fig_perfil, use_container_width=True)
    _svg_download(fig_perfil, 'perfil_longitudinal')
    plt.close(fig_perfil)

    # Features
    st.subheader("7. Indicadores para clustering")
    st.caption("**[Artigo — Tabela 2]**")
    if not features_selecionadas:
        st.warning("Selecione ao menos um indicador na barra lateral.")
        st.stop()

    seg120, X_df, vars_ok = construir_features(seg120, vars_clustering=features_selecionadas)
    st.info(f"**CDA**: segmentos manuais. **Ward 1D e PELT**: {', '.join(vars_ok)}")

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
    _svg_download_plotly(fig_corr, 'matriz_correlacao')

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

    # ── CDA (segmentos manuais) ───────────────────────────────────────────────
    progress.progress(0.1, text="CDA (segmentos manuais)...")
    if uploaded_cda is not None:
        df_cda_raw = carregar_dados(uploaded_cda)
        st.caption(f"Colunas CDA detectadas: {list(df_cda_raw.columns)}")
        # Validar colunas obrigatórias
        for _c in [col_cda_ini, col_cda_fim]:
            if _c not in df_cda_raw.columns:
                st.error(f"Coluna **{_c}** não encontrada. Disponíveis: {list(df_cda_raw.columns)}")
                st.stop()
            df_cda_raw[_c] = pd.to_numeric(df_cda_raw[_c], errors='coerce')
        has_sh = col_cda_sh in df_cda_raw.columns
        if has_sh:
            df_cda_raw[col_cda_sh] = pd.to_numeric(df_cda_raw[col_cda_sh], errors='coerce')
        df_cda_raw = df_cda_raw.dropna(subset=[col_cda_ini, col_cda_fim]).sort_values(col_cda_ini).reset_index(drop=True)

        # Usar distância acumulada (km_acum está em km)
        km_ref = seg120['km_acum'].values
        km_max = km_ref.max()

        # Auto-detectar unidade da planilha CDA e converter para km
        cda_max = df_cda_raw[col_cda_fim].max()
        if cda_max > km_max * 5:
            # Planilha CDA está em metros → converter para km
            df_cda_raw[col_cda_ini] = df_cda_raw[col_cda_ini] / 1000.0
            df_cda_raw[col_cda_fim] = df_cda_raw[col_cda_fim] / 1000.0
            st.info(f"Planilha CDA convertida de **metros** para **km** (detectado automaticamente).")

        st.info(
            f"Dados GO-010 (dist. acum.): **{km_ref.min():.3f}** a **{km_ref.max():.3f}** km | "
            f"Planilha CDA: **{df_cda_raw[col_cda_ini].min():.3f}** a **{df_cda_raw[col_cda_fim].max():.3f}** km"
        )

        cda_labels = np.full(len(seg120), -1, dtype=int)
        for idx_s, row_s in df_cda_raw.iterrows():
            ini_s = float(row_s[col_cda_ini])
            fim_s = float(row_s[col_cda_fim])
            seg_id = int(row_s[col_cda_sh]) if has_sh and pd.notna(row_s[col_cda_sh]) else idx_s
            mask = (km_ref >= ini_s) & (km_ref <= fim_s)
            cda_labels[mask] = seg_id
        # Pontos não cobertos: atribuir ao segmento mais próximo
        n_uncovered = (cda_labels == -1).sum()
        if n_uncovered > 0:
            covered = np.where(cda_labels != -1)[0]
            if len(covered) > 0:
                for i in np.where(cda_labels == -1)[0]:
                    closest = covered[np.argmin(np.abs(km_ref[covered] - km_ref[i]))]
                    cda_labels[i] = cda_labels[closest]
                st.warning(f"⚠️ {n_uncovered} pontos fora dos intervalos CDA — atribuídos ao segmento mais próximo.")
        seg120['cluster_cda'] = cda_labels
        # CDA (Dc) recebe os mesmos segmentos manuais
        seg120['cluster_cda_dc'] = cda_labels
        n_mapped = (cda_labels != -1).sum()
        n_segs_cda = len(set(cda_labels[cda_labels != -1]))
        st.success(
            f"CDA manual: {len(df_cda_raw)} segmentos na planilha → "
            f"{n_segs_cda} segmentos mapeados em {n_mapped}/{len(seg120)} pontos."
        )
        with st.expander("🔍 Debug — mapeamento CDA", expanded=False):
            st.write("**Planilha CDA carregada:**")
            st.dataframe(df_cda_raw, use_container_width=True, hide_index=True)
            st.write(f"**km_acum seg120**: min={km_ref.min():.4f}, max={km_ref.max():.4f}")
            st.write(f"**Labels CDA atribuídos**: {dict(zip(*np.unique(cda_labels, return_counts=True)))}")
    else:
        # Sem planilha CDA — preencher com segmento único
        seg120['cluster_cda'] = 0
        seg120['cluster_cda_dc'] = 0
        st.warning("⚠️ Planilha CDA não carregada — CDA terá um único segmento.")

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

    # Pré-calcula os segmentos finais para comparação de métricas (Tabela 4)
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

    # ══════════════════════════════════════════════════════════════════════════
    # TABELA COMPARATIVA PRÉ-REGRAS ESPACIAIS
    # ══════════════════════════════════════════════════════════════════════════
    st.header("Resultados — Segmentação Inicial")
    st.subheader("📊 Tabela comparativa de métricas")
    st.caption("**[Artigo — Tabela 4]** Segmentos iniciais e finais")

    rows_met_ini = []
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
        rows_met_ini.append({
            'Método': nome,
            'Features': _feat_info_label(nome, vars_ok),
            'Nº Seg.': n_seg,
            'Silhouette': round(sil, 4) if sil is not None else None,
            'XGB 5-fold': f'{xgb_acc:.1%}' if xgb_acc else '—',
            'Std Intra': round(vi, 4) if vi else None,
            'CV Intra': round(cv_intra, 3) if cv_intra is not None else None,
        })
    df_met_ini = pd.DataFrame(rows_met_ini)
    df_met = df_met_ini.copy()
    st.markdown("##### Segmentos iniciais")
    st.dataframe(df_met_ini, use_container_width=True, hide_index=True)

    rows_met_fin = []
    for nome in TODOS_METODOS:
        if nome not in seg_adj_dict:
            continue
        seg_fin, col_fin = seg_adj_dict[nome]
        X_fin = seg_fin[vars_ok].values
        X_fin_scaled, _ = padronizar(X_fin)
        lbls_fin = seg_fin[col_fin].values
        n_seg_fin = len(set(lbls_fin))
        sil_fin = silhouette_score(X_fin_scaled, lbls_fin) if n_seg_fin > 1 else None
        xgb_res_fin = avaliar_extrinseco_xgb(X_fin_scaled, lbls_fin)
        xgb_acc_fin = xgb_res_fin.get('xgb_accuracy_cv') if isinstance(xgb_res_fin, dict) else None
        vi_fin = variancia_intra(X_fin_scaled, lbls_fin)
        cvs_fin = []
        for c in sorted(set(lbls_fin)):
            mask = lbls_fin == c
            if mask.sum() > 1:
                cd = seg_fin.loc[mask, 'Deflexao']
                mu = cd.mean()
                if mu > 0:
                    cvs_fin.append(cd.std() / mu)
        cv_intra_fin = float(np.mean(cvs_fin)) if cvs_fin else None
        rows_met_fin.append({
            'Método': nome,
            'Features': _feat_info_label(nome, vars_ok),
            'Nº Seg.': n_seg_fin,
            'Silhouette': round(sil_fin, 4) if sil_fin is not None else None,
            'XGB 5-fold': f'{xgb_acc_fin:.1%}' if xgb_acc_fin else '—',
            'Std Intra': round(vi_fin, 4) if vi_fin else None,
            'CV Intra': round(cv_intra_fin, 3) if cv_intra_fin is not None else None,
        })
    if rows_met_fin:
        df_met_fin = pd.DataFrame(rows_met_fin)
        st.markdown(f"##### Segmentos finais (pós-regras {min_comp}–{max_comp} m)")
        st.dataframe(df_met_fin, use_container_width=True, hide_index=True)

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
        fig_d0 = _fig_segmentos_mpl(seg120, col_cl, f'{nome} — d0 + IRI ({feat_info})',
                                     col_defl='Deflexao', label_defl='d0 (μm)')
        st.pyplot(fig_d0, use_container_width=True)
        _svg_download(fig_d0, f'{nome}_d0_IRI_antes')
        plt.close(fig_d0)
        # Gráfico com Dc (Deflexão característica)
        if 'Deflexao_caract' in seg120.columns:
            fig_dc = _fig_segmentos_mpl(seg120, col_cl, f'{nome} — Dc + IRI ({feat_info})',
                                         col_defl='Deflexao_caract', label_defl='Dc (μm)')
            st.pyplot(fig_dc, use_container_width=True)
            _svg_download(fig_dc, f'{nome}_Dc_IRI_antes')
            plt.close(fig_dc)

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
            _svg_download_plotly(fig_st, f'{nome}_sigma_CV_antes')

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
        _svg_download_plotly(fig_box, f'{nome}_boxplot_d0')

    # ══════════════════════════════════════════════════════════════════════════
    # REGRAS ESPACIAIS + RESULTADOS FINAIS
    # ══════════════════════════════════════════════════════════════════════════
    st.header(f"Resultados — Após Regras Espaciais ({min_comp}–{max_comp} m)")
    st.caption(
        "Regras espaciais conforme HAAS; HUDSON; ZANIEWSKI (1994): "
        "segmentos homogêneos devem ter extensão compatível com unidades "
        "de intervenção em nível de rede."
    )

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
        fig_d0 = _fig_segmentos_mpl(seg_a, col_e, f'{nome} — d0 + IRI pós-regras ({feat_info})',
                                     col_defl='Deflexao', label_defl='d0 (μm)')
        st.pyplot(fig_d0, use_container_width=True)
        _svg_download(fig_d0, f'{nome}_d0_IRI_pos')
        plt.close(fig_d0)
        # Dc + IRI
        if 'Deflexao_caract' in seg_a.columns:
            fig_dc = _fig_segmentos_mpl(seg_a, col_e, f'{nome} — Dc + IRI pós-regras ({feat_info})',
                                         col_defl='Deflexao_caract', label_defl='Dc (μm)')
            st.pyplot(fig_dc, use_container_width=True)
            _svg_download(fig_dc, f'{nome}_Dc_IRI_pos')
            plt.close(fig_dc)

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
        _svg_download_plotly(fig_m, f'{nome}_mapa_pos')

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
            _svg_download_plotly(fig_st, f'{nome}_sigma_CV_pos')

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
    _svg_download_plotly(fig_cnt, 'contagem_segmentos')

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
    _svg_download_plotly(fig_gap, 'gap_statistic')

    st.markdown(f"""
    **Justificativa dos hiperparâmetros:**
    - **Ward 1D k={ward_k}**: Gap Statistic sugere k*={k_otimo}. O valor k={ward_k}
      foi adotado para produzir segmentos com comprimentos compatíveis com
      unidades de intervenção (600–4.000 m), balanceando resolução e praticidade.
    - **PELT β={pelt_pen}, modelo={pelt_model}**: A penalização β controla o trade-off
      entre número de breakpoints e ajuste dos dados (Killick et al., 2012).
      β={pelt_pen} produz segmentação com número similar ao Ward, permitindo comparação.
    - **CDA**: Segmentos definidos manualmente pelo engenheiro (Thomas & Papagiannakis, 1997).
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
        _svg_download_plotly(fig_ari, 'matriz_ARI')
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
# ABA 4 — AUTO-RESEARCH (varredura REAL completa com scoring composto)
# ═══════════════════════════════════════════════════════════════════════════════
with tab_autoresearch:
    st.subheader("🤖 AutoResearch — Varredura Sistemática REAL")
    st.caption(
        "Roda **cada configuração** no pipeline completo (segmentação → regras espaciais → métricas). "
        "Inclui CDA (d0 e Dc), Ward 1D e PELT. Score composto pondera Silhouette, CV, σ e número de segmentos."
    )

    with st.expander("📖 **O que o AutoResearch faz?** (clique para expandir)", expanded=False):
        st.markdown("""
**AutoResearch** é um módulo de varredura sistemática que testa automaticamente
*todas* as combinações de hiperparâmetros dos três métodos de segmentação, avaliando
cada configuração com métricas quantitativas rigorosas. O objetivo é encontrar
a configuração ótima de forma **data-driven**, sem viés do operador.

#### Etapas da varredura

1. **Grid de hiperparâmetros**: define-se o espaço de busca:
   - **CDA (d0)** e **CDA (Dc)**: λ ∈ {0.5, 0.75, 1.0, …, 3.0}
   - **Ward 1D**: k ∈ {k_min, …, k_max}, usando 3 features padronizadas
   - **PELT**: modelo × min_size × penalidade β

2. **Para cada configuração**, o pipeline executa:
   - Segmentação bruta → rótulos iniciais
   - **Regras espaciais** (comprimento mín/máx) → rótulos finais
   - **Métrica intrínseca**: Silhouette (separação entre segmentos)
   - **Métrica extrínseca**: Acurácia XGB 5-fold (explicabilidade dos clusters pelas features)
   - **Homogeneidade física**: CV e σ intra-segmento de d0, Dc e IRI —
     tanto como **média ponderada** pelo comprimento (CV̄w, σ̄w) quanto como
     **média aritmética simples** (CV̄s, σ̄s)

3. **Score composto**: pondera as métricas normalizadas:
   $\\text{Score} = w_1 \\cdot \\text{Sil}_{norm} + w_2 \\cdot (1 - \\text{CV}_{d0}) + w_3 \\cdot (1 - \\text{CV}_{IRI}) + w_4 \\cdot (1 - \\text{Std}_{norm}) + \\text{bônus}_{seg}$

4. **Determinação do k ótimo (Ward)**: para o Ward 1D, exibe-se a evolução de
   Sil, XGB, CV e σ em função de *k*, e o k ótimo é determinado por
   **consenso de ranking** (rank médio entre todas as métricas).

#### Por que duas médias (ponderada e simples)?

- **CV̄w / σ̄w (ponderada)**: pondera cada segmento pelo seu comprimento em metros —
  segmentos longos têm mais peso, refletindo a importância prática na gestão rodoviária.
- **CV̄s / σ̄s (simples)**: média aritmética sem ponderação — cada segmento tem peso igual,
  útil para verificar se a homogeneidade depende do tamanho do segmento.
  Se CV̄w ≪ CV̄s, segmentos maiores são mais homogêneos; se CV̄w ≈ CV̄s, a homogeneidade
  é uniforme entre segmentos.
""")

    col_ar1, col_ar2, col_ar3 = st.columns(3)
    with col_ar1:
        ar_ward_k_min = st.number_input("Ward k mín", 2, 30, 2)
        ar_ward_k_max = st.number_input("Ward k máx", 2, 30, 15)
    with col_ar2:
        ar_pelt_models = st.multiselect("PELT modelos", ['l2', 'rbf', 'l1'], default=['l2', 'rbf'])
        ar_pelt_min_sizes = st.multiselect("PELT min_size", [2, 3, 4, 5], default=[2, 3, 5])
    with col_ar3:
        ar_min_comp = st.slider("Comp. mínimo (m)", 200, 5000, 600, 100, key='ar_minc')
        ar_max_comp = st.slider("Comp. máximo (m)", 1000, 10000, 5000, 200, key='ar_maxc')

    ar_pelt_pens = st.multiselect(
        "PELT penalidades (β)",
        options=[1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100],
        default=[1, 3, 5, 8, 12, 20, 30, 50, 100],
    )

    # Pesos do score composto
    st.markdown("##### Pesos do Score Composto")
    st.caption("Score = w₁·Sil + w₂·(1−CV_d0) + w₃·(1−CV_IRI) + w₄·(1−Std_norm) + bonus_seg")
    col_w1, col_w2, col_w3, col_w4 = st.columns(4)
    with col_w1:
        w_sil = st.slider("Silhouette", 0.0, 1.0, 0.30, 0.05, key='w_sil')
    with col_w2:
        w_cvd0 = st.slider("CV d0", 0.0, 1.0, 0.25, 0.05, key='w_cvd0')
    with col_w3:
        w_cviri = st.slider("CV IRI", 0.0, 1.0, 0.25, 0.05, key='w_cviri')
    with col_w4:
        w_std = st.slider("Std intra", 0.0, 1.0, 0.20, 0.05, key='w_std')

    run_ar = st.button("▶️ Executar AutoResearch Completo", type="secondary",
                        use_container_width=True)

    if run_ar or st.session_state.get('ar_done_v2', False):
        if not st.session_state.get('ar_done_v2', False):

            # Preparar dados
            seg120_ar, X_df_ar, vars_ok_ar = construir_features(
                seg120.copy(), vars_clustering=features_selecionadas)
            X_ar = X_df_ar.values
            X_scaled_ar, _ = padronizar(X_ar)
            defl_vals_ar = seg120_ar['Deflexao'].values
            dc_vals_ar = seg120_ar['Deflexao_caract'].values if 'Deflexao_caract' in seg120_ar.columns else None
            seg120_ar = _km_acumulado(seg120_ar)

            ar_rows = []

            # ── Helper: métricas completas para UMA configuração ──────────
            def _ar_full_metrics(lbls, seg_df, nome, features_str, hparams_str):
                """Calcula métricas antes e depois da espacialização."""
                n_seg_ini = len(set(lbls))
                if n_seg_ini < 2:
                    return None

                # ── Métricas ANTES (intrínsecas + extrínsecas) ────────────
                intr_ini = avaliar_intrinseco(X_scaled_ar, lbls)
                sil_ini = intr_ini['silhouette'] if intr_ini else None
                xgb_res = avaliar_extrinseco_xgb(X_scaled_ar, lbls)
                xgb_acc = xgb_res.get('xgb_accuracy_cv') if isinstance(xgb_res, dict) else None
                vi_ini = variancia_intra(X_scaled_ar, lbls)

                # ── Helpers: CV e σ ponderados e simples ──────────────────
                def _cv_intra_w(labels, col):
                    """CV intra-segmento ponderado pelo comprimento."""
                    cvs, comp_list = [], []
                    for c in sorted(set(labels)):
                        mask = labels == c
                        if mask.sum() > 1:
                            vals = seg_df.loc[mask, col]
                            mu = vals.mean()
                            if mu > 0:
                                comp_seg = seg_df.loc[mask, 'comprimento_m'].sum()
                                cvs.append(vals.std() / mu)
                                comp_list.append(comp_seg)
                    if cvs:
                        return float(np.average(cvs, weights=np.array(comp_list)))
                    return None

                def _cv_intra_s(labels, col):
                    """CV intra-segmento — média aritmética simples."""
                    cvs = []
                    for c in sorted(set(labels)):
                        mask = labels == c
                        if mask.sum() > 1:
                            vals = seg_df.loc[mask, col]
                            mu = vals.mean()
                            if mu > 0:
                                cvs.append(vals.std() / mu)
                    return float(np.mean(cvs)) if cvs else None

                def _std_intra_w(labels, col):
                    """σ intra-segmento ponderado pelo comprimento."""
                    stds, comp_list = [], []
                    for c in sorted(set(labels)):
                        mask = labels == c
                        if mask.sum() > 1:
                            vals = seg_df.loc[mask, col]
                            comp_seg = seg_df.loc[mask, 'comprimento_m'].sum()
                            stds.append(vals.std())
                            comp_list.append(comp_seg)
                    if stds:
                        return float(np.average(stds, weights=np.array(comp_list)))
                    return None

                def _std_intra_s(labels, col):
                    """σ intra-segmento — média aritmética simples."""
                    stds = []
                    for c in sorted(set(labels)):
                        mask = labels == c
                        if mask.sum() > 1:
                            stds.append(seg_df.loc[mask, col].std())
                    return float(np.mean(stds)) if stds else None

                # ── CV e σ ANTES (ponderado + simples) ────────────────────
                _cols_cv = ['Deflexao', 'iri_medio', 'Deflexao_caract']
                _cv_w_ini, _cv_s_ini, _std_w_ini, _std_s_ini = {}, {}, {}, {}
                for _col in _cols_cv:
                    if _col in seg_df.columns:
                        _cv_w_ini[_col]  = _cv_intra_w(lbls, _col)
                        _cv_s_ini[_col]  = _cv_intra_s(lbls, _col)
                        _std_w_ini[_col] = _std_intra_w(lbls, _col)
                        _std_s_ini[_col] = _std_intra_s(lbls, _col)

                # ── Espacialização REAL ────────────────────────────────────
                seg_df['_tmp_ar'] = lbls
                try:
                    sa = aplicar_regras_espaciais(seg_df, '_tmp_ar',
                                                  min_comprimento_m=ar_min_comp,
                                                  max_comprimento_m=ar_max_comp)
                    ce = '_tmp_ar_espacial'
                    if ce in sa.columns:
                        lbls_fin = sa[ce].values
                    else:
                        lbls_fin = lbls
                except Exception:
                    lbls_fin = lbls

                n_seg_fin = len(set(lbls_fin))

                # ── Métricas DEPOIS (intrínsecas) ─────────────────────────
                intr_fin = avaliar_intrinseco(X_scaled_ar, lbls_fin)
                sil_fin = intr_fin['silhouette'] if intr_fin else None
                vi_fin = variancia_intra(X_scaled_ar, lbls_fin)

                # ── CV e σ DEPOIS (ponderado + simples) ───────────────────
                _cv_w_fin, _cv_s_fin, _std_w_fin, _std_s_fin = {}, {}, {}, {}
                for _col in _cols_cv:
                    if _col in seg_df.columns:
                        _cv_w_fin[_col]  = _cv_intra_w(lbls_fin, _col)
                        _cv_s_fin[_col]  = _cv_intra_s(lbls_fin, _col)
                        _std_w_fin[_col] = _std_intra_w(lbls_fin, _col)
                        _std_s_fin[_col] = _std_intra_s(lbls_fin, _col)

                # ── Score composto ────────────────────────────────────────
                sil_norm = (sil_fin + 1) / 2 if sil_fin is not None else 0.25
                cv_d0_fin_w = _cv_w_fin.get('Deflexao')
                cv_iri_fin_w = _cv_w_fin.get('iri_medio')
                cv_d0_norm = 1.0 / (1.0 + (cv_d0_fin_w or 1.0))
                cv_iri_norm = 1.0 / (1.0 + (cv_iri_fin_w or 1.0))
                std_norm = 1.0 / (1.0 + (vi_fin or 1.0))

                seg_bonus = 0.0
                if 5 <= n_seg_fin <= 12:
                    seg_bonus = 0.05
                elif 3 <= n_seg_fin <= 20:
                    seg_bonus = 0.02

                score = (w_sil * sil_norm +
                         w_cvd0 * cv_d0_norm +
                         w_cviri * cv_iri_norm +
                         w_std * std_norm +
                         seg_bonus)

                # ── Helpers de arredondamento ─────────────────────────────
                def _r4(v): return round(v, 4) if v is not None else None
                def _r3(v): return round(v, 3) if v is not None else None
                def _r2(v): return round(v, 2) if v is not None else None
                def _r1(v): return round(v, 1) if v is not None else None

                return {
                    'Método': nome,
                    'Features': features_str,
                    'Hiper.': hparams_str,
                    # Antes
                    'Seg ini': n_seg_ini,
                    'Sil ini': _r4(sil_ini),
                    'XGB': f'{xgb_acc:.1%}' if xgb_acc else '—',
                    # Depois
                    'Seg fin': n_seg_fin,
                    'Sil fin': _r4(sil_fin),
                    # CV ponderado (w)
                    'CV d0 (w)': _r4(_cv_w_fin.get('Deflexao')),
                    'CV Dc (w)': _r4(_cv_w_fin.get('Deflexao_caract')),
                    'CV IRI (w)': _r4(_cv_w_fin.get('iri_medio')),
                    # CV simples (s)
                    'CV d0 (s)': _r4(_cv_s_fin.get('Deflexao')),
                    'CV Dc (s)': _r4(_cv_s_fin.get('Deflexao_caract')),
                    'CV IRI (s)': _r4(_cv_s_fin.get('iri_medio')),
                    # σ ponderado (w)
                    'σ d0 (w)': _r2(_std_w_fin.get('Deflexao')),
                    'σ Dc (w)': _r2(_std_w_fin.get('Deflexao_caract')),
                    'σ IRI (w)': _r3(_std_w_fin.get('iri_medio')),
                    # σ simples (s)
                    'σ d0 (s)': _r2(_std_s_fin.get('Deflexao')),
                    'σ Dc (s)': _r2(_std_s_fin.get('Deflexao_caract')),
                    'σ IRI (s)': _r3(_std_s_fin.get('iri_medio')),
                    'Std intra': _r4(vi_fin),
                    'Score': _r4(score),
                }

            # ── Grids de busca ────────────────────────────────────────────
            cda_lambdas = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]
            ward_ks = list(range(ar_ward_k_min, ar_ward_k_max + 1))
            pelt_configs = [(m, ms, p) for m in ar_pelt_models
                            for ms in ar_pelt_min_sizes
                            for p in ar_pelt_pens]

            total = 2 * len(cda_lambdas) + len(ward_ks) + len(pelt_configs)
            prog = st.progress(0, text=f"AutoResearch — 0/{total}")
            done = 0

            # ── CDA (d0 bruto) ────────────────────────────────────────────
            for lam in cda_lambdas:
                try:
                    lbls, _ = cda_segmentation(defl_vals_ar, confianca=lam)
                    row = _ar_full_metrics(lbls, seg120_ar, 'CDA (d0)',
                                           'd0 bruto', f'λ={lam}')
                    if row:
                        ar_rows.append(row)
                except Exception:
                    pass
                done += 1
                prog.progress(done / total, text=f"AutoResearch — {done}/{total} (CDA d0 λ={lam})")

            # ── CDA (Dc) ─────────────────────────────────────────────────
            if dc_vals_ar is not None:
                for lam in cda_lambdas:
                    try:
                        lbls, _ = cda_segmentation(dc_vals_ar, confianca=lam)
                        row = _ar_full_metrics(lbls, seg120_ar, 'CDA (Dc)',
                                               'Deflexão caract.', f'λ={lam}')
                        if row:
                            ar_rows.append(row)
                    except Exception:
                        pass
                    done += 1
                    prog.progress(done / total, text=f"AutoResearch — {done}/{total} (CDA Dc λ={lam})")
            else:
                done += len(cda_lambdas)

            # ── Ward 1D ───────────────────────────────────────────────────
            for k in ward_ks:
                try:
                    lbls, _, _ = ward1d_linear(X_scaled_ar, k)
                    row = _ar_full_metrics(lbls, seg120_ar, 'Ward 1D',
                                           ', '.join(vars_ok_ar), f'k={k}')
                    if row:
                        ar_rows.append(row)
                except Exception:
                    pass
                done += 1
                prog.progress(done / total, text=f"AutoResearch — {done}/{total} (Ward k={k})")

            # ── PELT ──────────────────────────────────────────────────────
            for mod, ms, pen in pelt_configs:
                try:
                    lbls, _, _ = pelt_segmentation(
                        X_scaled_ar, model=mod, min_size=ms, pen=pen)
                    row = _ar_full_metrics(lbls, seg120_ar, 'PELT',
                                           ', '.join(vars_ok_ar),
                                           f'{mod}, β={pen}, ms={ms}')
                    if row:
                        ar_rows.append(row)
                except Exception:
                    pass
                done += 1
                prog.progress(done / total,
                              text=f"AutoResearch — {done}/{total} (PELT {mod} β={pen} ms={ms})")

            # Cleanup
            if '_tmp_ar' in seg120_ar.columns:
                seg120_ar = seg120_ar.drop(columns=['_tmp_ar'])

            st.session_state['ar_df_v2'] = pd.DataFrame(ar_rows)
            st.session_state['ar_done_v2'] = True
            prog.progress(1.0, text="AutoResearch concluído ✅")

        df_ar = st.session_state['ar_df_v2']

        if 'Score' not in df_ar.columns:
            st.session_state['ar_done_v2'] = False
            st.warning("Formato anterior detectado. Clique em **Executar AutoResearch** novamente.")
            st.stop()

        # ══════════════════════════════════════════════════════════════════
        # RESULTADOS
        # ══════════════════════════════════════════════════════════════════
        st.subheader(f"📋 Resultados — {len(df_ar)} configurações testadas")
        st.caption(f"Regras espaciais: {ar_min_comp}–{ar_max_comp} m | "
                   f"Pesos: Sil={w_sil}, CV_d0={w_cvd0}, CV_IRI={w_cviri}, Std={w_std}")

        # Filtros
        col_f1, col_f2, col_f3 = st.columns(3)
        with col_f1:
            met_filter = st.multiselect("Filtrar método", df_ar['Método'].unique().tolist(),
                                         default=df_ar['Método'].unique().tolist(), key='ar_met')
        with col_f2:
            seg_min = st.number_input("Seg. finais ≥", 1, 50, 2, key='ar_seg_min')
            seg_max = st.number_input("Seg. finais ≤", 1, 50, 25, key='ar_seg_max')
        with col_f3:
            _sort_opts = ['Score', 'Sil fin',
                          'CV d0 (w)', 'CV IRI (w)', 'CV d0 (s)', 'CV IRI (s)',
                          'σ d0 (w)', 'σ IRI (w)', 'Seg fin']
            sort_col = st.selectbox("Ordenar por", _sort_opts, key='ar_sort')
            sort_asc = sort_col not in ('Score', 'Sil fin')

        df_ar_f = df_ar[df_ar['Método'].isin(met_filter)].copy()
        df_ar_f = df_ar_f[(df_ar_f['Seg fin'] >= seg_min) & (df_ar_f['Seg fin'] <= seg_max)]
        df_ar_f = df_ar_f.sort_values(sort_col, ascending=sort_asc, na_position='last')

        st.dataframe(df_ar_f, use_container_width=True, hide_index=True)
        st.caption(f"{len(df_ar_f)} configs exibidas (de {len(df_ar)}).")

        # ── MELHOR POR MÉTODO ─────────────────────────────────────────────
        st.subheader("🏆 Melhor configuração por método (Score composto)")
        _best = []
        for met in sorted(df_ar_f['Método'].unique()):
            sub = df_ar_f[df_ar_f['Método'] == met].dropna(subset=['Score'])
            if len(sub):
                best = sub.loc[sub['Score'].idxmax()]
                _best.append(best)
        if _best:
            df_best = pd.DataFrame(_best)
            st.dataframe(df_best, use_container_width=True, hide_index=True)

            # ── EXPLICAÇÃO AUTOMÁTICA ─────────────────────────────────────
            st.markdown("##### 📝 Interpretação automática")
            for _, row in df_best.iterrows():
                met = row['Método']
                sil = row.get('Sil fin')
                cvd0 = row.get('CV d0 (w)')
                cviri = row.get('CV IRI (w)')
                cvd0s = row.get('CV d0 (s)')
                cviris = row.get('CV IRI (s)')
                nseg = row.get('Seg fin')
                hp = row.get('Hiper.')
                score = row.get('Score')

                reasons = []
                if sil is not None and sil > 0:
                    reasons.append(f"Silhouette positivo ({sil:+.4f}) → separação real entre segmentos")
                elif sil is not None:
                    reasons.append(f"Silhouette negativo ({sil:.4f}) → fronteiras não nítidas no espaço multivariado")
                if cvd0 is not None:
                    if cvd0 < 0.15:
                        reasons.append(f"CV d0 pond. = {cvd0:.4f} → segmentos muito homogêneos em deflexão")
                    elif cvd0 < 0.25:
                        reasons.append(f"CV d0 pond. = {cvd0:.4f} → homogeneidade moderada em deflexão")
                    else:
                        reasons.append(f"CV d0 pond. = {cvd0:.4f} → variação interna ainda elevada")
                if cviri is not None:
                    if cviri < 0.15:
                        reasons.append(f"CV IRI pond. = {cviri:.4f} → segmentos homogêneos em regularidade")
                    elif cviri < 0.25:
                        reasons.append(f"CV IRI pond. = {cviri:.4f} → homogeneidade moderada em IRI")
                    else:
                        reasons.append(f"CV IRI pond. = {cviri:.4f} → IRI heterogêneo dentro dos segmentos")
                if cvd0s is not None and cvd0 is not None:
                    diff = abs(cvd0s - cvd0)
                    if diff > 0.02:
                        reasons.append(
                            f"CV d0 simples = {cvd0s:.4f} vs pond. = {cvd0:.4f} — "
                            f"diferença indica que segmentos maiores são {'mais' if cvd0 < cvd0s else 'menos'} homogêneos")
                if nseg is not None:
                    if nseg < 5:
                        reasons.append(f"{int(nseg)} segmentos → segmentação conservadora (poucos segmentos)")
                    elif nseg <= 12:
                        reasons.append(f"{int(nseg)} segmentos → faixa ideal para gestão rodoviária")
                    else:
                        reasons.append(f"{int(nseg)} segmentos → segmentação detalhada (muitos segmentos)")

                st.markdown(f"**{met}** ({hp}) — Score = {score:.4f}")
                for r in reasons:
                    st.markdown(f"  - {r}")

        # ── TOP 10 GLOBAL ─────────────────────────────────────────────────
        st.subheader("🎯 Top 10 configurações globais")
        df_top10 = df_ar_f.dropna(subset=['Score']).nlargest(10, 'Score')
        st.dataframe(df_top10, use_container_width=True, hide_index=True)

        # ── GRÁFICOS ──────────────────────────────────────────────────────
        st.subheader("📊 Score composto por configuração (Top 30)")
        df_ar_f['Config'] = df_ar_f['Método'] + ' | ' + df_ar_f['Hiper.']
        df_top30 = df_ar_f.dropna(subset=['Score']).nlargest(30, 'Score')
        if len(df_top30) > 0:
            _ar_colors = {**CORES_METODO, 'CDA (d0)': '#1f77b4', 'CDA (Dc)': '#17becf'}
            fig_score = px.bar(
                df_top30, x='Config', y='Score', color='Método',
                color_discrete_map=_ar_colors, template='plotly_white',
                text='Score', title='Top 30 — Score composto',
            )
            fig_score.update_traces(texttemplate='%{text:.3f}', textposition='outside')
            fig_score.update_layout(height=550, xaxis_tickangle=-45)
            st.plotly_chart(fig_score, use_container_width=True)
            _svg_download_plotly(fig_score, 'top30_score')

        # Scatter: Score vs Nº segmentos
        st.subheader("📊 Score × Nº segmentos finais")
        df_scat = df_ar_f.dropna(subset=['Score'])
        if len(df_scat) > 0:
            _ar_colors = {**CORES_METODO, 'CDA (d0)': '#1f77b4', 'CDA (Dc)': '#17becf'}
            fig_scat = px.scatter(
                df_scat, x='Seg fin', y='Score', color='Método',
                hover_data=['Hiper.', 'Sil fin',
                           'CV d0 (w)', 'CV IRI (w)'],
                color_discrete_map=_ar_colors, template='plotly_white',
                title='Score × Nº segmentos (melhor = topo)',
                labels={'Seg fin': 'Nº segmentos finais', 'Score': 'Score composto'},
            )
            fig_scat.update_layout(height=500)
            st.plotly_chart(fig_scat, use_container_width=True)
            _svg_download_plotly(fig_scat, 'score_vs_segmentos')

        # Scatter: CV d0 vs CV IRI (trade-off de homogeneidade)
        st.subheader("📊 Trade-off: CV d0 × CV IRI × Silhouette (ponderado)")
        df_scat2 = df_ar_f.dropna(subset=['CV d0 (w)', 'CV IRI (w)', 'Sil fin'])
        if len(df_scat2) > 0:
            _ar_colors = {**CORES_METODO, 'CDA (d0)': '#1f77b4', 'CDA (Dc)': '#17becf'}
            fig_trade = px.scatter(
                df_scat2, x='CV d0 (w)', y='CV IRI (w)', color='Método',
                size=df_scat2['Sil fin'].clip(0.01).abs(),
                hover_data=['Hiper.', 'Sil fin', 'Seg fin', 'Score'],
                color_discrete_map=_ar_colors, template='plotly_white',
                title='CV d0 × CV IRI ponderados (melhor = canto inferior esquerdo)',
                labels={'CV d0 (w)': 'CV̄w d0', 'CV IRI (w)': 'CV̄w IRI'},
            )
            fig_trade.update_layout(height=500)
            st.plotly_chart(fig_trade, use_container_width=True)
            _svg_download_plotly(fig_trade, 'tradeoff_CV_d0_IRI')

        # Silhouette antes vs depois
        st.subheader("📊 Silhouette: antes × depois da espacialização")
        df_sil_top = df_ar_f.dropna(subset=['Sil fin', 'Sil ini']).nlargest(25, 'Score')
        if len(df_sil_top) > 0:
            fig_sil = go.Figure()
            fig_sil.add_trace(go.Bar(
                x=df_sil_top['Config'], y=df_sil_top['Sil ini'], name='Antes',
                marker_color='lightblue', text=df_sil_top['Sil ini'],
                texttemplate='%{text:.3f}', textposition='outside',
            ))
            fig_sil.add_trace(go.Bar(
                x=df_sil_top['Config'], y=df_sil_top['Sil fin'], name='Depois',
                marker_color='steelblue', text=df_sil_top['Sil fin'],
                texttemplate='%{text:.3f}', textposition='outside',
            ))
            fig_sil.update_layout(barmode='group', template='plotly_white',
                                   height=550, xaxis_tickangle=-45,
                                   title='Silhouette — antes vs. depois (top 25 por Score)')
            st.plotly_chart(fig_sil, use_container_width=True)
            _svg_download_plotly(fig_sil, 'silhouette_antes_depois')

        # ══════════════════════════════════════════════════════════════════
        # ANÁLISE DO k ÓTIMO — Ward 1D
        # ══════════════════════════════════════════════════════════════════
        st.divider()
        st.subheader("🔎 Determinação do k ótimo — Ward 1D")
        df_ward = df_ar_f[df_ar_f['Método'] == 'Ward 1D'].copy()
        if len(df_ward) > 0:
            # Extrair k numérico do hiper. string "k=3"
            df_ward['k'] = df_ward['Hiper.'].str.extract(r'k=(\d+)').astype(int)
            df_ward = df_ward.sort_values('k')

            st.markdown(
                "A tabela abaixo mostra como a **métrica intrínseca** (Silhouette), "
                "**extrínseca** (XGB) e de **homogeneidade** (CV̄w, σ̄w) variam em função de *k*. "
                "O k ótimo equilibra separação estatística (Sil alto) com "
                "homogeneidade intra-segmento (CV e σ baixos) e praticidade (5–12 segmentos)."
            )

            # Tabela resumo k × métricas
            _k_cols = ['k', 'Seg fin', 'Sil fin',
                       'CV d0 (w)', 'CV IRI (w)', 'CV d0 (s)', 'CV IRI (s)',
                       'σ d0 (w)', 'σ IRI (w)', 'Score']
            _k_avail = [c for c in _k_cols if c in df_ward.columns]
            st.dataframe(df_ward[_k_avail], use_container_width=True, hide_index=True)

            # ── Gráficos multi-eixo: métricas vs k ───────────────────────
            fig_k, axes = plt.subplots(2, 2, figsize=(12, 8))
            fig_k.suptitle('Ward 1D — Métricas vs k', fontsize=14, fontweight='bold')

            # 1) Silhouette vs k
            ax = axes[0, 0]
            ax.plot(df_ward['k'], df_ward['Sil fin'], 'o-', color='steelblue', lw=2)
            ax.set_xlabel('k')
            ax.set_ylabel('Silhouette', color='steelblue')
            ax.set_title('Silhouette (maior = melhor)')
            ax.grid(True, alpha=0.3)
            if df_ward['Sil fin'].notna().any():
                k_best_sil = df_ward.loc[df_ward['Sil fin'].idxmax(), 'k']
                ax.axvline(k_best_sil, color='steelblue', ls='--', alpha=0.5, label=f'max k={k_best_sil}')
                ax.legend(fontsize=8)

            # 2) XGB vs k
            ax = axes[0, 1]
            if 'XGB' in df_ward.columns:
                _xgb_vals = df_ward['XGB'].str.rstrip('%').astype(float) / 100
                ax.plot(df_ward['k'], _xgb_vals, 's-', color='crimson', lw=2)
                ax.set_xlabel('k')
                ax.set_ylabel('XGB 5-fold Acc.', color='crimson')
                ax.set_title('XGBoost 5-fold (maior = melhor)')
                ax.grid(True, alpha=0.3)
                if _xgb_vals.notna().any():
                    k_best_xgb = df_ward.loc[_xgb_vals.idxmax(), 'k']
                    ax.axvline(k_best_xgb, color='crimson', ls='--', alpha=0.5, label=f'max k={k_best_xgb}')
                    ax.legend(fontsize=8)

            # 3) σ d0 e σ IRI vs k
            ax = axes[1, 0]
            if 'σ d0 (w)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['σ d0 (w)'], 'D-', color='forestgreen', lw=2, label='σ̄w d0')
            if 'σ IRI (w)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['σ IRI (w)'], '^-', color='darkorange', lw=2, label='σ̄w IRI')
            if 'σ d0 (s)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['σ d0 (s)'], 'D--', color='forestgreen', alpha=0.5, lw=1, label='σ̄s d0')
            if 'σ IRI (s)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['σ IRI (s)'], '^--', color='darkorange', alpha=0.5, lw=1, label='σ̄s IRI')
            ax.set_xlabel('k')
            ax.set_ylabel('σ intra-segmento')
            ax.set_title('σ (menor = mais homogêneo)')
            ax.grid(True, alpha=0.3)
            ax.legend(fontsize=8)

            # 4) CV d0 e CV IRI vs k
            ax = axes[1, 1]
            if 'CV d0 (w)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['CV d0 (w)'], 'o-', color='#1f77b4', lw=2, label='CV̄w d0')
            if 'CV IRI (w)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['CV IRI (w)'], 's-', color='#d62728', lw=2, label='CV̄w IRI')
            if 'CV d0 (s)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['CV d0 (s)'], 'o--', color='#1f77b4', alpha=0.5, lw=1, label='CV̄s d0')
            if 'CV IRI (s)' in df_ward.columns:
                ax.plot(df_ward['k'], df_ward['CV IRI (s)'], 's--', color='#d62728', alpha=0.5, lw=1, label='CV̄s IRI')
            ax.set_xlabel('k')
            ax.set_ylabel('CV intra-segmento')
            ax.set_title('CV (menor = mais homogêneo)')
            ax.grid(True, alpha=0.3)
            ax.legend(fontsize=8)

            fig_k.tight_layout(rect=[0, 0, 1, 0.95])
            st.pyplot(fig_k)
            _svg_download(fig_k, 'ward_varredura_k')
            plt.close(fig_k)

            # ── Identificar k ótimo (consenso) ───────────────────────────
            # Pontuação por ranking: para cada métrica, rank k do melhor ao pior
            _rank_df = df_ward[['k']].copy()
            if df_ward['Sil fin'].notna().any():
                _rank_df['r_sil'] = df_ward['Sil fin'].rank(ascending=False)
            if 'CV d0 (w)' in df_ward.columns and df_ward['CV d0 (w)'].notna().any():
                _rank_df['r_cvd0'] = df_ward['CV d0 (w)'].rank(ascending=True)
            if 'CV IRI (w)' in df_ward.columns and df_ward['CV IRI (w)'].notna().any():
                _rank_df['r_cviri'] = df_ward['CV IRI (w)'].rank(ascending=True)
            if 'Score' in df_ward.columns:
                _rank_df['r_score'] = df_ward['Score'].rank(ascending=False)

            rank_cols = [c for c in _rank_df.columns if c.startswith('r_')]
            if rank_cols:
                _rank_df['Rank médio'] = _rank_df[rank_cols].mean(axis=1)
                _rank_df = _rank_df.sort_values('Rank médio')
                k_otimo = int(_rank_df.iloc[0]['k'])
                rank_medio_best = _rank_df.iloc[0]['Rank médio']

                st.markdown("##### 🏆 k ótimo por consenso de métricas")
                st.dataframe(_rank_df[['k'] + rank_cols + ['Rank médio']],
                             use_container_width=True, hide_index=True)

                # Dados do k ótimo
                row_best = df_ward[df_ward['k'] == k_otimo].iloc[0]
                st.success(
                    f"**k ótimo = {k_otimo}** (rank médio = {rank_medio_best:.2f})\n\n"
                    f"- Silhouette = {row_best.get('Sil fin', '—')}\n"
                    f"- CV̄w d0 = {row_best.get('CV d0 (w)', '—')} | "
                    f"CV̄w IRI = {row_best.get('CV IRI (w)', '—')}\n"
                    f"- CV̄s d0 = {row_best.get('CV d0 (s)', '—')} | "
                    f"CV̄s IRI = {row_best.get('CV IRI (s)', '—')}\n"
                    f"- {int(row_best['Seg fin'])} segmentos finais (após regras espaciais) | "
                    f"Score = {row_best['Score']}"
                )

                # Explanação textual
                st.markdown("##### 📝 Justificativa do k ótimo")
                _just = []
                _just.append(
                    f"O k ótimo foi determinado por **consenso de ranking** entre {len(rank_cols)} métricas: "
                    f"Silhouette (separação), CV ponderado d0 e IRI (homogeneidade física), e Score composto."
                )
                _just.append(
                    f"Para cada métrica, os valores de k foram ordenados do melhor ao pior, "
                    f"e o rank médio identifica o k com melhor desempenho **conjunto**."
                )
                sil_val = row_best.get('Sil fin')
                if sil_val is not None:
                    if sil_val > 0:
                        _just.append(
                            f"Com k={k_otimo}, o Silhouette é positivo ({sil_val:+.4f}), "
                            f"indicando que os segmentos possuem identidade estatística "
                            f"no espaço multivariado (Deflexão caract., IRI, CV deflexão).")
                    else:
                        _just.append(
                            f"O Silhouette é negativo ({sil_val:.4f}) para k={k_otimo}, "
                            f"o que é esperado em dados espaciais 1D onde a transição entre "
                            f"segmentos é gradual — a métricas de CV compensam essa limitação.")
                for j in _just:
                    st.markdown(f"- {j}")
        else:
            st.info("Nenhuma configuração Ward 1D nos resultados filtrados.")

        # Heatmap: CV e σ por método × config
        st.subheader("📊 Heatmap — CV e σ por configuração (ponderado e simples)")
        _heat_cols = ['CV d0 (w)', 'CV IRI (w)', 'CV d0 (s)', 'CV IRI (s)',
                      'σ d0 (w)', 'σ IRI (w)', 'σ d0 (s)', 'σ IRI (s)',
                      'Sil fin']
        _heat_avail = [c for c in _heat_cols if c in df_ar_f.columns and df_ar_f[c].notna().any()]
        if len(df_top10) > 0:
            _df_heat_src = df_top10.copy()
            _df_heat_src['Config'] = _df_heat_src['Método'] + ' | ' + _df_heat_src['Hiper.']
            df_heat = _df_heat_src.set_index('Config')[_heat_avail]
        else:
            df_heat = pd.DataFrame()
        if not df_heat.empty:
            fig_hm = go.Figure(data=go.Heatmap(
                z=df_heat.values, x=_heat_avail, y=df_heat.index.tolist(),
                colorscale='RdYlGn_r', text=np.round(df_heat.values, 3),
                texttemplate='%{text}', textfont=dict(size=10),
            ))
            fig_hm.update_layout(template='plotly_white', height=max(350, len(df_heat) * 35 + 100),
                                  yaxis=dict(autorange='reversed'))
            st.plotly_chart(fig_hm, use_container_width=True)
            _svg_download_plotly(fig_hm, 'heatmap_CV_sigma')

        # ── DECISÃO / RECOMENDAÇÃO FINAL ──────────────────────────────────
        st.divider()
        st.subheader("🎯 Recomendação Final do AutoResearch")
        if len(df_ar_f) > 0:
            overall_best = df_ar_f.dropna(subset=['Score']).nlargest(1, 'Score')
            if len(overall_best) > 0:
                ob = overall_best.iloc[0]
                st.success(
                    f"**Melhor configuração global:** {ob['Método']} — "
                    f"{ob['Hiper.']} (Score = {ob['Score']:.4f})\n\n"
                    f"Segmentos: {int(ob['Seg fin'])} | "
                    f"Sil: {ob.get('Sil fin', '—')} | "
                    f"CV d0 (w): {ob.get('CV d0 (w)', '—')} | "
                    f"CV IRI (w): {ob.get('CV IRI (w)', '—')} | "
                    f"σ d0 (w): {ob.get('σ d0 (w)', '—')} | "
                    f"σ IRI (w): {ob.get('σ IRI (w)', '—')}"
                )

            # Melhor Ward e Melhor PELT para comparar com CDA
            st.markdown("##### Comparação direta para o artigo: CDA × Ward 1D × PELT")
            _comp_rows = []
            for met in ['CDA (d0)', 'CDA (Dc)', 'Ward 1D', 'PELT']:
                sub = df_ar_f[df_ar_f['Método'] == met].dropna(subset=['Score'])
                if len(sub):
                    best = sub.nlargest(1, 'Score').iloc[0]
                    _comp_rows.append({
                        'Método': met,
                        'Config': best['Hiper.'],
                        'Seg': int(best['Seg fin']),
                        'Score': best['Score'],
                        'Sil': best.get('Sil fin'),
                        'CV d0 (w)': best.get('CV d0 (w)'),
                        'CV d0 (s)': best.get('CV d0 (s)'),
                        'CV IRI (w)': best.get('CV IRI (w)'),
                        'CV IRI (s)': best.get('CV IRI (s)'),
                        'σ d0 (w)': best.get('σ d0 (w)'),
                        'σ d0 (s)': best.get('σ d0 (s)'),
                        'σ IRI (w)': best.get('σ IRI (w)'),
                        'σ IRI (s)': best.get('σ IRI (s)'),
                    })
            if _comp_rows:
                df_comp = pd.DataFrame(_comp_rows)
                st.dataframe(df_comp, use_container_width=True, hide_index=True)

                # Explicação textual
                st.markdown("##### 📝 Por que esta configuração?")
                for _, row in df_comp.iterrows():
                    met = row['Método']
                    cvd = row.get('CV d0 (w)')
                    cvi = row.get('CV IRI (w)')
                    nsg = row.get('Seg')
                    sil = row.get('Sil')
                    explanation = []

                    if met.startswith('CDA'):
                        explanation.append(
                            "CDA é o método **manual** (referência). Segmentos definidos "
                            "por engenheiro usando diferenças acumuladas — não pode ser otimizado "
                            "automaticamente, mas λ controla a sensibilidade")
                    elif met == 'Ward 1D':
                        explanation.append(
                            f"Ward 1D com k={row['Config']}: clustering hierárquico com "
                            f"conectividade 1D (vizinhança sequencial) — garante linearidade")
                    elif met == 'PELT':
                        explanation.append(
                            f"PELT com {row['Config']}: detecção de pontos de mudança — "
                            f"inerentemente linear, adequado para séries temporais/espaciais")

                    if cvd is not None and cvi is not None:
                        if cvd < 0.20 and cvi < 0.20:
                            explanation.append(
                                f"Segmentos são **homogêneos** tanto em deflexão (CV={cvd:.3f}) "
                                f"quanto em IRI (CV={cvi:.3f})")
                        elif cvd < 0.20:
                            explanation.append(
                                f"Boa homogeneidade em deflexão (CV={cvd:.3f}), "
                                f"mas IRI ainda heterogêneo (CV={cvi:.3f})")
                        elif cvi < 0.20:
                            explanation.append(
                                f"Boa homogeneidade em IRI (CV={cvi:.3f}), "
                                f"mas deflexão heterogênea (CV={cvd:.3f})")
                        else:
                            explanation.append(
                                f"Variação interna moderada/alta (CV d0={cvd:.3f}, CV IRI={cvi:.3f}) "
                                f"— pode indicar segmentos com transições graduais")

                    if nsg is not None:
                        if 5 <= nsg <= 12:
                            explanation.append(f"{nsg} segmentos está na faixa ideal para gestão de manutenção")
                        elif nsg < 5:
                            explanation.append(
                                f"Apenas {nsg} segmentos — pode ser útil para planejamento macro, "
                                f"mas perde detalhes locais")
                        else:
                            explanation.append(
                                f"{nsg} segmentos — segmentação detalhada, útil para análise local "
                                f"mas potencialmente excessiva para um artigo")

                    st.markdown(f"**{met}:**")
                    for exp in explanation:
                        st.markdown(f"- {exp}")

    # ── SEÇÃO: Análise de Features (mantida) ──────────────────────────────
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

        _metodos_artigo = ['CDA', 'Ward 1D', 'PELT (beta=3)']
        _nome_map = {'PELT (beta=3)': 'PELT'}
        df_fa = df_feat[df_feat['metodo'].isin(_metodos_artigo)].copy()
        df_fa['Método'] = df_fa['metodo'].replace(_nome_map)

        # 1) Heatmap
        st.markdown("#### 1. Heatmap — Silhouette por combinação de features")
        _pivot_sil = df_fa.pivot_table(
            index='feat_str', columns='Método', values='silhouette', aggfunc='first'
        ).sort_index()
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
        _svg_download_plotly(fig_hm, 'heatmap_sil_features')

        # 2) XGB top 15
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
        _svg_download_plotly(fig_xgb, 'xgb_top15_features')

        # 3) Line: score vs n_features
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
        _svg_download_plotly(fig_nf, 'sil_vs_n_features')

        # 4) Best combo per method
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

        # 5) Feature importance
        st.markdown("#### 5. Feature Importance (XGB) por método")
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
            _svg_download_plotly(fig_imp, 'feature_importance')
        else:
            st.info("Arquivos de feature importance não encontrados. Execute run_artigo.py.")
    else:
        st.info("Arquivo resultados_features.json não encontrado.")
