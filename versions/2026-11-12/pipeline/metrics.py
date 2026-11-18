"""Headline metrics computed in Python. The dashboard recomputes the same numbers in the browser;
SX.parity() compares the two (unfiltered view) so a refresh cannot silently drift."""
from __future__ import annotations

import numpy as np
import pandas as pd


def _stats(s: pd.Series) -> dict:
    s = s.dropna()
    s = s[s >= 0]
    if s.empty:
        return {"n": 0}
    return {"n": int(len(s)), "mean": round(float(s.mean()), 2), "median": float(s.median()),
            "p25": float(s.quantile(0.25)), "p75": float(s.quantile(0.75)), "p90": round(float(s.quantile(0.9)), 2)}


def km_median(t: pd.Series, e: pd.Series) -> float | None:
    """Kaplan-Meier: day at which the cumulative share reaching the milestone first hits 50%."""
    df = pd.DataFrame({"t": t, "e": e}).dropna()
    df = df[df.t >= 0].sort_values("t")
    at_risk, surv = len(df), 1.0
    for tt, g in df.groupby("t", sort=True):
        d = int(g.e.sum())
        if d and at_risk:
            surv *= 1 - d / at_risk
            if surv <= 0.5:
                return float(tt)
        at_risk -= len(g)
    return None


def expected(deals: pd.DataFrame, jira: pd.DataFrame, asof: pd.Timestamp) -> dict:
    sc = deals[deals.in_scope]
    won = sc[sc.status == "won"]
    signed = jira[jira.signed_list]
    act = jira[jira.active_list]
    # time-to-event for signed-up clients (censored at as-of)
    t_uc = np.where(signed.uc.notna(), signed.days_uc, (asof - signed.start).dt.days)
    t_cl = np.where(signed.closed.notna(), signed.days_closed, (asof - signed.start).dt.days)
    months = pd.period_range("2024-01", asof.to_period("M"), freq="M")
    def by_month(s):
        return s.dropna().dt.to_period("M").value_counts()
    ns, na, uc, cl = by_month(signed.start), by_month(jira.created), by_month(jira.uc), by_month(jira.closed)
    q3 = [{"month": str(m), "new_signed_start": int(ns.get(m, 0)), "new_all_created": int(na.get(m, 0)),
           "uc": int(uc.get(m, 0)), "closed": int(cl.get(m, 0))} for m in months]
    return {
        "deals": {"in_scope": int(len(sc)), "won": int(len(won)), "lost": int((sc.status == "lost").sum()),
                  "open": int((sc.status == "open").sum()), "won_value": float(won.value.sum()),
                  "median_days_to_win": float(won.days_to_win.median())},
        "jira": {"total": int(len(jira)), "signed": int(len(signed)), "active": int(len(act)),
                 "inactive": int(jira.inactive_list.sum()), "unmapped": int((~jira.signed_list).sum())},
        "q1": {"uc": _stats(jira.days_uc), "closed": _stats(jira.days_closed), "pi": _stats(jira.days_pi),
               "km_uc_signed": km_median(pd.Series(t_uc), pd.Series(signed.uc.notna().values)),
               "km_closed_signed": km_median(pd.Series(t_cl), pd.Series(signed.closed.notna().values))},
        "q2": {"active": int(len(act)), "active_uc": int(act.uc.notna().sum()), "active_closed": int(act.closed.notna().sum()),
               "signed": int(len(signed)), "signed_uc": int(signed.uc.notna().sum()), "signed_closed": int(signed.closed.notna().sum())},
        "q3": q3,
    }


def extras(deals: pd.DataFrame, jira: pd.DataFrame, frames: dict, asof: pd.Timestamp) -> dict:
    """Aggregates that need columns we do not export at record level."""
    raw = frames["deals"]
    created = pd.to_datetime(raw["Deal_Created_At_EST"], errors="coerce", utc=True, format="mixed").dt.tz_convert("America/New_York")
    mon = created.dt.strftime("%Y-%m")
    p6_booked = raw[(raw.pipeline_id == 6) & raw["Calendly_ID"].notna()]
    p3_noshow = raw[(raw.pipeline_id == 3) & (raw["Lost reason"] == "No Show")]
    months = [str(m) for m in pd.period_range("2025-06", asof.to_period("M"), freq="M")]
    sdr = [{"month": m, "p6_calendly_booked": int((mon[p6_booked.index] == m).sum()),
            "p3_no_show_lost": int((mon[p3_noshow.index] == m).sum()),
            "p3_created": int(((mon == m) & (raw.pipeline_id == 3)).sum())} for m in months]
    return {"sdr_moves": sdr, "p6_total": int((raw.pipeline_id == 6).sum())}
