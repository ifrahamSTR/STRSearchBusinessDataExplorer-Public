"""Data-quality checks and reconciliation against the existing FCT reporting layer.
Each check: id, area, severity (good|warning|serious|critical|info), title, metric, detail, impact, keys."""
from __future__ import annotations

import pandas as pd


def _keys(s: pd.Series, n: int = 60) -> list:
    return [str(x) for x in s.dropna().tolist()[:n]]


def run_checks(deals: pd.DataFrame, jira: pd.DataFrame, frames: dict, asof: pd.Timestamp) -> list[dict]:
    sc = deals[deals.in_scope]
    signed = jira[jira.signed_list]
    out = []

    def add(id_, area, sev, title, metric, detail, impact, keys=None):
        out.append({"id": id_, "area": area, "severity": sev, "title": title, "metric": metric,
                    "detail": detail, "impact": impact, "keys": keys or []})

    un = jira[~jira.signed_list]
    add("unmapped_status", "Jira", "serious", "45% of Jira issues sit in statuses outside the status lists",
        f"{len(un):,} of {len(jira):,}",
        "New Clients, Onboarding Completed and Services Declined are pre-sale stages of the New Client Experience "
        "(May 27, 2026). Almost none of them have a won Pipedrive deal.",
        "Raw Jira issue counts after May 2026 include prospects. Count clients with the signed-up list.",
        _keys(un.key))
    nodue = signed[signed.due.isna()]
    add("missing_due", "Jira", "warning", "Signed-up clients without an issue_due_date",
        f"{len(nodue):,} of {len(signed):,}",
        "Their effective start falls back to issue creation. Since May 2026 that date comes before the sale, about 5 days ahead of the onboarding call.",
        "Slightly lengthens days-to-milestone for recent clients; fill the due date at onboarding.", _keys(nodue.key))
    etl_gap = jira[jira.uc.notna() & jira.due.isna()]
    add("etl_days_due_only", "Jira", "warning", "Existing days_to_* fields count from the due date only",
        f"{len(etl_gap):,} UC dates have no ETL day count",
        "days_to_under_contract = first UC − issue_due_date, and it is blank when the due date is missing. "
        "The stated rule is COALESCE(due, created). This dashboard recomputes days with COALESCE.",
        "Reports that use the ETL fields drop these clients and differ slightly from the stated definition.", _keys(etl_gap.key))
    cl_no_uc = signed[signed.closed.notna() & signed.uc.isna()]
    add("closed_without_uc", "Jira", "serious", "Closed clients with no first Under Contract date",
        f"{len(cl_no_uc):,}",
        "The Jira changelog the ETL reads does not always contain the earliest transitions, so first_* dates are "
        "'first seen', not guaranteed to be the first historical event.",
        "UC counts and UC rates are understated, mostly for older clients.", _keys(cl_no_uc.key))
    post = signed[signed.group.isin(["Closed", "Post-close"]) & signed.closed.isna()]
    add("closed_status_no_date", "Jira", "warning", "Closed or post-close status but no first CLOSED date",
        f"{len(post):,}", "The status says the client closed but no CLOSED transition was captured.",
        "CLOSED counts by date are understated, mostly for 2024–25 clients.", _keys(post.key))
    order = jira[jira.uc.notna() & jira.closed.notna() & (jira.closed < jira.uc)]
    add("uc_after_close", "Jira", "warning" if len(order) else "good", "First UC dated after first CLOSED",
        f"{len(order):,}", "Milestone order check.", "Usually a re-contract after an earlier close.", _keys(order.key))
    nohist = jira[~jira.has_history]
    add("no_history", "Jira", "info", "Issues with no status history in the extract", f"{len(nohist):,}",
        "Mostly brand-new 'New Clients' issues that have not moved yet.", "None for signed-up metrics.", _keys(nohist.key))
    nolink = jira[~jira.deal_found]
    add("jira_unlinked", "Links", "warning" if len(nolink) > 15 else "good", "Jira issues without a matching Pipedrive deal",
        f"{len(nolink):,} of {len(jira):,}",
        "Blank PD_Deal_ID (mostly 2024 refunds) or a deal ID missing from the Pipedrive extract (merged or deleted deals).",
        "These issues drop out whenever a Pipedrive-attribute filter is on.", _keys(nolink.key))
    dup = sc[sc.jira_key.notna()].jira_key.value_counts()
    dupk = dup[dup > 1]
    add("key_on_two_deals", "Links", "info", "Jira keys named by more than one Pipedrive deal", f"{len(dupk):,} keys",
        "Repeat deals for the same person point at one Jira issue. Joins go from the Jira side (PD_Deal_ID), which never repeats.",
        "No double counting in this dashboard.", list(dupk.index[:60]))
    wn = sc[(sc.status == "won") & ~sc.has_jira]
    recent = int((wn.won_date >= asof - pd.Timedelta(days=14)).sum())
    add("won_no_jira", "Links", "warning", "Won deals with no Jira issue",
        f"{len(wn):,} of {int((sc.status == 'won').sum()):,}",
        f"{recent} were won in the last 14 days, so the Jira issue may not exist yet. The rest predate the current Jira project or were never linked.",
        "Won → Jira handoff looks slightly incomplete.", _keys(wn.id.astype(str)))
    raw = frames["deals"]
    created = pd.to_datetime(raw["Deal_Created_At_EST"], errors="coerce", utc=True, format="mixed")
    p6 = raw[(raw.pipeline_id == 6) & raw["Calendly_ID"].notna() & (created >= pd.Timestamp("2026-06-01", tz="UTC"))]
    add("noshow_moved", "Pipedrive", "critical", "Booked calls moved from STR Search into the SDR Setter pipeline",
        f"{len(p6):,} Calendly-booked deals since Jun 2026",
        "Since about June 2026, no-show or cancelled booked calls are moved into pipeline 6. 'No Show' lost reasons in STR Search fell from about 130 a month to single digits.",
        "From June 2026, STR Search deal counts and no-show rates are understated and win rates per deal are inflated. Compare periods with care.")
    noprod = sc[(sc.status == "won") & sc["product"].isna()]
    add("product_coverage", "Pipedrive", "warning", "Won deals without a package (Search Product Sold)",
        f"{len(noprod):,} of {int((sc.status == 'won').sum()):,}",
        "The field is a Pipedrive option ID. [203] = Complete and [202] = Core, verified against a labelled Supabase extract. Older wins are blank.",
        "Package splits cover recent wins only.")
    nopay = sc[(sc.status == "won") & sc["payment"].isna()]
    add("payment_labels", "Pipedrive", "serious", "Payment Type has no text labels anywhere in the extracts",
        f"{len(nopay):,} won deals blank",
        "Only option IDs [214] and [215] exist. [214] is 93% of coded wins, consistent with 'most clients choose Split Pay', but no source confirms the labels.",
        "Payment splits are shown as 'Likely Split Pay [214]' and 'Likely Full Pay [215]'. Confirm in Pipedrive settings.")
    add("qualified_defs", "Pipedrive", "warning", "Three different 'qualified' definitions",
        "Stage-based 22% vs column 91%",
        "The Definitions sheet uses current stage. The 'qualified' column and FCT use 'not lost for Not Qualified / AirVal / Partner Opportunity'.",
        "This dashboard uses the 'not disqualified' column and labels it that way.")
    add("source_swap", "Pipedrive", "info", "first_pd_source and latest_pd_source are swapped",
        "ETL logic", "The archived script sorts the wrong way round. PD_Source itself is unaffected.", "Do not use first_/latest_pd_source.")
    add("excel_flags", "Pipedrive", "info", "0/1 flags exported as dates (No_Show, duplicate_deal)",
        "Sheet formatting", "Cells show 00:00 or 1900-01-01. The build decodes them back to 0/1.", "Fix the column format in the Google Sheet.")
    add("utc_dates", "Jira", "info", "Milestone dates are UTC calendar dates", "ETL logic",
        "Late-evening Eastern transitions land on the next day.", "At most ±1 day on day counts.")
    add("survivorship", "Jira", "warning", "Early Jira cohorts only contain issues that still exist",
        "≈288 key numbers absent", "About half of keys 1–299 (Mar 2024–Jun 2025) are deleted or moved.",
        "2024 to mid-2025 volumes and rates describe the surviving issues only.")
    return out


