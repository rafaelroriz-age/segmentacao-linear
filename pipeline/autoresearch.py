"""Ferramentas de AutoResearch para comparação sistemática de segmentações."""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from pipeline.clustering import (
    cda_segmentation,
    ensemble_weighted,
    gmm_linear,
    kmeans_linear,
    knn_segmentation,
    mcv_segmentation,
    pelt_segmentation,
    random_forest_segmentation,
    shs_segmentation,
    ward1d_linear,
)
from pipeline.evaluation import avaliar_extrinseco_xgb
from pipeline.feature_catalog import features_markdown
from pipeline.preprocessing import agregar_120m, carregar_dados, construir_features


FEATURE_DESCRICOES = {
    'basicas': ('D0 + IRI + CV', 3),
    'slope': ('Básicas + gradientes locais', 5),
    'ratio': ('Básicas + razão D0/IRI', 4),
    'completas': ('Básicas + gradientes + razão + IRI local', 7),
    'posicao': ('Básicas + posição relativa', 4),
    'rolling3': ('Básicas + médias móveis janela 3', 5),
    'rolling5': ('Básicas + médias móveis janela 5', 5),
    'range': ('Básicas + amplitudes locais', 5),
    'full': ('Conjunto completo multivariado', 11),
    'slope_pos': ('Básicas + gradientes + posição', 6),
}

CDA_CONF_GRID = [0.75, 1.0, 1.25, 1.5, 2.0]
MCV_JANELA_GRID = [3, 5, 7, 9]
MCV_LIMIAR_GRID = [0.15, 0.20, 0.25, 0.30, 0.35]
SHS_ALPHA_GRID = [0.01, 0.03, 0.05, 0.10]
SHS_MIN_GRID = [3, 5, 7]
GMM_COVARIANCE_GRID = ['full', 'diag']
KNN_NEIGHBORS_GRID = [3, 5, 7]
RF_TREES_GRID = [200]
PELT_MODEL_GRID = ['rbf', 'l2']
PELT_MIN_SIZE_GRID = [2, 3, 5]
PELT_PENALTY_GRID = [3, 8, 21, 55]
ENSEMBLE_WEIGHT_GRID = [
    (1.0, 1.0, 1.0),
    (1.3, 1.0, 1.1),
    (1.5, 1.0, 1.0),
]

warnings.filterwarnings(
    'ignore',
    message='The least populated class in y has only .* members, which is less than n_splits=.*',
    category=UserWarning,
)


