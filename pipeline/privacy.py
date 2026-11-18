"""What leaves the pipeline, and how it is pseudonymised for the public site.

Only the columns listed in EXPORT are written, so a new column in the source can never leak by accident.
Never exported at record level: names, e-mails, phone numbers, addresses, URLs, listing links, free text,
purchase prices, exact budgets, out-of-pocket capital and exact capital amounts (only coarse bands leave the pipeline:
Pipedrive capital bands, the official HENRY flag, and since 18 Nov 2026 the onboarding-form capital range the client
selected, read at its upper end, and the form's offer-experience band). Clients are pseudonymous ids (C0001 for won
deals, JC0001 for Jira) derived from e-mails inside the pipeline; no e-mail or hash leaves it. --anonymize additionally replaces Jira keys, Pipedrive deal IDs and
staff names with stable pseudonyms (J0001, D0001, Rep 01, Setter 01, Lead 01).
"""
from __future__ import annotations

import pandas as pd

EXPORT = {
    "deals": {
        "cols": ["id", "created", "won_date", "lost_date", "status", "stage", "lost_reason", "lost_sub_reason", "value",
                 "product", "payment", "payment_recorded", "experience", "rep", "setter", "channel", "capital_band",
                 "call_booked", "no_show", "pd_qualified", "services_engaged", "onboarding_scheduled", "onboarding_completed",
                 "contract_in_process", "conversion_exclusion", "offline_won_deal", "repeat_client", "keep", "in_scope",
                 "excl_reason", "jira_key", "has_jira", "days_to_win",
                 "client", "search_no", "search_kind", "budget_band", "budget_cmp", "budget_strict", "offers", "audit"],
        "dates": ["created", "won_date", "lost_date"],
    },
    "jira": {
        "cols": ["key", "created", "due", "start", "start_rule", "status", "group", "class", "signed", "active", "inactive",
                 "hunting", "refunded", "refund_date", "uc", "pi", "closed", "closed_raw", "closed_scheduled", "days_uc",
                 "days_pi", "days_closed", "henry", "oop_known", "deals_sent", "deals_sent_invalid", "deal_number_purchased",
                 "acq_lead", "confidence_call", "agent_pref", "agent_pref_adj", "lender_pref", "lender_pref_adj", "cribs",
                 "cribs_adj", "lender_cat", "designer_cat", "deal_id", "pd_found", "pd_status", "pd_won_date", "pd_created",
                 "pd_stage", "pd_product", "pd_value", "pd_payment_recorded", "pd_experience", "pd_rep", "pd_lost_reason",
                 "stage", "fallout", "client", "purchase_no", "client_searches", "client_purchases", "cribs_tracker",
                 "budget_band", "budget_upper", "budget_open", "budget_cmp", "budget_strict", "offers"],
        "dates": ["created", "due", "start", "refund_date", "uc", "pi", "closed", "closed_raw", "confidence_call",
                  "pd_won_date", "pd_created"],
    },
    "engagements": {
        "cols": ["id", "jira_key", "has_jira", "jira_match_count", "key_mismatch", "anomaly", "anomaly_uc_before_start",
                 "anomaly_close_before_uc", "anomaly_hunting_with_uc", "deal_created", "won_date", "start", "start_source",
                 "confirmed_start", "start_rule", "status", "group", "signed", "active", "inactive", "hunting", "refunded",
                 "henry", "refund_date", "uc", "pi", "closed", "closed_raw", "closed_scheduled", "days_to_uc", "days_to_close",
                 "days_uc_to_close", "product", "value", "payment", "payment_recorded", "experience", "repeat_client",
                 "offline_won_deal", "conversion_exclusion", "rep", "setter", "acq_lead", "channel", "capital_band",
                 "oop_known", "deals_sent", "deal_number_purchased", "agent_pref", "lender_pref", "cribs",
                 "cash_payment_type_normalized", "cash_assumed_initial_cash_collected", "cash_second_installment_amount",
                 "cash_assumed_second_cash_collected", "cash_outstanding_cash_balance", "cash_has_outstanding_balance",
                 "cash_assumed_total_cash_collected", "cash_initial_collection_month", "cash_second_collection_month",
                 "cash_has_payment_anomaly", "cash_refund_excluded_assumed_cash_collected",
                 "cash_refund_excluded_outstanding_cash_balance", "cash_second_on_scheduled_close",
                 "budget_band", "budget_upper", "budget_open", "budget_cmp", "budget_strict", "offers", "client", "client_deals",
                 "search_no", "search_kind", "audit", "audit_label", "cash_group", "stage", "fallout", "purchase_no", "cribs_tracker"],
        "dates": ["deal_created", "won_date", "start", "refund_date", "uc", "pi", "closed", "closed_raw",
                  "cash_initial_collection_month", "cash_second_collection_month"],
    },
}