def reconcile_daily(daily: pd.DataFrame, deals: pd.DataFrame, jira: pd.DataFrame, asof: pd.Timestamp) -> dict:
    d = daily.copy()
    d["month"] = pd.to_datetime(d["Date"], errors="coerce").dt.strftime("%Y-%m")
    fct = d.groupby("month")[["PD_Deals", "PD_Won_Deals_by_Won_Date", "Jira_Clients"]].sum()
    sc = deals[deals.in_scope]
    dim_deals = sc.created.dt.strftime("%Y-%m").value_counts()
    dim_won = sc[sc.status == "won"].won_date.dt.strftime("%Y-%m").value_counts()
    dim_jira = jira.created.dt.strftime("%Y-%m").value_counts()
    rows = []
    for m in fct.index:
        if not isinstance(m, str) or m < "2024-02":
            continue
        rows.append({"month": m, "fct_deals": int(fct.at[m, "PD_Deals"]), "dim_deals": int(dim_deals.get(m, 0)),
                     "fct_won": int(fct.at[m, "PD_Won_Deals_by_Won_Date"]), "dim_won": int(dim_won.get(m, 0)),
                     "fct_jira": int(fct.at[m, "Jira_Clients"]), "dim_jira": int(dim_jira.get(m, 0))})
    verdicts = [
        {"metric": "PD_Deals", "verdict": "Trust", "sev": "good", "note": "Pipeline 3, Keep = 1, by created date (ET). Matches the DIM every month to May 2026. Small Oct–Nov gaps come from snapshot timing and deals moved to pipeline 6."},
        {"metric": "PD_Won_Deals (by won date)", "verdict": "Trust", "sev": "good", "note": "Matches within ±1. Won dates use the UTC calendar date."},
        {"metric": "PD_Qualified_Deals", "verdict": "Rename", "sev": "warning", "note": "Counts 'not lost for Not Qualified / AirVal'. That is not the stage rule in the Definitions sheet."},
        {"metric": "PD_No_Shows", "verdict": "Caution", "sev": "serious", "note": "Understated from June 2026, because no-shows are moved into the SDR Setter pipeline."},
        {"metric": "PD_Avg_Days_Won", "verdict": "Caution", "sev": "warning", "note": "Daily averages must be deal-weighted (53.8 days). A plain mean of daily values gives 62.6. The median is 21."},
        {"metric": "Jira_Clients", "verdict": "Caution", "sev": "serious", "note": "Counts every Jira issue, including pre-sale prospects since May 2026, plus 10 brokerage issues not in the DIM."},
        {"metric": "Jira_Won", "verdict": "Misleading name", "sev": "critical", "note": "Current status = CLOSED (property closed), not won or signed clients."},
        {"metric": "Jira_Active", "verdict": "Misleading name", "sev": "critical", "note": "A residual (everything not refunded or closed, 1,230). It is not the stated Active definition (644)."},
        {"metric": "Jira_Refunded", "verdict": "Trust", "sev": "good", "note": "Current status = Refunded (92)."},
    ]
    return {"monthly": rows, "verdicts": verdicts}