def _safe_frame(seg: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    frame = seg[cols].replace([np.inf, -np.inf], np.nan)
    return frame.fillna(frame.median(numeric_only=True)).fillna(0.0)


def _build_feature_sets(seg: pd.DataFrame) -> dict[str, dict[str, Any]]:
    feature_sets = {
        'basicas': ['Deflexao', 'iri_medio', 'CV_deflexao'],
        'slope': ['Deflexao', 'iri_medio', 'CV_deflexao', 'Deflexao_slope', 'iri_slope'],
        'ratio': ['Deflexao', 'iri_medio', 'CV_deflexao', 'd0_iri_ratio'],
        'completas': [
            'Deflexao', 'iri_medio', 'CV_deflexao', 'Deflexao_slope',
            'iri_slope', 'd0_iri_ratio', 'iri_std_local',
        ],
        'posicao': ['Deflexao', 'iri_medio', 'CV_deflexao', 'posicao_rel'],
        'rolling3': ['Deflexao', 'iri_medio', 'CV_deflexao', 'Deflexao_roll3', 'iri_roll3'],
        'rolling5': ['Deflexao', 'iri_medio', 'CV_deflexao', 'Deflexao_roll5', 'iri_roll5'],
        'range': ['Deflexao', 'iri_medio', 'CV_deflexao', 'Deflexao_range_local', 'iri_range_local'],
        'full': [
            'Deflexao', 'iri_medio', 'CV_deflexao', 'Deflexao_slope', 'iri_slope',
            'd0_iri_ratio', 'posicao_rel', 'Deflexao_roll3', 'iri_roll3',
            'Deflexao_range_local', 'iri_range_local',
        ],
        'slope_pos': ['Deflexao', 'iri_medio', 'CV_deflexao', 'Deflexao_slope', 'iri_slope', 'posicao_rel'],
    }

    built = {}
    for nome, cols in feature_sets.items():
        existentes = [col for col in cols if col in seg.columns]
        if len(existentes) < 2:
            continue
        arr = _safe_frame(seg, existentes)
        descricao, n_feat = FEATURE_DESCRICOES[nome]
        built[nome] = {
            'X': arr.to_numpy(dtype=float),
            'columns': existentes,
            'descricao': descricao,
            'n_features': min(n_feat, len(existentes)),
        }
    return built


def _score_segmentation(labels: np.ndarray, X_scaled: np.ndarray) -> dict[str, Any]:
    labels = np.asarray(labels)
    unique_labels = np.unique(labels)
    n_seg = len(unique_labels)
    if n_seg < 2:
        return {
            'score': -1.0,
            'silhouette': 0.0,
            'xgb_acc': 0.0,
            'n_seg': n_seg,
            'penalidade': True,
        }

    try:
        sil = float(silhouette_score(X_scaled, labels))
    except Exception:
        sil = 0.0

    extr = avaliar_extrinseco_xgb(X_scaled, labels)
    xgb_acc = extr.get('xgb_accuracy_cv') or 0.0
    score = 0.5 * sil + 0.5 * xgb_acc
    penalidade = n_seg < 3 or n_seg > 8
    if penalidade:
        score -= 1.0

    return {
        'score': float(score),
        'silhouette': float(sil),
        'xgb_acc': float(xgb_acc),
        'n_seg': int(n_seg),
        'penalidade': penalidade,
    }


def _record_result(resultados: list[dict[str, Any]], nome: str, metodo: str, feature_set: str | None,
                   feature_count: int | None, labels: np.ndarray, X_scaled: np.ndarray, extra: dict[str, Any] | None = None) -> None:
    score = _score_segmentation(labels, X_scaled)
    row = {
        'name': nome,
        'method': metodo,
        'feature_set': feature_set,
        'feature_count': feature_count,
        'feature_columns': None,
        'score': round(score['score'], 4),
        'silhouette': round(score['silhouette'], 4),
        'xgb_acc': round(score['xgb_acc'], 4),
        'n_seg': score['n_seg'],
        'penalidade': score['penalidade'],
    }
    if extra:
        row.update(extra)
    resultados.append(row)


def _summarize_test1(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    validos = df[~df['penalidade']].copy().sort_values('score', ascending=False)
    top_configs = validos.head(15).copy()

    if validos.empty:
        return validos, pd.DataFrame(), pd.DataFrame()

    metodo_stats = (
        validos.groupby('method')
        .agg(
            score_max=('score', 'max'),
            score_medio=('score', 'mean'),
            silhouette_media=('silhouette', 'mean'),
            xgb_medio=('xgb_acc', 'mean'),
            experimentos=('score', 'count'),
        )
        .sort_values('score_max', ascending=False)
        .reset_index()
    )

    seg_stats = (
        validos.groupby('n_seg')
        .agg(score_medio=('score', 'mean'), score_max=('score', 'max'), n_configs=('score', 'count'))
        .reset_index()
        .sort_values('n_seg')
    )
    return top_configs, metodo_stats, seg_stats


def _summarize_test2(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    validos = df[(~df['penalidade']) & (df['feature_set'].notna())].copy()
    if validos.empty:
        return pd.DataFrame(), pd.DataFrame()

    feature_stats = (
        validos.groupby('feature_set')
        .agg(
            n_features=('feature_count', 'max'),
            score_max=('score', 'max'),
            score_medio=('score', 'mean'),
            melhor_metodo=('method', lambda s: validos.loc[s.index, ['score', 'method']].sort_values('score', ascending=False).iloc[0]['method']),
            configuracoes=('score', 'count'),
        )
        .sort_values('score_max', ascending=False)
        .reset_index()
    )

    baseline = feature_stats.loc[feature_stats['feature_set'] == 'basicas', 'score_max']
    baseline_val = float(baseline.iloc[0]) if not baseline.empty else float(feature_stats['score_max'].min())
    feature_stats['ganho_vs_base'] = (feature_stats['score_max'] - baseline_val).round(4)
    feature_stats['descricao'] = feature_stats['feature_set'].map(lambda x: FEATURE_DESCRICOES.get(x, (x, None))[0])
    feature_stats['lista_features'] = feature_stats['feature_set'].map(
        lambda name: ', '.join(
            validos.loc[validos['feature_set'] == name, 'feature_columns']
            .dropna()
            .astype(str)
            .head(1)
            .tolist()
        )
    )

    heatmap = (
        validos.pivot_table(index='feature_set', columns='method', values='score', aggfunc='max')
        .fillna(0.0)
        .sort_index()
    )
    return feature_stats, heatmap


def _build_test1_figures(validos: pd.DataFrame, top_configs: pd.DataFrame, metodo_stats: pd.DataFrame,
                         seg_stats: pd.DataFrame) -> dict[str, Any]:
    figs = {}
    if not validos.empty:
        figs['score_metodo'] = px.box(
            validos,
            x='method',
            y='score',
            color='method',
            points='outliers',
            template='plotly_white',
            title='Teste 1 — Score por método',
        )
        figs['silhouette_xgb'] = px.scatter(
            validos,
            x='silhouette',
            y='xgb_acc',
            color='method',
            hover_data=['name', 'feature_set', 'n_seg', 'score'],
            template='plotly_white',
            title='Teste 1 — Silhouette vs XGBoost Accuracy',
        )
    else:
        figs['score_metodo'] = go.Figure()
        figs['silhouette_xgb'] = go.Figure()

    if not top_configs.empty:
        top_plot = top_configs.sort_values('score').copy()
        top_plot['rotulo'] = top_plot['name']
        figs['top_configs'] = px.bar(
            top_plot,
            x='score',
            y='rotulo',
            orientation='h',
            color='method',
            template='plotly_white',
            title='Teste 1 — Top 15 configurações',
        )
    else:
        figs['top_configs'] = go.Figure()

    if not seg_stats.empty:
        seg_plot = seg_stats.melt(id_vars='n_seg', value_vars=['score_medio', 'score_max'],
                                  var_name='tipo', value_name='score')
        figs['score_segmentos'] = px.bar(
            seg_plot,
            x='n_seg',
            y='score',
            color='tipo',
            barmode='group',
            template='plotly_white',
            title='Teste 1 — Score por número de segmentos',
        )
    else:
        figs['score_segmentos'] = go.Figure()
    return figs


def _build_test2_figures(feature_stats: pd.DataFrame, heatmap: pd.DataFrame) -> dict[str, Any]:
    figs = {}
    if not feature_stats.empty:
        feat_plot = feature_stats.copy()
        feat_plot['label'] = feat_plot['feature_set']
        feat_long = feat_plot.melt(id_vars=['feature_set', 'label'], value_vars=['score_max', 'score_medio'],
                                   var_name='tipo', value_name='score')
        figs['score_features'] = px.bar(
            feat_long,
            x='score',
            y='label',
            color='tipo',
            barmode='group',
            orientation='h',
            template='plotly_white',
            title='Teste 2 — Score máximo e médio por feature set',
        )
        figs['ganho_features'] = px.bar(
            feat_plot.sort_values('ganho_vs_base'),
            x='ganho_vs_base',
            y='label',
            orientation='h',
            color='ganho_vs_base',
            color_continuous_scale='RdYlGn',
            template='plotly_white',
            title='Teste 2 — Ganho incremental vs conjunto básico',
        )
        figs['score_vs_nfeat'] = px.scatter(
            feat_plot,
            x='n_features',
            y='score_max',
            size='configuracoes',
            color='melhor_metodo',
            hover_data=['feature_set', 'score_medio'],
            template='plotly_white',
            title='Teste 2 — Score máximo vs quantidade de features',
        )
    else:
        figs['score_features'] = go.Figure()
        figs['ganho_features'] = go.Figure()
        figs['score_vs_nfeat'] = go.Figure()

    if not heatmap.empty:
        figs['heatmap_features'] = px.imshow(
            heatmap.values,
            x=heatmap.columns.tolist(),
            y=heatmap.index.tolist(),
            text_auto='.3f',
            aspect='auto',
            color_continuous_scale='YlOrRd',
            title='Teste 2 — Score máximo: feature set × método',
        )
        figs['heatmap_features'].update_layout(template='plotly_white')
    else:
        figs['heatmap_features'] = go.Figure()
    return figs


def _dataframe_to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty:
        return []
    clean = df.replace({np.nan: None})
    return clean.to_dict(orient='records')


def _top_by_group(df: pd.DataFrame, group_col: str, score_col: str = 'score') -> pd.DataFrame:
    if df.empty or group_col not in df.columns:
        return pd.DataFrame()
    ordered = df.sort_values([score_col, 'silhouette', 'xgb_acc'], ascending=False)
    return ordered.groupby(group_col, as_index=False).head(1).reset_index(drop=True)


def _extract_default_configs(df_validos: pd.DataFrame, df_resultados: pd.DataFrame,
                             feature_sets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if df_resultados.empty:
        return {
            'generated_at': pd.Timestamp.now().isoformat(),
            'methods': {},
            'global': {},
            'features': {},
        }

    ordered = df_validos.sort_values(['score', 'silhouette', 'xgb_acc'], ascending=False)
    ordered_all = df_resultados.sort_values(['score', 'silhouette', 'xgb_acc'], ascending=False)
    defaults: dict[str, Any] = {
        'generated_at': pd.Timestamp.now().isoformat(),
        'methods': {},
        'global': {},
        'features': {},
    }

    overall_best = ordered.iloc[0] if not ordered.empty else ordered_all.iloc[0]
    overall_feature_columns_raw = overall_best.get('feature_columns')
    overall_features = [
        item.strip() for item in ([] if pd.isna(overall_feature_columns_raw) else str(overall_feature_columns_raw).split(',')) if item.strip()
    ]
    defaults['features'] = {
        'feature_set_default': overall_best.get('feature_set'),
        'feature_columns_default': overall_features or feature_sets.get('basicas', {}).get('columns', []),
        'feature_columns_basicas': feature_sets.get('basicas', {}).get('columns', []),
    }

    best_rows = []
    for method in ordered_all['method'].dropna().astype(str).unique().tolist():
        subset_valid = ordered[ordered['method'] == method]
        subset = subset_valid if not subset_valid.empty else ordered_all[ordered_all['method'] == method]
        if not subset.empty:
            best_rows.append(subset.iloc[0])

    best_by_method = pd.DataFrame(best_rows)
    k_series = best_by_method['k'].dropna().astype(int) if not best_by_method.empty and 'k' in best_by_method.columns else pd.Series(dtype=int)
    defaults['global'] = {
        'n_clust_fallback': int(k_series.mode().iloc[0]) if not k_series.empty else 5,
        'ar_k_range_default': [3, 8],
        'best_overall_name': overall_best.get('name'),
        'best_overall_method': overall_best.get('method'),
        'best_overall_score': float(overall_best.get('score', 0.0)),
    }

    for _, row in best_by_method.iterrows():
        method = row['method']
        item: dict[str, Any] = {
            'name': row.get('name'),
            'score': float(row.get('score', 0.0)),
            'silhouette': float(row.get('silhouette', 0.0)),
            'xgb_acc': float(row.get('xgb_acc', 0.0)),
            'n_seg': int(row.get('n_seg', 0)),
            'penalidade': bool(row.get('penalidade', False)),
            'feature_set': row.get('feature_set'),
            'feature_columns': [
                part.strip() for part in ([] if pd.isna(row.get('feature_columns')) else str(row.get('feature_columns')).split(',')) if part.strip()
            ],
        }

        if pd.notna(row.get('k')):
            item['k'] = int(row['k'])
        if pd.notna(row.get('param')):
            item['confianca'] = float(row['param'])
        if pd.notna(row.get('janela')):
            item['janela'] = int(row['janela'])
        if pd.notna(row.get('limiar')):
            item['limiar'] = float(row['limiar'])
        if pd.notna(row.get('alpha')):
            item['alpha'] = float(row['alpha'])
        if pd.notna(row.get('min_tamanho')):
            item['min_tamanho'] = int(row['min_tamanho'])
        if pd.notna(row.get('covariance_type')):
            item['covariance_type'] = str(row['covariance_type'])
        if pd.notna(row.get('k_neighbors')):
            item['k_neighbors'] = int(row['k_neighbors'])
        if pd.notna(row.get('n_estimators')):
            item['n_estimators'] = int(row['n_estimators'])
        if pd.notna(row.get('pen')):
            item['pen'] = int(row['pen'])
        if pd.notna(row.get('model')):
            item['model'] = str(row['model'])
        if pd.notna(row.get('min_size')):
            item['min_size'] = int(row['min_size'])
        if pd.notna(row.get('w_ward')):
            item['w_ward'] = float(row['w_ward'])
        if pd.notna(row.get('w_mcv')):
            item['w_mcv'] = float(row['w_mcv'])
        if pd.notna(row.get('w_pelt')):
            item['w_pelt'] = float(row['w_pelt'])

        defaults['methods'][method] = item

    return defaults


def _build_markdown(top_configs: pd.DataFrame, metodo_stats: pd.DataFrame,
                    feature_stats: pd.DataFrame, base_info: dict[str, Any]) -> str:
    linhas = [
        '# Relatório AutoResearch — Segmentação Homogênea',
        '',
        f"**Data:** {base_info['data']}  ",
        f"**Trecho analisado:** {base_info['extensao_km']:.2f} km  ",
        f"**Nº de segmentos de entrada:** {base_info['n_segmentos']}  ",
        f"**Features-base do pipeline:** {base_info['features']}  ",
        '',
        '## Glossário das Features do Experimento Principal',
        '',
        features_markdown(base_info['feature_names']),
        '',
        '## Teste 1 — Melhores Métodos e Configurações',
        '',
    ]

    if not top_configs.empty:
        melhor = top_configs.iloc[0]
        linhas.extend([
            f"Melhor configuração: **{melhor['name']}**.",
            '',
            f"- Score composto: **{melhor['score']:.4f}**",
            f"- Silhouette: {melhor['silhouette']:.4f}",
            f"- XGBoost Accuracy: {melhor['xgb_acc']:.4f}",
            f"- Nº de segmentos: {int(melhor['n_seg'])}",
            '',
            metodo_stats.to_markdown(index=False),
            '',
        ])
    else:
        linhas.append('Nenhuma configuração válida foi identificada no Teste 1.')
        linhas.append('')

    linhas.extend(['## Teste 2 — Melhores Feature Sets', ''])
    if not feature_stats.empty:
        linhas.append(feature_stats.to_markdown(index=False))
        linhas.append('')
        linhas.append('### Interpretação dos Feature Sets')
        linhas.append('')
        for _, row in feature_stats.iterrows():
            linhas.append(
                f"- **{row['feature_set']}**: {int(row['n_features'])} features. "
                f"{row['descricao']}. Features: {row['lista_features']}"
            )
        linhas.append('')
    else:
        linhas.append('Nenhum feature set válido foi identificado no Teste 2.')
        linhas.append('')

    return '\n'.join(linhas)


def _save_plotly_figures(report_dir: Path, figures: dict[str, Any], prefix: str) -> list[str]:
    saved = []
    figs_dir = report_dir / 'figuras_html'
    figs_dir.mkdir(parents=True, exist_ok=True)
    for nome, fig in figures.items():
        if fig is None:
            continue
        out = figs_dir / f'{prefix}_{nome}.html'
        out.write_text(fig.to_html(include_plotlyjs='cdn'), encoding='utf-8')
        saved.append(str(out))
    return saved


def _save_outputs(report_dir: Path, payload: dict[str, Any]) -> dict[str, str]:
    report_dir.mkdir(parents=True, exist_ok=True)

    json_test1 = report_dir / 'resultados_teste1.json'
    json_test2 = report_dir / 'resultados_teste2.json'
    md_report = report_dir / 'Relatorio_Experimentos_AutoResearch.md'
    xlsx_test1 = report_dir / 'Teste1_Metodos_Configs.xlsx'
    xlsx_test2 = report_dir / 'Teste2_Features_Ensaios.xlsx'
    xlsx_full = report_dir / 'AutoResearch_Completo.xlsx'
    json_defaults = report_dir / 'best_method_defaults.json'

    with json_test1.open('w', encoding='utf-8') as fh:
        json.dump(payload['json_test1'], fh, indent=2, ensure_ascii=False)
    with json_test2.open('w', encoding='utf-8') as fh:
        json.dump(payload['json_test2'], fh, indent=2, ensure_ascii=False)
    md_report.write_text(payload['markdown'], encoding='utf-8')
    json_defaults.write_text(json.dumps(payload['best_defaults'], indent=2, ensure_ascii=False), encoding='utf-8')

    with pd.ExcelWriter(xlsx_test1, engine='openpyxl') as writer:
        payload['df_validos'].to_excel(writer, sheet_name='Validos', index=False)
        payload['df_top_configs'].to_excel(writer, sheet_name='Top15', index=False)
        payload['df_metodo_stats'].to_excel(writer, sheet_name='Resumo_Metodos', index=False)

    with pd.ExcelWriter(xlsx_test2, engine='openpyxl') as writer:
        payload['df_feature_stats'].to_excel(writer, sheet_name='Resumo_Features', index=False)
        payload['df_heatmap'].to_excel(writer, sheet_name='Heatmap')

    with pd.ExcelWriter(xlsx_full, engine='openpyxl') as writer:
        payload['df_resultados'].to_excel(writer, sheet_name='Todos_Resultados', index=False)
        payload['df_validos'].to_excel(writer, sheet_name='Validos', index=False)
        payload['df_top_configs'].to_excel(writer, sheet_name='Top15_Geral', index=False)
        payload['df_best_by_method'].to_excel(writer, sheet_name='Melhor_por_Metodo', index=False)
        payload['df_metodo_stats'].to_excel(writer, sheet_name='Resumo_Metodos', index=False)
        payload['df_seg_stats'].to_excel(writer, sheet_name='Resumo_Segmentos', index=False)
        payload['df_feature_stats'].to_excel(writer, sheet_name='Resumo_Features', index=False)
        payload['df_best_by_feature_set'].to_excel(writer, sheet_name='Melhor_por_Feature', index=False)
        payload['df_heatmap'].to_excel(writer, sheet_name='Heatmap_Feature_Metodo')
        pd.DataFrame(payload['best_defaults'].get('methods', {})).T.reset_index(names='method').to_excel(
            writer,
            sheet_name='Defaults_Otimizados',
            index=False,
        )

    _save_plotly_figures(report_dir, payload['figs_test1'], 'teste1')
    _save_plotly_figures(report_dir, payload['figs_test2'], 'teste2')

    return {
        'json_test1': str(json_test1),
        'json_test2': str(json_test2),
        'markdown': str(md_report),
        'excel_test1': str(xlsx_test1),
        'excel_test2': str(xlsx_test2),
        'excel_completo': str(xlsx_full),
        'defaults_json': str(json_defaults),
        'figuras_html_dir': str(report_dir / 'figuras_html'),
    }


def run_autoresearch(seg: pd.DataFrame, k_range: tuple[int, int] = (3, 8), report_dir: str | Path | None = None) -> dict[str, Any]:
    """Executa os testes de AutoResearch sobre o dataframe segmentado já preparado."""
    seg = seg.copy().reset_index(drop=True)
    feature_sets = _build_feature_sets(seg)
    defl_vals = seg['Deflexao'].to_numpy(dtype=float)
    k_values = list(range(k_range[0], k_range[1] + 1))

    resultados: list[dict[str, Any]] = []

    baseline_X = StandardScaler().fit_transform(feature_sets['basicas']['X']) if 'basicas' in feature_sets else np.asarray(defl_vals).reshape(-1, 1)

    for conf in CDA_CONF_GRID:
        labels, _ = cda_segmentation(defl_vals, confianca=conf)
        _record_result(resultados, f'CDA_conf{conf}', 'CDA', None, None, labels, baseline_X, {'param': conf})

    for janela in MCV_JANELA_GRID:
        for limiar in MCV_LIMIAR_GRID:
            labels, _ = mcv_segmentation(defl_vals, janela=janela, limiar_cv=limiar)
            _record_result(
                resultados,
                f'MCV_j{janela}_lim{limiar}',
                'MCV',
                None,
                None,
                labels,
                baseline_X,
                {'janela': janela, 'limiar': limiar},
            )

    for alpha in SHS_ALPHA_GRID:
        for min_tamanho in SHS_MIN_GRID:
            labels, _ = shs_segmentation(defl_vals, nivel_significancia=alpha, min_tamanho=min_tamanho)
            _record_result(
                resultados,
                f'SHS_alpha{alpha}_min{min_tamanho}',
                'SHS',
                None,
                None,
                labels,
                baseline_X,
                {'alpha': alpha, 'min_tamanho': min_tamanho},
            )

    for feature_name, meta in feature_sets.items():
        X_scaled = StandardScaler().fit_transform(meta['X'])
        n_feat = meta['n_features']

        for k in k_values:
            labels, _, _ = ward1d_linear(X_scaled, k)
            _record_result(resultados, f'Ward_k{k}_feat{feature_name}', 'Ward 1D', feature_name, n_feat, labels, X_scaled, {'k': k, 'feature_columns': ', '.join(meta['columns'])})

            labels, _, _ = kmeans_linear(X_scaled, k)
            _record_result(resultados, f'KMeans_k{k}_feat{feature_name}', 'K-Means', feature_name, n_feat, labels, X_scaled, {'k': k, 'feature_columns': ', '.join(meta['columns'])})

            for covariance_type in GMM_COVARIANCE_GRID:
                labels, _, _ = gmm_linear(X_scaled, k, covariance_type=covariance_type)
                _record_result(
                    resultados,
                    f'GMM_k{k}_{covariance_type}_feat{feature_name}',
                    'GMM',
                    feature_name,
                    n_feat,
                    labels,
                    X_scaled,
                    {'k': k, 'covariance_type': covariance_type, 'feature_columns': ', '.join(meta['columns'])},
                )

            for k_neighbors in KNN_NEIGHBORS_GRID:
                labels, _, _ = knn_segmentation(X_scaled, k, k_neighbors=k_neighbors)
                _record_result(
                    resultados,
                    f'KNN_k{k}_knn{k_neighbors}_feat{feature_name}',
                    'KNN',
                    feature_name,
                    n_feat,
                    labels,
                    X_scaled,
                    {'k': k, 'k_neighbors': k_neighbors, 'feature_columns': ', '.join(meta['columns'])},
                )

            for n_estimators in RF_TREES_GRID:
                labels, _, _ = random_forest_segmentation(X_scaled, k, n_estimators=n_estimators)
                _record_result(
                    resultados,
                    f'RF_k{k}_trees{n_estimators}_feat{feature_name}',
                    'Random Forest',
                    feature_name,
                    n_feat,
                    labels,
                    X_scaled,
                    {'k': k, 'n_estimators': n_estimators, 'feature_columns': ', '.join(meta['columns'])},
                )

            labels_ward, _, _ = ward1d_linear(X_scaled, k)
            labels_mcv, _ = mcv_segmentation(defl_vals, janela=5, limiar_cv=0.20)
            labels_pelt, _, _ = pelt_segmentation(X_scaled, model='rbf', min_size=2, pen=8)
            for w_ward, w_mcv, w_pelt in ENSEMBLE_WEIGHT_GRID:
                labels_ens = ensemble_weighted(
                    [labels_ward, labels_mcv, labels_pelt],
                    weights=[w_ward, w_mcv, w_pelt],
                )
                _record_result(
                    resultados,
                    f'Ensemble_k{k}_w{w_ward:.1f}-{w_mcv:.1f}-{w_pelt:.1f}_feat{feature_name}',
                    'Ensemble',
                    feature_name,
                    n_feat,
                    labels_ens,
                    X_scaled,
                    {
                        'k': k,
                        'w_ward': w_ward,
                        'w_mcv': w_mcv,
                        'w_pelt': w_pelt,
                        'feature_columns': ', '.join(meta['columns']),
                    },
                )

        for model in PELT_MODEL_GRID:
            for min_size in PELT_MIN_SIZE_GRID:
                for pen in PELT_PENALTY_GRID:
                    labels, _, _ = pelt_segmentation(X_scaled, model=model, min_size=min_size, pen=pen)
                    _record_result(
                        resultados,
                        f'PELT_{model}_ms{min_size}_pen{pen}_feat{feature_name}',
                        'PELT',
                        feature_name,
                        n_feat,
                        labels,
                        X_scaled,
                        {'pen': pen, 'model': model, 'min_size': min_size, 'feature_columns': ', '.join(meta['columns'])},
                    )

    df_resultados = pd.DataFrame(resultados).sort_values('score', ascending=False).reset_index(drop=True)
    df_validos = df_resultados[~df_resultados['penalidade']].copy().reset_index(drop=True)
    df_top_configs, df_metodo_stats, df_seg_stats = _summarize_test1(df_resultados)
    df_feature_stats, df_heatmap = _summarize_test2(df_resultados)
    df_best_by_method = _top_by_group(df_validos, 'method')
    df_best_by_feature_set = _top_by_group(df_validos[df_validos['feature_set'].notna()], 'feature_set')
    best_defaults = _extract_default_configs(df_validos, df_resultados, feature_sets)
    best_defaults.setdefault('global', {})['ar_k_range_default'] = [int(k_range[0]), int(k_range[1])]

    figs_test1 = _build_test1_figures(df_validos, df_top_configs, df_metodo_stats, df_seg_stats)
    figs_test2 = _build_test2_figures(df_feature_stats, df_heatmap)

    base_info = {
        'data': pd.Timestamp.now().strftime('%Y-%m-%d %H:%M'),
        'extensao_km': (seg['km_fim'].max() - seg['km_ini'].min()) / 1000.0 if len(seg) else 0.0,
        'n_segmentos': len(seg),
        'features': ', '.join(feature_sets['basicas']['columns']) if 'basicas' in feature_sets else 'N/A',
        'feature_names': feature_sets['basicas']['columns'] if 'basicas' in feature_sets else [],
    }
    markdown = _build_markdown(df_top_configs, df_metodo_stats, df_feature_stats, base_info)

    payload = {
        'df_resultados': df_resultados,
        'df_validos': df_validos,
        'df_top_configs': df_top_configs,
        'df_metodo_stats': df_metodo_stats,
        'df_seg_stats': df_seg_stats,
        'df_feature_stats': df_feature_stats,
        'df_heatmap': df_heatmap,
        'df_best_by_method': df_best_by_method,
        'df_best_by_feature_set': df_best_by_feature_set,
        'figs_test1': figs_test1,
        'figs_test2': figs_test2,
        'markdown': markdown,
        'best_defaults': best_defaults,
        'json_test1': {
            'resumo_metodos': _dataframe_to_records(df_metodo_stats),
            'top_configs': _dataframe_to_records(df_top_configs),
            'segmentos': _dataframe_to_records(df_seg_stats),
            'melhor_por_metodo': _dataframe_to_records(df_best_by_method),
        },
        'json_test2': {
            'feature_sets': _dataframe_to_records(df_feature_stats),
            'heatmap': _dataframe_to_records(df_heatmap.reset_index()) if not df_heatmap.empty else [],
            'melhor_por_feature_set': _dataframe_to_records(df_best_by_feature_set),
        },
        'base_info': base_info,
    }

    if report_dir is not None:
        payload['saved_files'] = _save_outputs(Path(report_dir), payload)
    else:
        payload['saved_files'] = {}

    return payload


def run_autoresearch_from_file(
    file_path: str | Path,
    col_km_ini: str = 'km_inicial',
    col_km_fim: str = 'km_final',
    col_iri: str = 'iri_medio',
    col_d0: str = 'd0',
    k_range: tuple[int, int] = (3, 8),
    report_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Executa AutoResearch diretamente a partir de um arquivo de dados."""
    df = carregar_dados(file_path)
    seg = agregar_120m(
        df,
        col_def=col_d0,
        col_km_ini=col_km_ini,
        col_km_fim=col_km_fim,
        col_iri=col_iri,
    )
    seg, _, _ = construir_features(seg)
    return run_autoresearch(seg, k_range=k_range, report_dir=report_dir)