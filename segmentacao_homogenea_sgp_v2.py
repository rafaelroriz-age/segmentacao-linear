"""
Segmentacao homogenea SGP (compacta, baseada no app_artigo.py).

- Segmenta por SRE usando WARD 1D e PELT
- Duas bases por metodo: iri_medio+d0 e iri_medio+dc
- Restricao espacial: 0.6 km a 5.0 km
- Exporta Excel com abas: WARD_d0, WARD_dc, PELT_d0, PELT_dc

Uso:
    python segmentacao_homogenea_sgp.py --input 20260611-112405.xlsx
    python segmentacao_homogenea_sgp.py --input 20260611-112405.xlsx --output saida.xlsx
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

import numpy as np
import pandas as pd
from scipy.sparse import diags
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

FEATURES_ARTIGO = ["Deflexao_caract", "iri_medio", "Deflexao"]  # Reaproveita as mesmas features do artigo para ambas as bases (d0 e dc).


def _serie_numerica(valores):
    serie = pd.Series(pd.to_numeric(valores, errors="coerce"))
    if serie.notna().any():
        return serie.interpolate(limit_direction="both")
    return serie.fillna(0.0)


def _enriquecer_segmentos(seg: pd.DataFrame) -> pd.DataFrame:
    base = seg.copy()

    if "km_centro" not in base.columns:
        if "km_ini" in base.columns and "km_fim" in base.columns:
            base["km_centro"] = 0.5 * (base["km_ini"] + base["km_fim"])
        else:
            base["km_centro"] = np.arange(len(base), dtype=float)

    if "comprimento_m" not in base.columns and {"km_ini", "km_fim"}.issubset(base.columns):
        base["comprimento_m"] = base["km_fim"] - base["km_ini"]

    deflexao = _serie_numerica(base.get("Deflexao", pd.Series(dtype=float)))
    iri = _serie_numerica(base.get("iri_medio", pd.Series(np.nan, index=base.index)))

    roll3_def = deflexao.rolling(3, center=True, min_periods=1)
    roll5_def = deflexao.rolling(5, center=True, min_periods=1)
    roll3_iri = iri.rolling(3, center=True, min_periods=1)
    roll5_iri = iri.rolling(5, center=True, min_periods=1)

    if "Deflexao_std" in base.columns:
        base["Deflexao_std"] = pd.to_numeric(base["Deflexao_std"], errors="coerce")
        base["Deflexao_std"] = base["Deflexao_std"].fillna(roll3_def.std().fillna(0.0))
    else:
        base["Deflexao_std"] = roll3_def.std().fillna(0.0)

    if "Deflexao_max" not in base.columns:
        base["Deflexao_max"] = roll3_def.max().fillna(deflexao)
    if "Deflexao_min" not in base.columns:
        base["Deflexao_min"] = roll3_def.min().fillna(deflexao)

    base["Deflexao"] = deflexao
    base["Deflexao_caract"] = base["Deflexao"] + base["Deflexao_std"]
    base["CV_deflexao"] = base["Deflexao_std"] / base["Deflexao"].replace(0, np.nan)
    base["Deflexao_roll3"] = roll3_def.mean().fillna(deflexao)
    base["Deflexao_roll5"] = roll5_def.mean().fillna(deflexao)
    base["Deflexao_slope"] = np.gradient(deflexao.to_numpy()) if len(base) > 1 else 0.0
    base["Deflexao_range_local"] = base["Deflexao_max"] - base["Deflexao_min"]

    if iri.notna().any():
        base["iri_medio"] = iri
        base["iri_std_local"] = roll3_iri.std().fillna(0.0)
        base["iri_roll3"] = roll3_iri.mean().fillna(iri)
        base["iri_roll5"] = roll5_iri.mean().fillna(iri)
        base["iri_max_local"] = roll3_iri.max().fillna(iri)
        base["iri_min_local"] = roll3_iri.min().fillna(iri)
        base["iri_range_local"] = base["iri_max_local"] - base["iri_min_local"]
        base["iri_slope"] = np.gradient(iri.to_numpy()) if len(base) > 1 else 0.0
        base["d0_iri_ratio"] = base["Deflexao"] / iri.replace(0, np.nan)
        base["d0_iri_interacao"] = base["Deflexao"] * iri
    else:
        base["iri_medio"] = np.nan
        base["iri_std_local"] = 0.0
        base["iri_roll3"] = 0.0
        base["iri_roll5"] = 0.0
        base["iri_max_local"] = 0.0
        base["iri_min_local"] = 0.0
        base["iri_range_local"] = 0.0
        base["iri_slope"] = 0.0
        base["d0_iri_ratio"] = np.nan
        base["d0_iri_interacao"] = 0.0

    range_pos = base["km_centro"].max() - base["km_centro"].min()
    if range_pos > 0:
        base["posicao_rel"] = (base["km_centro"] - base["km_centro"].min()) / range_pos
    else:
        base["posicao_rel"] = 0.0

    base = base.replace([np.inf, -np.inf], np.nan)
    return base


def _preparar_segmentos_intervalares(
    df: pd.DataFrame,
    col_km_ini: str,
    col_km_fim: str,
    col_iri: str,
    col_def: str,
) -> pd.DataFrame:
    base = df.copy()
    for coluna in [col_km_ini, col_km_fim, col_def]:
        base[coluna] = pd.to_numeric(base[coluna], errors="coerce")
    if "d0" in base.columns:
        base["d0"] = pd.to_numeric(base["d0"], errors="coerce")
    if "dc" in base.columns:
        base["dc"] = pd.to_numeric(base["dc"], errors="coerce")
    if col_iri and col_iri in base.columns:
        base[col_iri] = pd.to_numeric(base[col_iri], errors="coerce")

    base = base.dropna(subset=[col_km_ini, col_km_fim, col_def]).sort_values(col_km_ini).reset_index(drop=True)

    seg = pd.DataFrame(
        {
            "seg_id": np.arange(1, len(base) + 1),
            "km_ini_km": base[col_km_ini],
            "km_fim_km": base[col_km_fim],
            "km_ini": base[col_km_ini] * 1000.0,
            "km_fim": base[col_km_fim] * 1000.0,
            "km_centro_km": 0.5 * (base[col_km_ini] + base[col_km_fim]),
            "km_centro": 0.5 * (base[col_km_ini] + base[col_km_fim]) * 1000.0,
            "comprimento_m": (base[col_km_fim] - base[col_km_ini]) * 1000.0,
            "Deflexao": base[col_def],
            "iri_medio": base[col_iri] if col_iri and col_iri in base.columns else np.nan,
            "d0": base["d0"] if "d0" in base.columns else np.nan,
            "dc": base["dc"] if "dc" in base.columns else np.nan,
            "n_pontos": 1,
        }
    )
    return _enriquecer_segmentos(seg)


def agregar_120m(
    df: pd.DataFrame,
    col_est: str = "Estacao_m",
    col_def: str = "Deflexao",
    passo: int = 40,
    janela: int = 3,
    col_km_ini: str | None = None,
    col_km_fim: str | None = None,
    col_iri: str | None = None,
) -> pd.DataFrame:
    if not (col_km_ini and col_km_fim and col_km_ini in df.columns and col_km_fim in df.columns and col_def in df.columns):
        raise ValueError("A entrada deve conter km_inicial, km_final e d0 (ou nomes equivalentes).")
    return _preparar_segmentos_intervalares(df, col_km_ini, col_km_fim, col_iri, col_def)


def construir_features(seg120: pd.DataFrame, vars_clustering: list[str] | None = None):
    seg = _enriquecer_segmentos(seg120)
    if vars_clustering is None:
        vars_clustering = ["Deflexao_caract", "iri_medio", "CV_deflexao"]

    vars_ok = [v for v in vars_clustering if v in seg.columns and seg[v].isnull().mean() < 0.5]
    X = seg[vars_ok].replace([np.inf, -np.inf], np.nan)
    X = X.fillna(X.median(numeric_only=True)).fillna(0.0)
    return seg, X, vars_ok


def padronizar(X):
    scaler = StandardScaler()
    return scaler.fit_transform(X), scaler


def connectivity_1d(n: int):
    return diags([1, 1], [-1, 1], shape=(n, n)).toarray()


def ward1d_linear(X_scaled, k: int):
    conn = connectivity_1d(len(X_scaled))
    agg = AgglomerativeClustering(n_clusters=k, linkage="ward", connectivity=conn)
    labels = agg.fit_predict(X_scaled)
    return labels, labels, agg


def pelt_segmentation(X_scaled, model: str = "rbf", min_size: int = 3, pen: int = 30):
    import ruptures as rpt

    algo = rpt.Pelt(model=model, min_size=min_size, jump=1).fit(X_scaled)
    bkps = algo.predict(pen=pen)
    labels = np.zeros(len(X_scaled), dtype=int)
    prev = 0
    for seg_num, bp in enumerate(bkps):
        labels[prev:bp] = seg_num
        prev = bp
    return labels, bkps, algo


def aplicar_regras_espaciais(
    seg120: pd.DataFrame,
    col_cluster: str,
    col_deflexao: str = "Deflexao",
    min_comprimento_m: float = 400,
    max_comprimento_m: float | None = None,
):
    seg = seg120.copy().sort_values("km_ini").reset_index(drop=True)
    labels = seg[col_cluster].values.copy()

    def get_trechos(lbls):
        trechos = []
        start = 0
        for i in range(1, len(lbls)):
            if lbls[i] != lbls[i - 1]:
                trechos.append((start, i - 1))
                start = i
        trechos.append((start, len(lbls) - 1))
        return trechos

    max_iters = 50
    eps = 1.0

    for _ in range(max_iters):
        trechos = get_trechos(labels)
        comprimentos = [seg.loc[t[0] : t[1], "comprimento_m"].sum() for t in trechos]
        curtos = [(i, t) for i, (t, c) in enumerate(zip(trechos, comprimentos)) if c < min_comprimento_m]
        if not curtos:
            break

        idx, (i0, i1) = curtos[0]
        candidatos = []
        if idx > 0:
            j0, j1 = trechos[idx - 1]
            vals = np.concatenate([seg.loc[j0:j1, col_deflexao].values, seg.loc[i0:i1, col_deflexao].values])
            candidatos.append(("esquerda", j0, j1, i0, i1, np.std(vals)))
        if idx < len(trechos) - 1:
            j0, j1 = trechos[idx + 1]
            vals = np.concatenate([seg.loc[i0:i1, col_deflexao].values, seg.loc[j0:j1, col_deflexao].values])
            candidatos.append(("direita", i0, i1, j0, j1, np.std(vals)))
        if not candidatos:
            break

        if max_comprimento_m is not None and max_comprimento_m > 0:
            candidatos = [
                c
                for c in candidatos
                if seg.loc[min(c[1], c[3]) : max(c[2], c[4]), "comprimento_m"].sum() <= max_comprimento_m + eps
            ]
        if not candidatos:
            break

        melhor = min(candidatos, key=lambda x: x[-1])
        lbl_destino = labels[melhor[1]]
        labels[melhor[3] : melhor[4] + 1] = lbl_destino

    if max_comprimento_m is not None and max_comprimento_m > 0:
        labels_longos = labels.copy()
        trechos = get_trechos(labels_longos)
        next_label = int(labels_longos.max()) + 1 if len(labels_longos) else 0

        for i0, i1 in trechos:
            comprimento = seg.loc[i0:i1, "comprimento_m"].sum()
            if comprimento <= max_comprimento_m + eps:
                continue

            pontos = [i0]
            acumulado = 0.0
            for idx in range(i0, i1 + 1):
                comp_atual = float(seg.loc[idx, "comprimento_m"])
                if acumulado + comp_atual > max_comprimento_m + eps and idx > pontos[-1]:
                    pontos.append(idx)
                    acumulado = comp_atual
                else:
                    acumulado += comp_atual

            if len(pontos) > 2:
                comp_ultimo = seg.loc[pontos[-1] : i1, "comprimento_m"].sum()
                if comp_ultimo < min_comprimento_m:
                    comp_penult = seg.loc[pontos[-2] : pontos[-1] - 1, "comprimento_m"].sum()
                    if comp_penult + comp_ultimo <= max_comprimento_m + eps:
                        pontos.pop()

            for k in range(1, len(pontos)):
                start = pontos[k]
                end = i1 + 1 if k == len(pontos) - 1 else pontos[k + 1]
                labels_longos[start:end] = next_label
                next_label += 1
        labels = labels_longos

    seg[f"{col_cluster}_espacial"] = labels
    return seg


def avaliar_extrinseco_xgb(X_scaled, labels):
    try:
        from xgboost import XGBClassifier
    except ImportError:
        return {"xgb_accuracy_cv": None, "xgb_accuracy_std": None}

    from collections import Counter
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import LabelEncoder

    mask = labels >= 0
    X_ok = X_scaled[mask]
    y = LabelEncoder().fit_transform(labels[mask])

    if len(set(y)) < 2 or len(y) < 10:
        return {"xgb_accuracy_cv": None, "xgb_accuracy_std": None}

    counts = Counter(y)
    valid_classes = {c for c, cnt in counts.items() if cnt >= 2}
    if len(valid_classes) < 2:
        return {"xgb_accuracy_cv": None, "xgb_accuracy_std": None}

    keep = np.array([yi in valid_classes for yi in y])
    X_ok = X_ok[keep]
    y = LabelEncoder().fit_transform(y[keep])
    n_cv = min(5, len(set(y)), min(Counter(y).values()))
    if n_cv < 2:
        n_cv = 2

    clf = XGBClassifier(
        n_estimators=100,
        max_depth=4,
        use_label_encoder=False,
        eval_metric="mlogloss",
        random_state=42,
        verbosity=0,
    )

    try:
        scores = cross_val_score(clf, X_ok, y, cv=n_cv, scoring="accuracy")
        return {"xgb_accuracy_cv": float(scores.mean()), "xgb_accuracy_std": float(scores.std())}
    except Exception:
        return {"xgb_accuracy_cv": None, "xgb_accuracy_std": None}


@dataclass
class Params:
    min_comp_km: float = 0.6
    max_comp_km: float = 5.0
    ward_k: int = 10
    pelt_model: str = "l2"
    pelt_min_size: int = 3
    pelt_pen: int = 4

    @property
    def min_comp_m(self) -> float:
        return self.min_comp_km * 1000.0

    @property
    def max_comp_m(self) -> float:
        return self.max_comp_km * 1000.0


def _to_numeric(df: pd.DataFrame, cols: Iterable[str]) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        out[c] = pd.to_numeric(out[c], errors="coerce")
    return out


def _preparar_sre_base(df: pd.DataFrame, var_col: str) -> pd.DataFrame:
    required = ["sre", "km_inicial", "km_final", "iri_medio", "d0", "dc", var_col]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Colunas obrigatorias ausentes: {missing}")

    base = _to_numeric(df, ["km_inicial", "km_final", "iri_medio", "d0", "dc", var_col])
    base = base.dropna(subset=["sre", "km_inicial", "km_final", "iri_medio", var_col]).copy()

    # Consolida pontos duplicados no mesmo trecho dentro do SRE.
    base = (
        base.groupby(["sre", "km_inicial", "km_final"], as_index=False)
        .agg({"iri_medio": "mean", "d0": "mean", "dc": "mean", var_col: "mean"})
        .sort_values(["sre", "km_inicial", "km_final"])
        .reset_index(drop=True)
    )

    # Apenas trechos validos (km_final > km_inicial).
    base = base[base["km_final"] > base["km_inicial"]].copy()
    return base


def _build_seg120_for_sre(g: pd.DataFrame, var_col: str) -> tuple[pd.DataFrame, np.ndarray, list[str]]:
    # Reaproveita o pipeline do artigo: agrega + features.
    seg120 = agregar_120m(
        g,
        col_def=var_col,
        col_km_ini="km_inicial",
        col_km_fim="km_final",
        col_iri="iri_medio",
    )

    seg120, X_df, vars_ok = construir_features(seg120, vars_clustering=FEATURES_ARTIGO)
    X_scaled, _ = padronizar(X_df.values)
    return seg120, X_scaled, vars_ok


def _segmentar_metodo(seg120: pd.DataFrame, X_scaled: np.ndarray, metodo: str, p: Params) -> pd.DataFrame:
    if metodo == "WARD":
        n = len(X_scaled)
        k_eff = max(2, min(p.ward_k, n - 1))
        labels, _, _ = ward1d_linear(X_scaled, k_eff)
    elif metodo == "PELT":
        labels, _, _ = pelt_segmentation(
            X_scaled,
            model=p.pelt_model,
            min_size=p.pelt_min_size,
            pen=p.pelt_pen,
        )
    else:
        raise ValueError(f"Metodo invalido: {metodo}")

    col_cluster = "cluster_tmp"
    seg120[col_cluster] = labels

    seg_adj = aplicar_regras_espaciais(
        seg120,
        col_cluster,
        min_comprimento_m=p.min_comp_m,
        max_comprimento_m=p.max_comp_m,
    )
    return seg_adj


def _labels_contiguos(seg: pd.DataFrame, col_label: str) -> np.ndarray:
    vals = seg[col_label].to_numpy()
    if len(vals) == 0:
        return np.array([], dtype=int)

    out = np.zeros(len(vals), dtype=int)
    cur = 0
    out[0] = 0
    for i in range(1, len(vals)):
        if vals[i] != vals[i - 1]:
            cur += 1
        out[i] = cur
    return out


def _silhouette_safe(X_scaled: np.ndarray, labels: np.ndarray) -> float | None:
    if len(np.unique(labels)) <= 1:
        return None
    try:
        return float(silhouette_score(X_scaled, labels))
    except Exception:
        return None


def _segment_table(
    seg_adj: pd.DataFrame,
    X_scaled: np.ndarray,
    sre: str,
    base_var: str,
    metodo: str,
) -> pd.DataFrame:
    label_col = "cluster_tmp_espacial"
    labels = _labels_contiguos(seg_adj, label_col)

    sil = _silhouette_safe(X_scaled, labels)
    xgb = avaliar_extrinseco_xgb(X_scaled, labels)
    xgb_acc = xgb.get("xgb_accuracy_cv") if isinstance(xgb, dict) else None

    rows = []
    start = 0
    for i in range(1, len(labels)):
        if labels[i] != labels[i - 1]:
            rows.append((start, i - 1))
            start = i
    if len(labels) > 0:
        rows.append((start, len(labels) - 1))

    out = []

    def _mean_safe(vals: np.ndarray) -> float:
        if len(vals) == 0:
            return np.nan
        valid = vals[~np.isnan(vals)]
        if len(valid) == 0:
            return np.nan
        return float(np.nanmean(valid))

    for idx, (i0, i1) in enumerate(rows, start=1):
        b = seg_adj.iloc[i0 : i1 + 1]

        km_ini = float(b["km_ini"].min() / 1000.0)
        km_fim = float(b["km_fim"].max() / 1000.0)

        iri_vals = b["iri_medio"].to_numpy(dtype=float)
        d_vals = b["Deflexao"].to_numpy(dtype=float)
        d0_vals = b["d0"].to_numpy(dtype=float) if "d0" in b.columns else np.array([], dtype=float)
        dc_vals = b["dc"].to_numpy(dtype=float) if "dc" in b.columns else np.array([], dtype=float)

        iri_mean = float(np.nanmean(iri_vals)) if len(iri_vals) else np.nan
        d_mean = float(np.nanmean(d_vals)) if len(d_vals) else np.nan
        d0_mean = _mean_safe(d0_vals)
        dc_mean = _mean_safe(dc_vals)

        if np.isnan(d0_mean) and base_var == "d0":
            d0_mean = d_mean
        if np.isnan(dc_mean) and base_var == "dc":
            dc_mean = d_mean

        iri_std = float(np.nanstd(iri_vals)) if len(iri_vals) > 1 else 0.0
        d_std = float(np.nanstd(d_vals)) if len(d_vals) > 1 else 0.0

        # Calcula coeficientes de variação
        iri_cv = (iri_std / iri_mean) if (iri_mean is not None and iri_mean > 0 and not np.isnan(iri_mean)) else np.nan
        d_cv = (d_std / d_mean) if (d_mean is not None and d_mean > 0 and not np.isnan(d_mean)) else np.nan

        row = {
            "metodo": metodo,
            "atributo_deflexao": base_var,
            "sre": str(sre),
            "sre_seg_h": f"{sre}-{idx}",
            "km_inicial": round(km_ini, 6),
            "km_final": round(km_fim, 6),
            "desv_padrao_iri_medio": round(iri_std, 6),
            "cv_iri_medio": round(iri_cv, 6) if not np.isnan(iri_cv) else np.nan,
            "iri": round(iri_mean, 6) if not np.isnan(iri_mean) else np.nan,
            "d0": round(d0_mean, 6) if not np.isnan(d0_mean) else np.nan,
            "dc": round(dc_mean, 6) if not np.isnan(dc_mean) else np.nan,
            "silhouette": round(sil, 6) if sil is not None else None,
            "xgboost_accuracy_cv": round(xgb_acc, 6) if xgb_acc is not None else None,
            "n_segmentos_sre": int(len(rows)),
        }
        
        if base_var == "d0":
            row["desv_padrao_d0"] = round(d_std, 6)
            row["cv_d0"] = round(d_cv, 6) if not np.isnan(d_cv) else np.nan
            row["desv_padrao_dc"] = np.nan
            row["cv_dc"] = np.nan
        else:  # base_var == "dc"
            row["desv_padrao_dc"] = round(d_std, 6)
            row["cv_dc"] = round(d_cv, 6) if not np.isnan(d_cv) else np.nan
            row["desv_padrao_d0"] = np.nan
            row["cv_d0"] = np.nan
        
        out.append(row)

    return pd.DataFrame(out)


def _run_for_method(df: pd.DataFrame, metodo: str, p: Params) -> pd.DataFrame:
    all_rows = []
    for base_var in ["d0", "dc"]:
        base = _preparar_sre_base(df, var_col=base_var)
        for sre, g in base.groupby("sre", sort=True):
            if len(g) < 3:
                continue

            seg120, X_scaled, _ = _build_seg120_for_sre(g, var_col=base_var)
            seg_adj = _segmentar_metodo(seg120, X_scaled, metodo=metodo, p=p)
            seg_tbl = _segment_table(seg_adj, X_scaled, str(sre), base_var, metodo)
            if not seg_tbl.empty:
                all_rows.append(seg_tbl)

    if not all_rows:
        return pd.DataFrame(
            columns=[
                "metodo",
                "atributo_deflexao",
                "sre",
                "sre_seg_h",
                "km_inicial",
                "km_final",
                "desv_padrao_iri_medio",
                "cv_iri_medio",
                "iri",
                "desv_padrao_d0",
                "cv_d0",
                "d0",
                "desv_padrao_dc",
                "cv_dc",
                "dc",
                "silhouette",
                "xgboost_accuracy_cv",
                "n_segmentos_sre",
            ]
        )

    out = pd.concat(all_rows, ignore_index=True)

    # Garante que todas as colunas existem
    required_cols = [
        "metodo",
        "atributo_deflexao",
        "sre",
        "sre_seg_h",
        "km_inicial",
        "km_final",
        "desv_padrao_iri_medio",
        "cv_iri_medio",
        "iri",
        "desv_padrao_d0",
        "cv_d0",
        "d0",
        "desv_padrao_dc",
        "cv_dc",
        "dc",
        "silhouette",
        "xgboost_accuracy_cv",
        "n_segmentos_sre",
    ]
    for col in required_cols:
        if col not in out.columns:
            out[col] = np.nan

    return out[required_cols].sort_values(["atributo_deflexao", "sre", "km_inicial"]).reset_index(drop=True)


def gerar_excel_segmentacao(input_path: str, output_path: str, sheet: str | None = None) -> None:
    xls = pd.ExcelFile(input_path)
    in_sheet = sheet or xls.sheet_names[0]
    df = pd.read_excel(input_path, sheet_name=in_sheet)

    p = Params()
    ward_df = _run_for_method(df, metodo="WARD", p=p)
    pelt_df = _run_for_method(df, metodo="PELT", p=p)

    ward_d0 = ward_df[ward_df["atributo_deflexao"] == "d0"].reset_index(drop=True)
    ward_dc = ward_df[ward_df["atributo_deflexao"] == "dc"].reset_index(drop=True)
    pelt_d0 = pelt_df[pelt_df["atributo_deflexao"] == "d0"].reset_index(drop=True)
    pelt_dc = pelt_df[pelt_df["atributo_deflexao"] == "dc"].reset_index(drop=True)

    # Mantem d0 e dc em todas as abas; remove apenas derivados da base oposta.
    ward_d0 = ward_d0.drop(columns=["desv_padrao_dc", "cv_dc"], errors="ignore")
    pelt_d0 = pelt_d0.drop(columns=["desv_padrao_dc", "cv_dc"], errors="ignore")
    ward_dc = ward_dc.drop(columns=["desv_padrao_d0", "cv_d0"], errors="ignore")
    pelt_dc = pelt_dc.drop(columns=["desv_padrao_d0", "cv_d0"], errors="ignore")

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        ward_d0.to_excel(writer, sheet_name="WARD_d0", index=False)
        ward_dc.to_excel(writer, sheet_name="WARD_dc", index=False)
        pelt_d0.to_excel(writer, sheet_name="PELT_d0", index=False)
        pelt_dc.to_excel(writer, sheet_name="PELT_dc", index=False)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Segmentacao homogenea SGP (WARD + PELT)")
    parser.add_argument("--input", required=True, help="Arquivo Excel de entrada")
    parser.add_argument(
        "--output",
        default=None,
        help="Arquivo de saida (opcional). Se omitido: segmentacao_homogenea_YYYYMMDD_HHMMSS.xlsx",
    )
    parser.add_argument("--sheet", default=None, help="Aba de entrada (opcional)")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    output = args.output
    if not output:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = f"segmentacao_homogenea_{ts}.xlsx"

    gerar_excel_segmentacao(args.input, output, args.sheet)
    print(f"OK: arquivo gerado em {output}")


if __name__ == "__main__":
    main()
