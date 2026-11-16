"""Reconciliation and data-quality checks for the 16 Nov 2026 version.

Two kinds of result:
- recon: hard checks that the rebuilt records and views reproduce the exported views and the SQL reference's
  rules. Any failure stops the build (build.py) because a published figure would no longer be traceable.
- quality: findings about coverage, anomalies and assumptions, shown on the Data health section. Each item:
  id, area, severity (good|warning|serious|critical|info), title, metric, detail, impact, keys.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import definitions as D
import views as V


def _keys(s: pd.Series, n: int = 60) -> list:
    return [str(x) for x in s.dropna().tolist()[:n]]


# ----------------------------------------------------------------------------- hard reconciliation
def reconcile(frames: dict, deals: pd.DataFrame, jira: pd.DataFrame, eng: pd.DataFrame, ev: pd.DataFrame,
              daily: pd.DataFrame, cohort: pd.DataFrame, asof: pd.Timestamp) -> list[dict]:
    out = []

    def chk(id_, name, got, want):
        ok = bool(got == want) if not isinstance(got, float) else abs(got - want) < 1e-6
        out.append({"id": id_, "check": name, "got": got, "want": want, "ok": ok})

    rj, rp, rm, re_, rc = frames["jira"], frames["deals"], frames["master"], frames["events"], frames["cash"]
    # grains
    chk("grain_deals", "pipedrive_reporting_base: one row per deal_id", int(rp.deal_id.duplicated().sum()), 0)
    chk("grain_jira", "jira_reporting_base: one row per Jira key", int(rj.key.duplicated().sum()), 0)
    chk("grain_master", "won_clients_master: one row per deal_id and dupe_check = 1", (int(rm.deal_id.duplicated().sum()), int((rm.dupe_check != 1).sum())), (0, 0))
    chk("grain_events", "client_events: at most one row per deal x event type", int(re_.duplicated(["deal_id", "event_type"]).sum()), 0)
    chk("grain_cash", "client_cash_forecast: one row per won deal, same deals as the master", (len(rc), set(rc.deal_id) == set(rm.deal_id)), (len(rm), True))
    chk("master_scope", "won_clients_master = every won STR Search deal in pipedrive_reporting_base",
        (len(rm), set(rm.deal_id) == set(rp[rp.won_time.notna()].deal_id)), (int(rp.won_time.notna().sum()), True))
    # rebuilt client_events == exported client_events (per deal, type and date)
    a = ev[["deal_id", "event_type", "event_date"]].astype({"deal_id": int})
    b = re_[["deal_id", "event_type", "event_date"]].assign(event_date=lambda x: pd.to_datetime(x.event_date).dt.normalize()).astype({"deal_id": int})
    diff = a.merge(b, how="outer", on=["deal_id", "event_type", "event_date"], indicator=True)
    chk("events_rebuild", "Rebuilt client_events rows that differ from the export", int((diff._merge != "both").sum()), 0)
    for et in [t for _, t in D.EVENT_TYPES]:
        chk(f"events_{et.lower().replace(' ', '_')}", f"client_events '{et}' count", int((re_.event_type == et).sum()), int((ev.event_type == et).sum()))
    # rebuilt daily view == events dated inside its calendar
    inside = ev[(ev.event_date >= pd.Timestamp(D.DAILY_FROM)) & (ev.event_date <= asof)]
    for col, et in V.DAILY_COUNTS.items():
        chk(f"daily_{col}", f"daily_client_activity.{col} total = '{et}' events dated {D.DAILY_FROM} to the data date",
            int(daily[col].sum()), int((inside.event_type == et).sum()))
    chk("daily_cumulative", "cumulative_net_change on the last day = all starts - all UC in the calendar",
        int(daily.cumulative_net_change.iloc[-1]), int(daily.clients_started.sum() - daily.clients_went_uc.sum()))
    # cohort population
    chk("cohort_population", "client_cohort_performance = master rows with client_start_date_source = 'JIRA'",
        int(len(cohort)), int((rm.client_start_date_source == "JIRA").sum()))
    # flags = their status lists (Jira grain)
    st = jira.status
    chk("flag_signed", "signed_up_client = status in the signed-up list (rows that differ)", int((jira.signed != st.isin(D.SIGNED_UP_STATUSES)).sum()), 0)
    chk("flag_active", "active_clients = signed-up minus Refunded / Paused / Additional Service (rows that differ)", int((jira.active != st.isin(D.ACTIVE_STATUSES)).sum()), 0)
    chk("flag_inactive", "inactive_clients = Refunded / Paused / Additional Service (rows that differ)", int((jira.inactive != st.isin(D.INACTIVE_STATUSES)).sum()), 0)
    chk("flag_hunting", "hunting_clients = Client Start / 2 / 4 / 6 / 8 Weeks (rows that differ)", int((jira.hunting != st.isin(D.HUNTING_STATUSES)).sum()), 0)
    chk("flag_refunded", "client_refunded = status Refunded (rows that differ)", int((jira.refunded != st.eq("Refunded")).sum()), 0)
    chk("flag_sum", "signed = active + inactive", int(jira.signed.sum()), int(jira.active.sum() + jira.inactive.sum()))
    # start rule
    created = jira.created; rule_date = pd.Timestamp(D.START_RULE_DATE)
    won_by_key = pd.to_datetime(rj.won_date).dt.normalize()
    exp_start = np.where(created < rule_date, jira.due.fillna(created + pd.Timedelta(days=D.CREATED_OFFSET_DAYS)), won_by_key)
    exp_start = pd.to_datetime(pd.Series(exp_start, index=jira.index))
    same = (exp_start == jira.start) | (exp_start.isna() & jira.start.isna())
    chk("start_rule", "client_start_date follows the documented rule (rows that differ)", int((~same).sum()), 0)
    m_start = np.where(rm.client_start_date_source == "JIRA", True, rm.client_start_date == pd.to_datetime(rm.won_time).dt.normalize())
    chk("start_fallback", "Pipedrive Fallback starts equal the won date (rows that differ)", int((~pd.Series(m_start)).sum()), 0)
    # HENRY and duration formulas
    chk("henry_rule", "henry_client = total_oop <= 225,000 (rows that differ)",
        int(((pd.to_numeric(rj.total_oop, errors="coerce") <= D.HENRY_OOP_MAX).astype(int) != rj.henry_client).sum()), 0)
    d_uc = (pd.to_datetime(rm.property_uc_date) - pd.to_datetime(rm.client_start_date)).dt.days
    chk("days_to_uc", "days_to_uc = property_uc_date - client_start_date (rows that differ)",
        int((~((d_uc == rm.days_to_uc) | (d_uc.isna() & rm.days_to_uc.isna()))).sum()), 0)
    # cash identity
    c = rc
    rec = (c.assumed_total_cash_collected + c.outstanding_cash_balance - c.deal_value).abs() < 0.01
    chk("cash_identity", "assumed collected + outstanding = deal value (rows that differ)", int((~rec).sum()), 0)
    split = c.payment_type_normalized == "Split Pay"
    chk("cash_split_rule", "split pay: outstanding = 50% when no closing date, else 0 (rows that differ)",
        int((split & ~np.isclose(c.outstanding_cash_balance, np.where(c.property_closed_date.isna(), c.deal_value * 0.5, 0))).sum()), 0)
    chk("cash_refund_rule", "refund-excluded amounts are zero for refunded engagements (rows that differ)",
        int(((c.client_refunded == 1) & ((c.refund_excluded_assumed_cash_collected != 0) | (c.refund_excluded_outstanding_cash_balance != 0))).sum()), 0)
    # the as-of date of this version
    chk("asof", "Reporting date read from the views", asof.strftime("%Y-%m-%d"), D.VERSION_ID)
    return out


# ----------------------------------------------------------------------------- findings
def run_checks(deals: pd.DataFrame, jira: pd.DataFrame, eng: pd.DataFrame, cohort: pd.DataFrame, asof: pd.Timestamp) -> list[dict]:
    out = []

    def add(id_, area, sev, title, metric, detail, impact, keys=None):
        out.append({"id": id_, "area": area, "severity": sev, "title": title, "metric": metric,
                    "detail": detail, "impact": impact, "keys": keys or []})

    signed = jira[jira.signed]
    sched = jira[jira.closed_scheduled]
    add("scheduled_closings", "Milestones", "warning", "Closing dates after the data date",
        f"{len(sched)} closings dated after {asof:%d %b %Y}",
        "property_closed_date holds dates up to " + (sched.closed_raw.max().strftime("%d %b %Y") if len(sched) else "-") +
        ". They look like scheduled closings. client_events lists them as 'Property Closed' and the cash view counts their second split-pay installment as collected.",
        "This build counts them as scheduled, not closed: they are left out of CLOSED counts, durations and attainment. Cash figures show them separately.",
        _keys(sched.key))
    ucst = jira[jira.status.isin(["Under Contract", "Passed Inspection"]) & jira.closed_raw.notna()]
    add("closing_date_open_status", "Milestones", "info", "Closing date on clients still Under Contract or Passed Inspection",
        f"{len(ucst)} clients", "The closing-date field is filled before the status moves to CLOSED (some dates are in the future).",
        "CLOSED counts follow the date field, not the status.", _keys(ucst.key))
    shifted = None
    add("latest_uc", "Milestones", "warning", "Under Contract = latest valid contract, not the first",
        "Definition", "property_uc_date is the latest currently valid UC date (falls back to the first). A contract that falls through moves or clears it; the first-contract history and contract counts are not in the reporting layer.",
        "Days to UC measure time to the contract that stands today. Fall-through rates cannot be measured from this version.")
    nj = eng[~eng.has_jira]
    recent = int((nj.won_date >= asof - pd.Timedelta(days=60)).sum())
    add("won_no_jira", "Links", "warning", "Won engagements with no Jira match", f"{len(nj)} of {len(eng)}",
        f"{recent} were won in the last 60 days; the rest are older ({', '.join(f'{y}: {n}' for y, n in nj.won_date.dt.year.value_counts().sort_index().items())}). The SQL reference notes a client may have bought a search that has not started.",
        "They keep a Pipedrive fallback start date, which is not a confirmed start: they are excluded from starts, durations and cohorts but stay in won counts and the cash model.",
        _keys(nj.id.astype(str)))
    mm = eng[eng.key_mismatch]
    add("key_mismatch", "Links", "warning" if len(mm) else "good", "Jira key in Pipedrive differs from the matched issue", f"{len(mm)}",
        "The Pipedrive deal names a different Jira key from the issue that links to it through pd_deal_id.", "Flagged as data anomalies; counted with the pd_deal_id match.", _keys(mm.id.astype(str)))
    presale = eng[eng.has_jira & ~eng.signed.fillna(False).astype(bool)]
    add("won_presale_status", "Links", "warning" if len(presale) else "good", "Won engagements whose Jira issue is still pre-sale",
        f"{len(presale)}", "The Pipedrive deal is won but the Jira status is New Clients, Onboarding Completed or Services Declined. The reporting layer still gives them a confirmed (Jira) start: the won date.",
        "They count as Client Started events and in cohorts, but not as signed, active or hunting Jira clients.", _keys(presale.jira_key))
    keys_master = set(eng.jira_key.dropna())
    sig_out = signed[~signed.key.isin(keys_master)]
    add("signed_not_won", "Links", "warning" if len(sig_out) else "good", "Signed Jira clients with no won engagement",
        f"{len(sig_out)} of {len(signed)}", f"{int(sig_out.deal_id.isna().sum())} have no deal link; the rest link to a deal that is not won or not unique. {int(signed.start.isna().sum())} signed clients have no client_start_date at all.",
        "They count as signed / active / hunting Jira clients but have no engagement-grain start.", _keys(sig_out.key))
    hj, he = int(jira.hunting.sum()), int((eng.hunting.fillna(False).astype(bool) & eng.has_jira).sum())
    add("hunting_counts", "Jira", "info", "Two hunting counts", f"Jira statuses {hj} · won engagements {he}",
        "The SQL reference's current hunting count is won_clients_master WHERE hunting_clients = 1 AND has_jira_match = 1; Jira issues in hunting statuses without a won engagement add the difference.",
        "Status-based client counts use the Jira grain; engagement measures use the master.")
    anom = eng[eng.anomaly]
    reasons = {"duplicate Jira match": int(eng.anomaly_dup_jira.sum()), "key mismatch": int(eng.key_mismatch.sum()),
               "UC before start": int(eng.anomaly_uc_before_start.sum()), "close before UC": int(eng.anomaly_close_before_uc.sum()),
               "hunting with a UC date": int(eng.anomaly_hunting_with_uc.sum())}
    add("anomalies", "Links", "warning" if len(anom) else "good", "Engagements flagged has_data_anomaly", f"{len(anom)}",
        "; ".join(f"{k}: {v}" for k, v in reasons.items() if v) or "None.",
        "Kept in every count (the SQL reference says never drop anomalous won deals).", _keys(anom.id.astype(str)))
    lost = deals[deals.status == "lost"]
    rec_n = int(deals.payment_recorded.notna().sum())
    add("payment_default", "Cash", "serious", "Payment type looks defaulted to Split Pay",
        f"Split Pay on {int((lost.payment == 'Split Pay').sum()):,} of {len(lost):,} lost deals",
        f"pipedrive_reporting_base fills payment_type on every deal, while the raw field carried into jira_reporting_base is recorded on only {rec_n} deals. Where both exist they agree.",
        "The cash model treats every unrecorded engagement as Split Pay, so modeled outstanding balances are an upper bound if some clients paid in full.")
    oop = jira[jira.oop_invalid]; bud = jira[jira.budget_invalid]; dsi = jira[jira.deals_sent_invalid]
    zero = eng[eng.value == 0]
    add("abnormal_values", "Data entry", "warning", "Abnormal values excluded from aggregates",
        f"{len(oop)} total_oop · {len(bud)} budget · {len(dsi)} deals sent · {len(zero)} zero-value wins",
        f"total_oop above ${D.OOP_VALID_MAX:,.0f} (a placeholder value), client_budget below ${D.BUDGET_VALID_MIN:,.0f}, total_deals_sent above {D.DEALS_SENT_VALID_MAX}. Zero-value won deals stay in counts.",
        "Excluded from averages and bands; HENRY flags are unaffected (the placeholder is not <= $225K).", _keys(pd.concat([oop.key, bud.key, dsi.key])))
    no_oop = signed[~signed.oop_known]
    add("henry_unknown", "Segments", "warning", "HENRY is unknown for signed clients without total_oop",
        f"{len(no_oop)} of {len(signed)} signed clients", "henry_client is 0 when total_oop is missing.",
        "HENRY shares use clients with a known total_oop as the denominator.")
    rf = jira[jira.refunded]
    by_m = rf.refund_date.dt.strftime("%Y-%m").value_counts().sort_index()
    top = by_m.idxmax() if len(by_m) else None
    add("refund_proxy", "Refunds", "warning", "Refunds are a Jira status proxy",
        f"{len(rf)} refunded · most in {pd.Timestamp(top + '-01'):%b %Y} ({int(by_m.max())})" if top else f"{len(rf)}",
        "client_refunded = current status Refunded; the date is when the status last changed. Earlier refunds that moved on, and refunds before the Jira history, are missed.",
        "Refund timing can reflect status clean-ups rather than payment dates; refund-adjusted rates drop currently refunded clients from denominators.", _keys(rf.key))
    neg = cohort[cohort.days_to_uc < 0]
    add("negative_duration", "Milestones", "info" if len(neg) <= 2 else "warning", "UC dated before the client start", f"{len(neg)}",
        "A UC date earlier than client_start_date.", "Left out of duration statistics (negative days).", _keys(neg.jira_key))
    pre = signed[signed.start_rule == "created+4"]
    add("created_plus4", "Start date", "info", "Start dates set to created + 4 days", f"{len(pre)} signed clients",
        "Issues created before 1 Jun 2026 with no due date start 4 days after creation (the reporting layer's rule).",
        "Small: affects older clients only.", _keys(pre.key))
    add("start_rule_change", "Start date", "info", "The start date changes meaning on 1 Jun 2026",
        "Reporting rule", "Issues created before 1 Jun 2026 start on the due date (a kickoff date after the sale); from 1 Jun 2026 the start is the Pipedrive won date. The New Client Experience itself began on 27 May 2026.",
        "Durations before and after June are measured from different events; compare eras with care.")
    deals_cov = deals[deals.in_scope]
    add("channel_coverage", "Pipedrive", "warning", "Lead channel (utm_source) is sparse",
        f"{deals_cov.channel.notna().mean():.0%} of in-scope deals", "The reporting base has no lead-source field like the 12 Nov PD_Source; utm_source is the only channel field.",
        "Channel splits describe tagged deals only.")
    exp = deals_cov.groupby("experience")[["call_booked", "no_show", "onboarding_completed"]].mean()
    add("funnel_flags", "Pipedrive", "warning", "Funnel flags changed meaning on 27 May 2026",
        "; ".join(f"{e}: call booked {r.call_booked:.0%}" for e, r in exp.iterrows()),
        "Stage-based flags (call booked, no show, onboarding) follow different stages in the legacy and New Client Experience pipelines.",
        "Compare funnel rates within one experience only.")
    add("pipeline_scope", "Pipedrive", "info", "Only the STR Search pipeline is in the reporting base", f"{len(deals):,} deals",
        "Since June 2026 no-show bookings move to the SDR Setter pipeline, which is not in pipedrive_reporting_base.",
        "No-show and booked-call counts after June are understated.")
    add("deals_sent", "Jira", "warning", "Deals sent is a current cumulative total", f"{int(signed.deals_sent.notna().sum())} signed clients with a value",
        "total_deals_sent has no dates: there is no record of when each property was sent.",
        "Early deal velocity (e.g. properties in the first 14 days) cannot be measured; long searches accumulate more deals by construction.")
    add("asof", "Snapshot", "good", "Reporting date", asof.strftime("%d %b %Y"),
        "Read from the views' own date arithmetic (won_clients_master refresh and client_cash_forecast query date agree).",
        "Cohort maturity and elapsed days are measured to this date.")
    return out
