"""Budget performance (added 18 Nov 2026): the Python reference for the Explorer's budget view.

Population: won engagements with a confirmed Jira start (client_cohort_performance), one row per search. Groups:
  form budget   the onboarding form's all-in out-of-pocket capital range, read at its upper end (enrich.py):
                  cmp     Up to $250K (upper end <= $250K) vs Above $250K
                  strict  Below $250K (range ends below $250K) / Range ends at $250K ($200K–$250K) / Above $250K
                  band    every range on the form
                Not recorded = no matched form answer (mostly clients who started before the form went live on 20 Apr 2026).
  henry         the Nov 16 Explorer's historical flag: Jira total_oop <= $225K. Recorded mostly at purchase, so unknown for
                most clients still hunting (survivorship); kept for traceability, not for speed comparisons.
Every window share counts only clients who have had the whole window ("eligible"). Like-for-like comparisons are
Mantel-Haenszel risk differences over strata of start month x client experience x start-date rule, with a 95% interval
from the stratified variance. The browser recomputes all of this from the records (SX.parity compares the two).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

WINDOWS = [14, 30, 45, 60, 90]
CLOSE_WINDOWS = [60, 90, 120]
REFUND_WINDOWS = [14, 30, 60, 90]
NOT_RECORDED = "Not recorded"
THIN = 20                     # fewer eligible clients than this in either group: shown, but flagged as too thin to tell


def frame(f, enr) -> pd.DataFrame:
    co = f.cohort.copy()
    e = enr["eng"]
    for c in ["budget_band", "budget_upper", "budget_cmp", "budget_strict", "offers", "stage", "client", "search_no"]:
        co[c] = co.id.map(e[c])
    co["henry_grp"] = np.where(~co.oop_known.fillna(False).astype(bool), "total_oop not recorded",
                               np.where(co.henry.fillna(False).astype(bool), "HENRY (total_oop ≤ $225K)", "total_oop above $225K"))
    asof = f.asof
    co["elapsed"] = (asof - co.start).dt.days
    co["d_uc"] = co.days_to_uc.where(co.uc.notna() & (co.days_to_uc >= 0))
    co["d_cl"] = (co.closed - co.start).dt.days
    rf = co.refunded.fillna(False).astype(bool)
    co["d_rf"] = (co.refund_date - co.start).dt.days.where(rf)
    co["hunt"] = co.hunting.fillna(False).astype(bool)
    co["stratum"] = co.start.dt.strftime("%Y-%m") + "|" + co.experience.fillna("Not tagged") + "|" + co.start_rule.fillna("?")
    return co


def _st(v):
    v = pd.to_numeric(v, errors="coerce").dropna()
    return {"n": int(len(v)), "mean": round(float(v.mean()), 2) if len(v) else None, "median": float(v.median()) if len(v) else None}


def _km(t, ev):
    t, ev = np.asarray(t, float), np.asarray(ev, bool)
    ok = ~np.isnan(t) & (t >= 0)
    t, ev = t[ok], ev[ok]
    if not len(t):
        return None
    order = np.argsort(t, kind="stable")
    t, ev = t[order], ev[order]
    at, surv, i = len(t), 1.0, 0
    while i < len(t):
        x = t[i]
        d = c = 0
        while i < len(t) and t[i] == x:
            d += ev[i]
            c += not ev[i]
            i += 1
        if d and at:
            surv *= 1 - d / at
            if surv <= 0.5:
                return float(x)
        at -= d + c
    return None


def metrics(g: pd.DataFrame, asof) -> dict:
    out = {"n": int(len(g))}
    for w in WINDOWS:
        el = g.elapsed >= w
        out[f"uc{w}"] = {"k": int((el & g.d_uc.between(0, w)).sum()), "eligible": int(el.sum())}
    for w in CLOSE_WINDOWS:
        el = g.elapsed >= w
        out[f"cl{w}"] = {"k": int((el & g.d_cl.between(0, w)).sum()), "eligible": int(el.sum())}
    for w in REFUND_WINDOWS:
        el = g.elapsed >= w
        out[f"rf{w}"] = {"k": int((el & g.d_rf.between(0, w)).sum()), "eligible": int(el.sum())}
    out["recorded"] = _st(g.d_uc)
    u2c = (g.closed - g.uc).dt.days
    out["uc_to_close"] = _st(u2c[u2c >= 0])
    pool = np.where(g.hunt, ((asof + pd.Timedelta(days=1)) - g.start).dt.days, g.d_uc)
    out["scenario"] = _st(pd.Series(pool))
    out["km_uc"] = _km(np.where(g.uc.notna(), g.days_to_uc, g.elapsed), g.uc.notna())
    out["km_closed"] = _km(np.where(g.closed.notna(), g.d_cl, g.elapsed), g.closed.notna())
    out["stages"] = {k: int(v) for k, v in g.stage.value_counts().items()}
    out["closed"] = int(g.closed.notna().sum())
    out["hunting"] = int(g.hunt.sum())
    hw = g.elapsed[g.hunt]
    out["hunting_wait"] = {"median": float(hw.median()) if len(hw) else None, "mean": round(float(hw.mean()), 2) if len(hw) else None}
    return out


def mh(df, col, a, b, days_col, w):
    """Mantel-Haenszel risk difference (a - b) for 'event within w days' over strata (start month x experience x rule)."""
    num = den = var = 0.0
    tot = {"a": [0, 0], "b": [0, 0]}
    used = []
    for s, g in df[df.elapsed >= w].groupby("stratum"):
        x, y = g[g[col] == a], g[g[col] == b]
        if not len(x) or not len(y):
            continue
        ka, kb = int(x[days_col].between(0, w).sum()), int(y[days_col].between(0, w).sum())
        na, nb = len(x), len(y)
        wgt = na * nb / (na + nb)
        pa, pb = ka / na, kb / nb
        num += wgt * (pa - pb)
        den += wgt
        var += wgt ** 2 * (pa * (1 - pa) / na + pb * (1 - pb) / nb)
        tot["a"][0] += ka; tot["a"][1] += na; tot["b"][0] += kb; tot["b"][1] += nb
        used.append({"stratum": s, "a": [ka, na], "b": [kb, nb]})
    if not den:
        return {"w": w, "strata": 0, "diff": None, "lo": None, "hi": None, "a": tot["a"], "b": tot["b"], "thin": True, "cells": []}
    rd, se = num / den, (var ** 0.5) / den
    return {"w": w, "strata": len(used), "diff": round(rd, 4), "lo": round(rd - 1.96 * se, 4), "hi": round(rd + 1.96 * se, 4),
            "a": tot["a"], "b": tot["b"], "thin": tot["a"][1] < THIN or tot["b"][1] < THIN, "cells": used}


def build(f, enr) -> dict:
    df = frame(f, enr)
    asof = f.asof
    groups = {
        "cmp": enr["meta"]["cmp"] + [NOT_RECORDED], "strict": enr["meta"]["strict"] + [NOT_RECORDED],
        "band": [b for b in enr["meta"]["bands"] if (df.budget_band == b).any()] + [NOT_RECORDED],
        "henry": ["HENRY (total_oop ≤ $225K)", "total_oop above $225K", "total_oop not recorded"],
    }
    col = {"cmp": "budget_cmp", "strict": "budget_strict", "band": "budget_band", "henry": "henry_grp"}
    out = {"population": "won engagements with a confirmed Jira start", "n": int(len(df)), "groups": {}}
    for k, labs in groups.items():
        c = df[col[k]].fillna(NOT_RECORDED) if k != "henry" else df[col[k]]
        out["groups"][k] = [{"label": lab, **metrics(df[c == lab], asof)} for lab in labs]
    # like-for-like: the requested pairs
    pairs = {"cmp": ("budget_cmp", "Up to $250K", "Above $250K"), "strict": ("budget_strict", "Below $250K", "Above $250K"),
             "ends": ("budget_strict", "Range ends at $250K", "Above $250K")}
    out["mh"] = {}
    for k, (c, a, bb) in pairs.items():
        out["mh"][k] = {"a": a, "b": bb,
                        "uc": [mh(df, c, a, bb, "d_uc", w) for w in WINDOWS],
                        "closed": [mh(df, c, a, bb, "d_cl", w) for w in CLOSE_WINDOWS],
                        "refunded": [mh(df, c, a, bb, "d_rf", w) for w in REFUND_WINDOWS]}
    m = df[df.budget_cmp.notna()]
    out["coverage"] = {"matched": int(len(m)), "not_recorded": int(df.budget_cmp.isna().sum()),
                       "matched_start_months": {k: int(v) for k, v in m.start.dt.strftime("%Y-%m").value_counts().sort_index().items()},
                       "matched_experience": {k: int(v) for k, v in m.experience.fillna("Not tagged").value_counts().items()},
                       "matched_rule": {k: int(v) for k, v in m.start_rule.value_counts().items()},
                       "not_recorded_before_form": int((df.budget_cmp.isna() & (df.start < pd.Timestamp("2026-04-20"))).sum()),
                       "henry_known": int(df.oop_known.fillna(False).astype(bool).sum()),
                       "henry_known_hunting": int((df.oop_known.fillna(False).astype(bool) & df.hunt).sum()), "hunting": int(df.hunt.sum()),
                       "henry_known_with_uc": int((df.oop_known.fillna(False).astype(bool) & df.uc.notna()).sum()), "with_uc": int(df.uc.notna().sum())}
    return out
