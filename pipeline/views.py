"""Rebuild the reporting layer's derived views from the exported records, following their SQL.

client_events and won_clients_master are exported; daily_client_activity and client_cohort_performance are
documented in the SQL reference but were not exported, so they are rebuilt here. quality.py reconciles every
rebuilt view with the exported ones (event counts, per-deal dates, cohort population).

Conventions taken from the SQL reference:
- Event periods are WHEN the milestone happened, not the start cohort. Weeks start on Sunday.
- daily_client_activity runs from 2024-01-01 to the reporting date; events dated after it (scheduled closings)
  fall outside the calendar. Monthly figures SUM daily counts; rates are recomputed from the sums;
  cumulative_net_change is the last day's value, never a sum, and is not the hunting backlog.
- client_cohort_performance holds confirmed Jira starts only. 'reporting_as_of_date' is pinned to the data date
  of this version (the SQL uses the query date), so the published cohort flags never drift.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import definitions as D


def sunday_week(d: pd.Series) -> pd.Series:
    """DATE_TRUNC('week', d + 1) - 1: the Sunday on or before d."""
    return (d - pd.to_timedelta((d.dt.dayofweek + 1) % 7, unit="D")).dt.normalize()


# ----------------------------------------------------------------------------- client_events
def events(eng: pd.DataFrame) -> pd.DataFrame:
    """Long event table, one row per deal x event type with a date (closing uses the raw closing date, as the SQL)."""
    cols = {
        "Deal Created": "deal_created", "Client Won": "won_date",
        "Client Started": None, "Under Contract": "uc", "Passed Inspection": "pi",
        "Property Closed": "closed_raw", "Client Refunded": "refund_date",
    }
    parts = []
    for order, et in D.EVENT_TYPES:
        if et == "Client Started":
            dates = eng["start"].where(eng["start_source"].eq("JIRA"))
        else:
            dates = eng[cols[et]]
        p = pd.DataFrame({"deal_id": eng["id"], "event_order": order, "event_type": et, "event_date": dates})
        parts.append(p[p.event_date.notna()])
    ev = pd.concat(parts, ignore_index=True)
    ev["event_month"] = ev.event_date.dt.to_period("M").dt.to_timestamp()
    ev["event_week"] = sunday_week(ev.event_date)
    return ev.sort_values(["deal_id", "event_order"]).reset_index(drop=True)


# ----------------------------------------------------------------------------- daily_client_activity
DAILY_COUNTS = {"clients_won": "Client Won", "clients_started": "Client Started", "clients_went_uc": "Under Contract",
                "clients_passed_inspection": "Passed Inspection", "properties_closed": "Property Closed",
                "clients_refunded": "Client Refunded"}


def daily_activity(ev: pd.DataFrame, asof: pd.Timestamp) -> pd.DataFrame:
    cal = pd.DataFrame({"activity_date": pd.date_range(D.DAILY_FROM, asof, freq="D")})
    cal["activity_week"] = sunday_week(cal.activity_date)
    cal["activity_month"] = cal.activity_date.dt.to_period("M").dt.to_timestamp()
    cal["activity_quarter"] = cal.activity_date.dt.to_period("Q").dt.to_timestamp()
    cal["activity_year"] = cal.activity_date.dt.year
    counts = ev.pivot_table(index="event_date", columns="event_type", values="deal_id", aggfunc="count").fillna(0)
    for col, et in DAILY_COUNTS.items():
        cal[col] = cal.activity_date.map(counts[et] if et in counts else pd.Series(dtype=float)).fillna(0).astype(int)
    cal["net_client_change"] = cal.clients_started - cal.clients_went_uc
    cal["replacement_rate"] = (cal.clients_went_uc / cal.clients_started.replace(0, np.nan)).round(4)
    cal["cumulative_net_change"] = cal.net_client_change.cumsum()
    return cal


def monthly_activity(daily: pd.DataFrame) -> pd.DataFrame:
    """The SQL reference's 'safe monthly aggregation'."""
    g = daily.groupby("activity_month")
    out = g[list(DAILY_COUNTS) + ["net_client_change"]].sum()
    out["replacement_rate"] = (out.clients_went_uc / out.clients_started.replace(0, np.nan))
    out["cumulative_net_change"] = g.cumulative_net_change.last()
    out["days"] = g.size()
    out = out.reset_index()
    out["month"] = out.activity_month.dt.strftime("%Y-%m")
    return out


# ----------------------------------------------------------------------------- client_cohort_performance
def cohort_performance(eng: pd.DataFrame, asof: pd.Timestamp) -> pd.DataFrame:
    c = eng[eng["start_source"].eq("JIRA") & eng["start"].notna()].copy()
    c["client_start_month"] = c.start.dt.to_period("M").dt.to_timestamp()
    c["client_start_week"] = sunday_week(c.start)
    c["reporting_as_of_date"] = asof
    c["days_since_start"] = (asof - c.start).dt.days
    c["reached_uc"] = c.uc.notna().astype(int)
    c["days_hunting"] = c.days_since_start.where(c.hunting.fillna(False).astype(bool))
    c["is_refunded"] = c.refunded.fillna(False).astype(bool).astype(int)
    c["adjusted_cohort_eligible"] = 1 - c.is_refunded
    dtu = c.days_to_uc
    for w in D.COHORT_WINDOWS:
        c[f"eligible_{w}d"] = (c.days_since_start >= w).astype(int)
        c[f"uc_within_{w}d"] = ((dtu >= 0) & (dtu <= w)).astype(int)
        c[f"adj_eligible_{w}d"] = c[f"eligible_{w}d"] * c.adjusted_cohort_eligible
        c[f"adj_uc_within_{w}d"] = c[f"uc_within_{w}d"] * c[f"eligible_{w}d"] * c.adjusted_cohort_eligible
    c["unconverted_at_14d"] = ((c.eligible_14d == 1) & (c.uc_within_14d == 0)).astype(int)
    c["unconverted_at_30d"] = ((c.eligible_30d == 1) & (c.uc_within_30d == 0)).astype(int)
    c["uc_between_14_30d"] = ((dtu > 14) & (dtu <= 30)).astype(int)
    c["uc_between_30_60d"] = ((dtu > 30) & (dtu <= 60)).astype(int)
    c["uc_between_30_90d"] = ((dtu > 30) & (dtu <= 90)).astype(int)
    return c


def cohort_monthly(c: pd.DataFrame) -> pd.DataFrame:
    """Matured conversion by start month: SUM(uc_within_Nd * eligible_Nd) / SUM(eligible_Nd), gross and refund-excluded."""
    rows = []
    for m, g in c.groupby("client_start_month"):
        r = {"month": m.strftime("%Y-%m"), "n": int(len(g)), "refunded": int(g.is_refunded.sum()),
             "reached_uc": int(g.reached_uc.sum())}
        for w in D.COHORT_WINDOWS:
            el, cv = int(g[f"eligible_{w}d"].sum()), int((g[f"uc_within_{w}d"] * g[f"eligible_{w}d"]).sum())
            ael, acv = int(g[f"adj_eligible_{w}d"].sum()), int(g[f"adj_uc_within_{w}d"].sum())
            r[f"w{w}"] = {"eligible": el, "converted": cv, "adj_eligible": ael, "adj_converted": acv}
        rows.append(r)
    return pd.DataFrame(rows)
