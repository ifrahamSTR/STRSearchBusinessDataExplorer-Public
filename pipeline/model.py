"""Clean record tables built from the reporting-layer views, at their own grains.

    deals        pipedrive_reporting_base   one row per STR Search Pipedrive deal (any outcome)
    jira         jira_reporting_base        one row per Jira issue (clients and, since 27 May 2026, prospects)
    engagements  won_clients_master + client_cash_forecast   one row per won Pipedrive deal

Nothing here re-derives a business rule that the views already carry: flags, start dates and milestone dates
come from the views (quality.py re-checks them). The only additions are labels (start rule, status group),
completed-vs-scheduled closings relative to the data date, and the data-quality masks in definitions.py.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import definitions as D


# ----------------------------------------------------------------------------- helpers
def day(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce").dt.normalize()


def text(s: pd.Series) -> pd.Series:
    out = s.astype("string").str.strip()
    return out.mask(out.isin(["", "nan", "None", "<NA>", "NaN"]))


def flag(s: pd.Series) -> pd.Series:
    """0/1 flag -> nullable boolean (missing stays missing)."""
    v = pd.to_numeric(s, errors="coerce")
    return v.map(lambda x: pd.NA if pd.isna(x) else bool(int(x))).astype("boolean")


def experience(s: pd.Series) -> pd.Series:
    t = text(s).fillna("")
    return pd.Series(np.where(t.str.startswith("New Client Experience"), "New Client Experience",
                              np.where(t.str.contains("Legacy"), "Legacy", None)), index=s.index, dtype="object")


def capital_band(v: pd.Series) -> pd.Series:
    def one(x):
        if pd.isna(x) or x <= 0:
            return None
        for lo, hi, lab in D.CAPITAL_BANDS:
            if lo <= x < hi:
                return lab
        return None
    return pd.to_numeric(v, errors="coerce").map(one)


def channel(utm_source: pd.Series) -> pd.Series:
    t = text(utm_source)
    low = t.str.lower()
    out = low.map(lambda x: None if pd.isna(x) or x in ("data absent",) else D.CHANNEL_FIXES.get(x, None))
    # keep any other non-empty label as typed (marketing labels, not personal data), title-cased for display
    other = t.where(out.isna() & low.notna() & (low != "data absent"))
    return out.fillna(other.str.replace("-", " ").str.title())


def lender_category(s: pd.Series) -> pd.Series:
    t = text(s).fillna("")
    return pd.Series(np.select(
        [t.str.startswith("Preferred Lender"), t.str.contains("Cash Purchase"), t.str.startswith("Other Lender"), t == ""],
        ["Preferred lender", "Cash purchase", "Other lender", None], None), index=s.index, dtype="object")


def designer_category(s: pd.Series) -> pd.Series:
    t = text(s).fillna("")
    return pd.Series(np.select(
        [t.str.contains("STR Cribs"), t.str.contains("Turnkey"), t.str.startswith("Other Designer"), t == ""],
        ["STR Cribs", "Bought turnkey", "Other designer", None], None), index=s.index, dtype="object")


# ----------------------------------------------------------------------------- Jira issues
def build_jira(raw: pd.DataFrame, asof: pd.Timestamp) -> pd.DataFrame:
    j = raw
    out = pd.DataFrame(index=j.index)
    out["key"] = text(j["key"]).str.upper()
    out["created"] = day(j["issue_created_date"])
    out["due"] = day(j["issue_due_date"])
    out["start"] = day(j["client_start_date"])
    rule_date = pd.Timestamp(D.START_RULE_DATE)
    out["start_rule"] = np.where(out["start"].isna(), None,
                                 np.where(out["created"] >= rule_date, "won", np.where(out["due"].notna(), "due", "created+4")))
    out["status"] = text(j["issue_status"])
    out["group"] = out["status"].map(lambda s: D.STATUS_META.get(s, {}).get("group", "Other"))
    out["signed"] = flag(j["signed_up_client"]).fillna(False).astype(bool)
    out["active"] = flag(j["active_clients"]).fillna(False).astype(bool)
    out["inactive"] = flag(j["inactive_clients"]).fillna(False).astype(bool)
    out["hunting"] = flag(j["hunting_clients"]).fillna(False).astype(bool)
    out["refunded"] = flag(j["client_refunded"]).fillna(False).astype(bool)
    out["refund_date"] = day(j["client_refunded_date"])
    out["uc"] = day(j["property_uc_date"])
    out["pi"] = day(j["property_passed_inspection_date"])
    out["closed_raw"] = day(j["property_closed_date"])
    out["closed_scheduled"] = out["closed_raw"] > asof
    out["closed"] = out["closed_raw"].where(~out["closed_scheduled"])          # completed closings only
    out["days_uc"] = (out["uc"] - out["start"]).dt.days
    out["days_pi"] = (out["pi"] - out["start"]).dt.days
    out["days_closed"] = (out["closed"] - out["start"]).dt.days
    out["henry"] = flag(j["henry_client"]).fillna(False).astype(bool)
    oop = pd.to_numeric(j["total_oop"], errors="coerce")
    out["oop_invalid"] = oop > D.OOP_VALID_MAX
    out["oop"] = oop.where(~out["oop_invalid"])                                 # private use only, never exported
    out["oop_known"] = out["oop"].notna()
    bud = pd.to_numeric(j["client_budget"], errors="coerce")
    out["budget_invalid"] = bud < D.BUDGET_VALID_MIN
    out["budget"] = bud.where(~out["budget_invalid"])                           # private use only
    out["purchase_price"] = pd.to_numeric(j["purchase_price"], errors="coerce") # private use only
    ds = pd.to_numeric(j["total_deals_sent"], errors="coerce")
    out["deals_sent_invalid"] = ds > D.DEALS_SENT_VALID_MAX
    out["deals_sent"] = ds.where(~out["deals_sent_invalid"])
    out["deal_number_purchased"] = pd.to_numeric(j["deal_number_purchased"], errors="coerce")
    out["acq_lead"] = text(j["acq_lead"]).fillna("Unassigned")
    out["confidence_call"] = day(j["confidence_call_date"])
    out["agent_pref"] = flag(j["Pref_Agent_Used"]).fillna(False).astype(bool)
    out["agent_pref_adj"] = flag(j["Pref_Agent_Used_Adj"]).fillna(False).astype(bool)
    out["agent_not_pref"] = flag(j["Pref_Agent_Not_Used"]).fillna(False).astype(bool)
    out["lender_pref"] = flag(j["Pref_Lender_Used"]).fillna(False).astype(bool)
    out["lender_pref_adj"] = flag(j["Pref_Lender_Used_Adj"]).fillna(False).astype(bool)
    out["lender_not_pref"] = flag(j["Pref_Lender_Not_Used"]).fillna(False).astype(bool)
    out["cribs"] = flag(j["Cribs_Used"]).fillna(False).astype(bool)
    out["cribs_adj"] = flag(j["Cribs_Used_Adj"]).fillna(False).astype(bool)
    out["cribs_not"] = flag(j["Cribs_Not_Used"]).fillna(False).astype(bool)
    out["lender_cat"] = lender_category(j["lender_used"])
    out["designer_cat"] = designer_category(j["designer_used"])
    # Pipedrive deal as joined inside jira_reporting_base (pd_deal_id parsed from the deal URL)
    out["deal_id"] = pd.to_numeric(j["pd_deal_id"], errors="coerce").astype("Int64")
    out["pd_found"] = pd.to_numeric(j["deal_id"], errors="coerce").notna()
    won = flag(j["won"]); lost = flag(j["lost"])
    out["pd_status"] = np.where(out["deal_id"].isna(), "No deal link",
                                np.where(~out["pd_found"], "Deal not in base",
                                         np.where(won.fillna(False), "won", np.where(lost.fillna(False), "lost", "open"))))
    out["pd_won_date"] = day(j["won_date"])
    out["pd_created"] = day(j["deal_created_date"])
    out["pd_stage"] = text(j["stage_name"])
    out["pd_product"] = text(j["search_product_sold"])
    out["pd_value"] = pd.to_numeric(j["deal_value"], errors="coerce")
    out["pd_payment_recorded"] = text(j["payment_type"])      # the raw field: blank unless recorded
    out["pd_experience"] = experience(j["deal_experience"])
    out["pd_rep"] = text(j["sales_rep_name"])
    out["pd_lost_reason"] = text(j["lost_reason"])
    out["class"] = np.where(out["signed"], "Signed client",
                            np.where(out["status"].isin(D.DECLINED_STATUSES), "Services declined",
                                     np.where(out["status"].isin(D.PRESALE_STATUSES), "Pre-sale", "Other")))
    return out.reset_index(drop=True)


# ----------------------------------------------------------------------------- Pipedrive deals
def build_deals(raw: pd.DataFrame, jira: pd.DataFrame) -> pd.DataFrame:
    d = raw
    out = pd.DataFrame(index=d.index)
    out["id"] = pd.to_numeric(d["deal_id"], errors="coerce").astype(int)
    out["created"] = day(d["deal_created_date"])
    out["won_date"] = day(d["won_time"])                          # won_time::date, as in won_clients_master
    out["lost_date"] = day(d["lost_date"])
    lost = flag(d["lost"]).fillna(False).astype(bool)
    out["status"] = np.where(out["won_date"].notna(), "won", np.where(lost, "lost", "open"))
    out["stage"] = text(d["stage_name"])
    out["lost_reason"] = text(d["lost_reason"])
    out["lost_sub_reason"] = text(d["lost_sub_reason"])
    out["value"] = pd.to_numeric(d["deal_value"], errors="coerce")
    out["product"] = text(d["search_product_sold"])
    out["payment"] = text(d["payment_type"])                    # as carried by the base (blank shows as Split Pay)
    out["experience"] = experience(d["deal_experience"])
    out["rep"] = text(d["sales_rep_name"])
    out["setter"] = text(d["setter"])
    out["channel"] = channel(d["utm_source"])
    for c in ["call_booked", "no_show", "pd_qualified", "services_engaged", "onboarding_scheduled", "onboarding_completed",
              "contract_in_process", "conversion_exclusion", "offline_won_deal", "repeat_client", "potential_deals",
              "qualified_open_deal", "setter_booked_call", "loss_reason_excl"]:
        out[c] = flag(d[c]).fillna(False).astype(bool)
    out["keep"] = d["keep"].astype(bool)
    out["capital_band"] = capital_band(d["deal_capital_min"])
    out["capital_min"] = pd.to_numeric(d["deal_capital_min"], errors="coerce")      # private use only
    out["in_scope"] = out["keep"] & ~out["lost_reason"].isin(D.EXCLUDED_LOST_REASONS)
    out["excl_reason"] = np.where(out["lost_reason"].isin(D.EXCLUDED_LOST_REASONS), "Lost reason Test Lead / Duplicate",
                                  np.where(~out["keep"], "keep = false (duplicate)", None))
    # Jira link: the reporting layer's key (Jira pd_deal_id -> deal_id), unique matches only
    jk = jira.dropna(subset=["deal_id"])
    counts = jk["deal_id"].value_counts()
    uniq = jk[jk["deal_id"].map(counts) == 1].set_index(jk[jk["deal_id"].map(counts) == 1]["deal_id"].astype(int))["key"]
    out["jira_key"] = out["id"].map(uniq)
    out["jira_links"] = out["id"].map(counts).fillna(0).astype(int)
    out["has_jira"] = out["jira_key"].notna()
    out["jira_key_pd"] = text(d["jira_issue_id"]).str.upper()   # Jira key typed into Pipedrive (for the mismatch check)
    rec = jira.dropna(subset=["deal_id"]).drop_duplicates("deal_id").set_index(jira.dropna(subset=["deal_id"]).drop_duplicates("deal_id")["deal_id"].astype(int))["pd_payment_recorded"]
    out["payment_recorded"] = out["id"].map(rec)
    out["days_to_win"] = (out["won_date"] - out["created"]).dt.days
    return out.reset_index(drop=True)


# ----------------------------------------------------------------------------- won engagements
CASH_COLS = ["payment_type_normalized", "assumed_initial_cash_collected", "second_installment_amount",
             "assumed_second_cash_collected", "outstanding_cash_balance", "has_outstanding_balance",
             "assumed_total_cash_collected", "initial_collection_month", "second_collection_month",
             "has_payment_anomaly", "refund_excluded_assumed_cash_collected", "refund_excluded_outstanding_cash_balance"]


def build_engagements(master: pd.DataFrame, cash: pd.DataFrame, jira: pd.DataFrame, deals: pd.DataFrame,
                      asof: pd.Timestamp) -> pd.DataFrame:
    m = master.merge(cash[["deal_id"] + CASH_COLS], on="deal_id", how="left", validate="one_to_one")
    out = pd.DataFrame(index=m.index)
    out["id"] = pd.to_numeric(m["deal_id"], errors="coerce").astype(int)
    out["jira_key"] = text(m["jira_issue_key"]).str.upper()
    out["has_jira"] = m["has_jira_match"].astype(int) == 1
    out["jira_match_count"] = m["jira_match_count"].astype(int)
    out["key_mismatch"] = m["jira_key_mismatch"].astype(int) == 1
    out["anomaly"] = m["has_data_anomaly"].astype(int) == 1
    out["dupe_check"] = m["dupe_check"].astype(int)
    out["deal_created"] = day(m["deal_created_date"])
    out["won_date"] = day(m["won_date"])
    out["start"] = day(m["client_start_date"])
    out["start_source"] = text(m["client_start_date_source"])
    out["confirmed_start"] = out["start_source"].eq("JIRA") & out["start"].notna()
    jj = jira.set_index("key")
    pick = lambda col: out["jira_key"].map(jj[col]) if col in jj else None  # noqa: E731
    out["start_rule"] = pick("start_rule").where(out["confirmed_start"])
    out["status"] = text(m["issue_status"])
    out["group"] = out["status"].map(lambda s: D.STATUS_META.get(s, {}).get("group") if isinstance(s, str) else None)
    for c, src in [("signed", "signed_up_client"), ("active", "active_clients"), ("inactive", "inactive_clients"),
                   ("hunting", "hunting_clients"), ("refunded", "client_refunded"), ("henry", "henry_client")]:
        out[c] = flag(m[src])                                                    # missing Jira -> <NA>
    out["refund_date"] = day(m["client_refunded_date"])
    out["uc"] = day(m["property_uc_date"])
    out["pi"] = day(m["property_passed_inspection_date"])
    out["closed_raw"] = day(m["property_closed_date"])
    out["closed_scheduled"] = out["closed_raw"] > asof
    out["closed"] = out["closed_raw"].where(~out["closed_scheduled"])
    out["days_to_uc"] = pd.to_numeric(m["days_to_uc"], errors="coerce")
    out["days_to_close"] = (out["closed"] - out["start"]).dt.days               # completed closings only
    out["days_uc_to_close"] = (out["closed"] - out["uc"]).dt.days
    out["product"] = text(m["search_product_sold"])
    out["value"] = pd.to_numeric(m["deal_value"], errors="coerce")
    out["payment"] = text(m["payment_type"])
    dp = deals.set_index("id")
    out["payment_recorded"] = out["id"].map(dp["payment_recorded"])
    out["experience"] = experience(m["deal_experience"])
    out["repeat_client"] = flag(m["repeat_client"]).fillna(False).astype(bool)
    out["offline_won_deal"] = flag(m["offline_won_deal"]).fillna(False).astype(bool)
    out["conversion_exclusion"] = flag(m["conversion_exclusion"]).fillna(False).astype(bool)
    out["rep"] = text(m["sales_rep_name"])
    out["setter"] = text(m["setter"])
    out["acq_lead"] = text(m["acq_lead"])
    out["channel"] = out["id"].map(dp["channel"])
    out["capital_band"] = out["id"].map(dp["capital_band"])
    out["oop_known"] = out["jira_key"].map(jj["oop_known"]).fillna(False).astype(bool)
    out["deals_sent"] = out["jira_key"].map(jj["deals_sent"])
    out["deal_number_purchased"] = out["jira_key"].map(jj["deal_number_purchased"])
    out["agent_pref"] = out["jira_key"].map(jj["agent_pref"])
    out["lender_pref"] = out["jira_key"].map(jj["lender_pref"])
    out["cribs"] = out["jira_key"].map(jj["cribs"])
    for c in CASH_COLS:
        out["cash_" + c] = m[c]
    out["cash_initial_collection_month"] = day(m["initial_collection_month"])
    out["cash_second_collection_month"] = day(m["second_collection_month"])
    # the view counts a split-pay second installment as collected whenever a closing date exists, even a future one
    out["cash_second_on_scheduled_close"] = (out["cash_payment_type_normalized"] == "Split Pay") & out["closed_scheduled"]
    out["anomaly_dup_jira"] = out["jira_match_count"] > 1
    out["anomaly_uc_before_start"] = out["uc"] < out["start"]
    out["anomaly_close_before_uc"] = out["closed_raw"] < out["uc"]
    out["anomaly_hunting_with_uc"] = out["hunting"].fillna(False).astype(bool) & out["uc"].notna()
    return out.reset_index(drop=True)