NEVER = ["oop", "budget", "purchase_price", "cap_label", "pid", "email", "client_email", "capital_min", "jira_key_pd", "deal_name", "deal_url", "jira_url",
         "address_under_contract", "client_listing_url", "realtor_used", "lender_used", "confidence_call_host",
         "pd_deal_attribution", "utm_campaign", "utm_content"]


def _pseudo(prefix: str, values: pd.Series, width: int) -> dict:
    uniq = sorted({v for v in values.dropna().tolist()}, key=lambda x: str(x))
    return {v: f"{prefix}{i + 1:0{width}d}" for i, v in enumerate(uniq)}


def anonymize(tables: dict[str, pd.DataFrame]) -> None:
    deals, jira, eng = tables["deals"], tables["jira"], tables["engagements"]
    people = set()                                  # every raw staff name in the people columns, collected before pseudonymising
    for df, cols in ((deals, ("rep", "setter")), (jira, ("pd_rep", "acq_lead", "assignee")), (eng, ("rep", "setter", "acq_lead"))):
        for c in cols:
            if c in df.columns:
                people |= {str(v) for v in df[c].dropna().unique()}
    tables["__people__"] = pd.DataFrame({"name": sorted(people - {"Unassigned"})})
    kmap = _pseudo("J", pd.concat([jira["key"], eng["jira_key"], deals["jira_key"]]), 4)
    ids = pd.concat([deals["id"], eng["id"], jira["deal_id"].dropna().astype(int)]).astype(int)
    dmap = _pseudo("D", ids, 4)
    jira["key"] = jira["key"].map(kmap)
    eng["jira_key"] = eng["jira_key"].map(kmap)
    deals["jira_key"] = deals["jira_key"].map(kmap)
    deals["id"] = deals["id"].astype(int).map(dmap)
    eng["id"] = eng["id"].astype(int).map(dmap)
    jira["deal_id"] = jira["deal_id"].map(lambda x: dmap.get(int(x)) if pd.notna(x) else None)
    reps = _pseudo("Rep ", pd.concat([deals["rep"], jira["pd_rep"], eng["rep"]]), 2)
    for df, col in ((deals, "rep"), (jira, "pd_rep"), (eng, "rep")):
        df[col] = df[col].map(reps)
    setters = _pseudo("Setter ", pd.concat([deals["setter"], eng["setter"]]), 2)
    for df in (deals, eng):
        df["setter"] = df["setter"].map(setters)
    leads = _pseudo("Lead ", pd.concat([jira["acq_lead"], eng["acq_lead"]]).replace("Unassigned", pd.NA), 2)
    leads["Unassigned"] = "Unassigned"
    for df in (jira, eng):
        for col in ("acq_lead", "assignee"):          # `assignee` is the same person as `acq_lead` under its Jira name: same pseudonym
            if col in df.columns:
                df[col] = df[col].map(lambda v: leads.get(v, v) if pd.notna(v) else v)


def assert_no_staff_names(tables: dict[str, pd.DataFrame]) -> None:
    """Refuse to write a public table in which a raw staff name (collected by anonymize) still appears in any cell."""
    people = tables.pop("__people__", None)
    if people is None or people.empty:
        return
    raw = {n for n in people["name"] if len(n) > 3 and " " in n}      # full names; single first names are too generic to scan for
    for name, df in tables.items():
        for c in df.columns:
            if df[c].dtype == object:
                hit = set(df[c].dropna().astype(str)) & raw
                if hit:
                    raise SystemExit(f"Refusing to export {name}.{c}: staff names left in the public data ({sorted(hit)[:3]})")


def assert_clean(tables: dict[str, pd.DataFrame]) -> None:
    """Refuse to write a table carrying a never-export column or an e-mail-like / URL-like value."""
    for name, df in tables.items():
        bad = [c for c in df.columns if c in NEVER]
        if bad:
            raise SystemExit(f"Refusing to export {name}: private columns {bad}")
        for c in df.columns:
            if df[c].dtype == object:
                s = df[c].dropna().astype(str)
                if s.str.contains(r"@|https?://|www\.", regex=True).any():
                    raise SystemExit(f"Refusing to export {name}.{c}: e-mail or URL-like values")
