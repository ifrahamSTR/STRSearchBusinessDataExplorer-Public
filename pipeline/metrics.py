"""Headline metrics for the 16 Nov 2026 version, computed once in Python.

The Explorer recomputes the same numbers in the browser and SX.parity() compares them (unfiltered view); the
Executive Report imports this module, so both sites publish identical shared headline figures.

Populations (never mixed):
- Jira-issue grain: client counts by status flag (signed / active / inactive / hunting), attainment (Q2).
- Engagement grain with a confirmed Jira start (client_cohort_performance): acquisition durations (Q1),
  Kaplan-Meier, matured cohorts.
- Event grain by event date (daily_client_activity): monthly throughput, net client change (Q3).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import definitions as D


def stats(s: pd.Series) -> dict:
    s = pd.to_numeric(s, errors="coerce").dropna()
    s = s[s >= 0]
    if s.empty:
        return {"n": 0}
    return {"n": int(len(s)), "mean": round(float(s.mean()), 2), "median": float(s.median()),
            "p25": float(s.quantile(0.25)), "p75": float(s.quantile(0.75)), "p90": round(float(s.quantile(0.9)), 2)}


def km_curve(t, e) -> pd.DataFrame:
    """Kaplan-Meier product-limit estimate of the cumulative share reaching the milestone by day t."""
    df = pd.DataFrame({"t": np.asarray(t, float), "e": np.asarray(e, bool)}).dropna()
    df = df[df.t >= 0]
    g = df.groupby("t").e.agg(["size", "sum"]).sort_index()
    at_risk = len(df) - g["size"].cumsum().shift(fill_value=0)
    surv = (1 - g["sum"] / at_risk).cumprod()
    return pd.DataFrame({"t": g.index.values, "cum": (1 - surv).values, "at_risk": at_risk.values, "events": g["sum"].values})


def km_median(t, e) -> float | None:
    k = km_curve(t, e)
    hit = k[k.cum >= 0.5]
    return float(hit.t.iloc[0]) if len(hit) else None


def clock(cohort: pd.DataFrame, milestone: str) -> tuple[np.ndarray, np.ndarray]:
    """Time-to-event inputs on the confirmed-start population: event time when the milestone is recorded,
    otherwise days on the clock at the data date (refunded and paused clients stay in, as not yet reached)."""
    days = cohort["days_to_uc"] if milestone == "uc" else cohort["days_to_close"]
    hit = (cohort["uc"] if milestone == "uc" else cohort["closed"]).notna()
    t = np.where(hit, days, cohort["days_since_start"])
    return t, hit.values


def expected(deals: pd.DataFrame, jira: pd.DataFrame, eng: pd.DataFrame, cohort: pd.DataFrame,
             monthly: pd.DataFrame, cohort_by_month: pd.DataFrame, asof: pd.Timestamp) -> dict:
    sc = deals[deals.in_scope]
    won = sc[sc.status == "won"]
    signed, act = jira[jira.signed], jira[jira.active]
    t_uc, e_uc = clock(cohort, "uc")
    t_cl, e_cl = clock(cohort, "closed")
    intake = jira.assign(month=jira.created.dt.strftime("%Y-%m")).groupby(["month", "class"]).size().unstack(fill_value=0)
    return {
        "deals": {"all": int(len(deals)), "in_scope": int(len(sc)), "won": int(len(won)), "lost": int((sc.status == "lost").sum()),
                  "open": int((sc.status == "open").sum()), "won_value": float(won.value.sum()),
                  "median_days_to_win": float(won.days_to_win.median()), "won_all": int((deals.status == "won").sum())},
        "jira": {"total": int(len(jira)), "signed": int(len(signed)), "active": int(len(act)),
                 "inactive": int(jira.inactive.sum()), "hunting": int(jira.hunting.sum()),
                 "presale": int((jira["class"] == "Pre-sale").sum()), "declined": int((jira["class"] == "Services declined").sum()),
                 "refunded": int(jira.refunded.sum()), "henry": int(jira.henry.sum()),
                 "signed_oop_known": int(signed.oop_known.sum()), "signed_no_start": int(signed.start.isna().sum())},
        "engagements": {"total": int(len(eng)), "has_jira": int(eng.has_jira.sum()), "no_jira": int((~eng.has_jira).sum()),
                        "confirmed_starts": int(eng.confirmed_start.sum()), "fallback": int((eng.start_source == "Pipedrive Fallback").sum()),
                        "repeat": int(eng.repeat_client.sum()), "anomalies": int(eng.anomaly.sum()),
                        "key_mismatch": int(eng.key_mismatch.sum()), "refunded": int(eng.refunded.fillna(False).astype(bool).sum()),
                        "hunting_official": int((eng.hunting.fillna(False).astype(bool) & eng.has_jira).sum()),
                        "jira_not_signed": int((eng.has_jira & ~eng.signed.fillna(False).astype(bool)).sum()),
                        "scheduled_closings": int(eng.closed_scheduled.sum())},
        "q1": {"population": "confirmed Jira starts (client_cohort_performance)", "n": int(len(cohort)),
               "uc": stats(cohort.days_to_uc), "closed": stats(cohort.days_to_close),
               "uc_to_close": stats(cohort.days_uc_to_close),
               "km_uc": km_median(t_uc, e_uc), "km_closed": km_median(t_cl, e_cl),
               "km_events": {"uc": int(e_uc.sum()), "closed": int(e_cl.sum())},
               "negative_days_to_uc": int((cohort.days_to_uc < 0).sum())},
        "q2": {"population": "Jira issues (reporting-layer flags)", "active": int(len(act)), "active_uc": int(act.uc.notna().sum()),
               "active_closed": int(act.closed.notna().sum()), "active_closed_scheduled": int(act.closed_scheduled.sum()),
               "signed": int(len(signed)), "signed_uc": int(signed.uc.notna().sum()), "signed_closed": int(signed.closed.notna().sum()),
               "hunting": int(jira.hunting.sum())},
        "q3": [{"month": r.month, "won": int(r.clients_won), "started": int(r.clients_started), "uc": int(r.clients_went_uc),
                "pi": int(r.clients_passed_inspection), "closed": int(r.properties_closed), "refunded": int(r.clients_refunded),
                "net_client_change": int(r.net_client_change),
                "replacement_rate": None if pd.isna(r.replacement_rate) else round(float(r.replacement_rate), 4),
                "cumulative_net_change": int(r.cumulative_net_change), "days": int(r.days)} for r in monthly.itertuples()],
        "intake": [{"month": m, **{k: int(row.get(k, 0)) for k in ["Signed client", "Pre-sale", "Services declined", "Other"]},
                    "all": int(row.sum())} for m, row in intake.iterrows()],
        "cohort": cohort_by_month.to_dict("records"),
    }
