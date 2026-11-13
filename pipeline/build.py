#!/usr/bin/env python3
"""Build the STRSearch Business Data Explorer dataset.

    python pipeline/build.py                       # uses the default reports folder
    python pipeline/build.py --reports "<.../Reporting Tables>" [--anonymize] [--cache]

Reads the reporting workbooks (read-only), applies the business definitions in definitions.py,
runs data-quality checks and an independent metric cross-check, and writes
docs/data/explorer-data.js  (window.EXPLORER_DATA = {...}).

Privacy: the output holds no customer names, emails, phone numbers, street addresses, purchase
prices or free text. Record handles are Jira keys and Pipedrive deal IDs (internal identifiers);
--anonymize replaces them (and staff names) with stable pseudonyms for any wider sharing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import definitions as D  # noqa: E402
import metrics as M  # noqa: E402
import quality as Q  # noqa: E402

warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")
pd.set_option("future.no_silent_downcasting", True)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORTS = ROOT.parent / "12 Nov 26 Reports" / "DataDrive" / "Reporting Tables"
OUT_JS = ROOT / "docs" / "data" / "explorer-data.js"
NY = "America/New_York"

SOURCES = {
    "jira": ("DIM - JIRA Client Data.xlsx", "JIRA_Clients"),
    "deals": ("DIM - Pipedrive_API.xlsx", "Pipedrive_Deals"),
    "stages": ("DIM - Pipedrive_API.xlsx", "Pipedrive_Stages"),
    "daily": ("FCT - Daily_Reporting_STR_Search.xlsx", "Sales_Funnel"),
}


# ----------------------------------------------------------------------------- loading
def load_sources(reports: Path, use_cache: bool) -> tuple[dict[str, pd.DataFrame], list[dict]]:
    cache_dir = ROOT / ".cache"
    frames, meta = {}, []
    by_file: dict[str, list[tuple[str, str]]] = {}
    for key, (fname, sheet) in SOURCES.items():
        by_file.setdefault(fname, []).append((key, sheet))
    for fname, items in by_file.items():
        path = reports / fname
        if not path.exists():
            raise SystemExit(f"Missing source workbook: {path}")
        stamp = hashlib.md5(f"{path}:{path.stat().st_mtime}:{path.stat().st_size}".encode()).hexdigest()[:10]
        loaded = {}
        cached = {k: cache_dir / f"{k}-{stamp}.pkl" for k, _ in items}
        if use_cache and all(p.exists() for p in cached.values()):
            loaded = {k: pd.read_pickle(p) for k, p in cached.items()}
        else:
            t = time.time()
            sheets = pd.read_excel(path, sheet_name=[s for _, s in items])
            loaded = {k: sheets[s] for k, s in items}
            print(f"  read {fname} [{', '.join(s for _, s in items)}] in {time.time() - t:.1f}s")
            if use_cache:
                cache_dir.mkdir(exist_ok=True)
                for k, df in loaded.items():
                    df.to_pickle(cached[k])
        for k, sheet in items:
            df = loaded[k]
            frames[k] = df
            snap = None
            if "date_last_run" in df.columns:
                snap = pd.to_datetime(df["date_last_run"], errors="coerce").max()
            meta.append({
                "key": k, "file": fname, "sheet": sheet, "rows": int(len(df)), "columns": int(df.shape[1]),
                "file_modified": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
                "snapshot": snap.strftime("%Y-%m-%d %H:%M") if snap is not None and not pd.isna(snap) else None,
            })
    return frames, meta


# ----------------------------------------------------------------------------- helpers
def ny_date(s: pd.Series) -> pd.Series:
    """Timestamps with offsets / 'Z' -> America/New_York calendar date (datetime64, midnight)."""
    ts = pd.to_datetime(s, errors="coerce", utc=True, format="mixed")
    return ts.dt.tz_convert(NY).dt.tz_localize(None).dt.normalize()


def naive_date(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce").dt.normalize()


def iso(s: pd.Series) -> list:
    return [None if pd.isna(v) else v.strftime("%Y-%m-%d") for v in s]


def flag01(s: pd.Series) -> pd.Series:
    """Decode 0/1 flags that were exported with Excel date formatting.
    datetime.time(0,0) == 0 and datetime(1900,1,1) == 1 (serial 1)."""
    import datetime as _dt

    def one(v):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return 0
        if isinstance(v, _dt.datetime):
            return 1 if (v.year, v.month, v.day) == (1900, 1, 1) else 0
        if isinstance(v, _dt.time):
            return 0
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0
    return s.map(one).astype(int)


def clean_str(s: pd.Series) -> pd.Series:
    out = s.astype("string").str.strip()
    return out.mask(out.isin(["", "nan", "None", "<NA>"]))


def decode_option(s: pd.Series, mapping: dict) -> pd.Series:
    def one(v):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return None
        code = str(v).strip().strip("[]").split(",")[0].strip()
        if not code:
            return None
        hit = mapping.get(code)
        return hit["label"] if hit else f"Option {code}"
    return s.map(one)


def email_hash(s: pd.Series) -> pd.Series:
    return s.astype("string").str.strip().str.lower().map(
        lambda e: None if pd.isna(e) or not e else hashlib.sha256(e.encode()).hexdigest())


# ----------------------------------------------------------------------------- deals
def build_deals(raw: pd.DataFrame, stages: pd.DataFrame, jira_keys: set[str]) -> pd.DataFrame:
    d = raw[raw["pipeline_id"] == D.STR_SEARCH_PIPELINE_ID].copy()
    out = pd.DataFrame(index=d.index)
    out["id"] = d["Deal_ID"].astype(int)
    out["created"] = ny_date(d["Deal_Created_At_EST"])
    out["won_date"] = ny_date(d["Won time"])
    out["lost_date"] = ny_date(d["Lost time"])
    won_flag = pd.to_numeric(d["won"], errors="coerce").fillna(0).astype(int)
    lost_flag = pd.to_numeric(d["lost"], errors="coerce").fillna(0).astype(int)
    out["status"] = np.where(out["won_date"].notna(), "won", np.where(lost_flag == 1, "lost", "open"))
    out["won_flag_mismatch"] = (won_flag == 1) != out["won_date"].notna()
    st = stages[stages["pipeline_id"] == D.STR_SEARCH_PIPELINE_ID].set_index("name")["order_nr"]
    out["stage"] = clean_str(d["stage_name"])
    out["stage_order"] = out["stage"].map(st)
    out["lost_reason"] = clean_str(d["Lost reason"])
    out["value"] = pd.to_numeric(d["Deal_Value"], errors="coerce")
    out["product"] = decode_option(d["Search Product Sold"], D.SEARCH_PRODUCT_OPTIONS)
    out["payment"] = decode_option(d["Payment Type"], D.PAYMENT_TYPE_OPTIONS)
    src = clean_str(d["PD_Source"]).replace(D.SOURCE_FIXES)
    out["source"] = src
    out["rep"] = clean_str(d["Sales_Rep_Name"])
    exp = clean_str(d["Deal Experience"])
    out["experience"] = np.where(exp.fillna("").str.startswith("New Client Experience"), "New Client Experience",
                                 np.where(exp.fillna("").str.contains("Legacy"), "Legacy", "Not tagged"))
    out["no_show"] = flag01(d["No_Show"])
    out["qualified_official"] = out["stage"].isin(D.OFFICIAL_QUALIFIED_STAGES)
    key = clean_str(d["JIRA Issue ID"]).str.upper()
    out["jira_key"] = key
    out["has_jira"] = key.isin(jira_keys)
    out["days_to_win"] = (out["won_date"] - out["created"]).dt.days

    # Official PD_Deals filter (FCT Daily Reporting definitions)
    email = clean_str(d["pd_primary_email"]).str.lower()
    internal = email.fillna("").apply(lambda e: any(dom in e for dom in D.INTERNAL_EMAIL_DOMAINS))
    keep = pd.to_numeric(d["Keep"], errors="coerce").fillna(1).astype(int)
    reason = pd.Series(None, index=d.index, dtype="object")
    reason[out["lost_reason"].isin(D.EXCLUDED_LOST_REASONS)] = "Lost reason Test Lead / Duplicate"
    reason[reason.isna() & (keep == 0)] = "Duplicate (Keep = 0)"
    reason[reason.isna() & internal] = "Internal email domain"
    out["excl_reason"] = reason
    out["in_scope"] = reason.isna()

    # Repeat people (same email on more than one in-scope deal); the hash itself is never exported.
    h = email_hash(d["pd_primary_email"])
    counts = h[out["in_scope"]].value_counts()
    out["repeat_person"] = h.map(counts).fillna(0).astype(int) > 1
    out["_email_hash"] = h
    return out.reset_index(drop=True)


# ----------------------------------------------------------------------------- jira
def build_jira(raw: pd.DataFrame, deals_all: pd.DataFrame) -> pd.DataFrame:
    j = raw.copy()
    out = pd.DataFrame(index=j.index)
    out["key"] = clean_str(j["key"]).str.upper()
    out["created"] = ny_date(j["issue_created_date"])
    out["due"] = naive_date(j["issue_due_date"])
    out["start"] = out["due"].fillna(out["created"])          # Carson: COALESCE(due, created)
    out["start_src"] = np.where(out["due"].notna(), "due", "created")
    status = clean_str(j["Issue_Status"])
    out["status"] = status
    out["group"] = status.map(lambda s: D.STATUS_META.get(s, {}).get("group", "Other"))
    out["carson_signed"] = status.isin(D.SIGNED_UP_STATUSES)
    out["carson_active"] = status.isin(D.ACTIVE_STATUSES)
    out["carson_inactive"] = status.isin(D.INACTIVE_STATUSES)
    out["carson_class"] = np.where(out["carson_active"], "Active", np.where(out["carson_inactive"], "Inactive", "Not in Carson's lists"))
    out["uc"] = naive_date(j["first_under_contract_date"])
    out["pi"] = naive_date(j["first_passed_inspection_date"])
    out["closed"] = naive_date(j["first_closed_date"])
    out["latest_uc"] = naive_date(j["latest_under_contract_date"])
    out["latest_closed"] = naive_date(j["latest_closed_date"])
    out["uc_count"] = pd.to_numeric(j["under_contract_count"], errors="coerce")
    out["closed_count"] = pd.to_numeric(j["closed_count"], errors="coerce")
    out["pi_count"] = pd.to_numeric(j["passed_inspection_count"], errors="coerce")
    out["fell_out"] = clean_str(j["Address_Fell_Out_Of_Contract"]).notna()
    out["won_jira"] = naive_date(j["Client_Won_Date"])
    out["latest_status_date"] = naive_date(j["latest_status_date"])
    out["has_history"] = clean_str(j["latest_status"]).notna()
    out["assignee"] = clean_str(j["Assignee_Name"]).fillna("Unassigned")
    out["deals_sent"] = pd.to_numeric(j["Total_Deals_Sent"], errors="coerce")
    out["state"] = clean_str(j["State"]).str.upper().where(lambda s: s.str.len() == 2)
    exp = clean_str(j["PD_Deal_Experience"]).fillna("")
    out["jira_experience"] = np.where(exp.str.startswith("New Client Experience"), "New Client Experience",
                                      np.where(exp.str.contains("Legacy"), "Legacy", "Not tagged"))
    out["days_uc"] = (out["uc"] - out["start"]).dt.days
    out["days_pi"] = (out["pi"] - out["start"]).dt.days
    out["days_closed"] = (out["closed"] - out["start"]).dt.days
    out["etl_days_uc"] = pd.to_numeric(j["days_to_under_contract"], errors="coerce")
    out["etl_days_closed"] = pd.to_numeric(j["days_to_closed"], errors="coerce")

    # Linked Pipedrive deal (Jira PD_Deal_ID -> Deal_ID, any pipeline)
    out["deal_id"] = pd.to_numeric(j["PD_Deal_ID"], errors="coerce").astype("Int64")
    dd = deals_all.set_index("id")
    linked = out["deal_id"].map(lambda x: x if (pd.notna(x) and int(x) in dd.index) else None)
    out["deal_found"] = linked.notna()
    def pick(col):
        return out["deal_id"].map(lambda x: dd.at[int(x), col] if pd.notna(x) and int(x) in dd.index else None)
    out["pd_status"] = np.where(out["deal_id"].isna(), "No deal ID", np.where(out["deal_found"], pick("status"), "Deal not in extract"))
    out["pd_pipeline"] = pick("pipeline")
    out["pd_won_date"] = pd.to_datetime(pick("won_date"))
    out["pd_created"] = pd.to_datetime(pick("created"))
    out["pd_product"] = pick("product")
    out["pd_payment"] = pick("payment")
    out["pd_source"] = pick("source")
    out["pd_rep"] = pick("rep")
    out["pd_experience"] = pick("experience")
    out["pd_value"] = pd.to_numeric(pick("value"), errors="coerce")
    out["pd_stage"] = pick("stage")
    out["_email_hash"] = email_hash(j["Client_Email"])
    return out.reset_index(drop=True)


def build_deals_all(raw: pd.DataFrame) -> pd.DataFrame:
    """Minimal frame of every deal (all pipelines) for Jira link look-ups."""
    out = pd.DataFrame({
        "id": raw["Deal_ID"].astype(int),
        "pipeline": raw["pipeline_id"].astype(int),
        "created": ny_date(raw["Deal_Created_At_EST"]),
        "won_date": ny_date(raw["Won time"]),
        "stage": clean_str(raw["stage_name"]),
        "value": pd.to_numeric(raw["Deal_Value"], errors="coerce"),
        "product": decode_option(raw["Search Product Sold"], D.SEARCH_PRODUCT_OPTIONS),
        "payment": decode_option(raw["Payment Type"], D.PAYMENT_TYPE_OPTIONS),
        "source": clean_str(raw["PD_Source"]).replace(D.SOURCE_FIXES),
        "rep": clean_str(raw["Sales_Rep_Name"]),
    })
    exp = clean_str(raw["Deal Experience"]).fillna("")
    out["experience"] = np.where(exp.str.startswith("New Client Experience"), "New Client Experience",
                                 np.where(exp.str.contains("Legacy"), "Legacy", "Not tagged"))
    lost = pd.to_numeric(raw["lost"], errors="coerce").fillna(0).astype(int)
    out["status"] = np.where(out["won_date"].notna(), "won", np.where(lost == 1, "lost", "open"))
    return out


# ----------------------------------------------------------------------------- output
def columnar(df: pd.DataFrame, cols: list[str], date_cols: list[str]) -> dict:
    rows = []
    sub = df[cols]
    conv = {}
    for c in cols:
        if c in date_cols:
            conv[c] = iso(sub[c])
        else:
            col = sub[c]
            vals = []
            for v in col.tolist():
                if v is None or (isinstance(v, float) and np.isnan(v)) or v is pd.NA or (isinstance(v, pd.Timestamp) and pd.isna(v)):
                    vals.append(None)
                elif isinstance(v, (np.bool_, bool)):
                    vals.append(bool(v))
                elif isinstance(v, (np.integer,)):
                    vals.append(int(v))
                elif isinstance(v, (np.floating, float)):
                    vals.append(int(v) if float(v).is_integer() else round(float(v), 4))
                else:
                    vals.append(v)
            conv[c] = vals
    for i in range(len(sub)):
        rows.append([conv[c][i] for c in cols])
    return {"columns": cols, "date_columns": [c for c in cols if c in date_cols], "rows": rows}


def anonymize(deals: pd.DataFrame, jira: pd.DataFrame) -> None:
    def pseudo(prefix, values):
        uniq = sorted(v for v in pd.unique(values.dropna()))
        return {v: f"{prefix}{i + 1:04d}" for i, v in enumerate(uniq)}
    kmap = pseudo("J", jira["key"])
    dmap = pseudo("D", pd.concat([deals["id"], jira["deal_id"].astype("float").dropna().astype(int)]))
    jira["key"] = jira["key"].map(kmap)
    deals["jira_key"] = deals["jira_key"].map(kmap)
    deals["id"] = deals["id"].map(dmap)
    jira["deal_id"] = jira["deal_id"].map(lambda x: dmap.get(int(x)) if pd.notna(x) else None)
    reps = pseudo("Rep ", pd.concat([deals["rep"], jira["pd_rep"]]))
    deals["rep"] = deals["rep"].map(reps)
    jira["pd_rep"] = jira["pd_rep"].map(reps)
    assignees = pseudo("Assignee ", jira["assignee"])
    jira["assignee"] = jira["assignee"].map(assignees)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reports", type=Path, default=DEFAULT_REPORTS, help="Folder holding the reporting workbooks")
    ap.add_argument("--out", type=Path, default=OUT_JS)
    ap.add_argument("--anonymize", action="store_true", help="Pseudonymise record keys and staff names")
    ap.add_argument("--cache", action="store_true", help="Cache parsed sheets in .cache/ (faster rebuilds)")
    args = ap.parse_args()

    t0 = time.time()
    print(f"Reading reporting extracts from: {args.reports}")
    frames, src_meta = load_sources(args.reports, args.cache)

    jira_keys = set(clean_str(frames["jira"]["key"]).str.upper().dropna())
    deals_all = build_deals_all(frames["deals"])
    deals = build_deals(frames["deals"], frames["stages"], jira_keys)
    jira = build_jira(frames["jira"], deals_all)

    snap_jira = next(m["snapshot"] for m in src_meta if m["key"] == "jira")
    snap_pd = next(m["snapshot"] for m in src_meta if m["key"] == "deals")
    asof = min(pd.Timestamp(snap_jira), pd.Timestamp(snap_pd)).normalize()

    quality = Q.run_checks(deals, jira, frames, asof)
    recon = Q.reconcile_daily(frames["daily"], deals, jira, asof)
    expected = M.expected(deals, jira, asof)
    extras = M.extras(deals, jira, frames, asof)

    if args.anonymize:
        anonymize(deals, jira)
        for chk in quality:
            chk["keys"] = []

    deal_cols = ["id", "created", "won_date", "lost_date", "status", "stage", "stage_order", "lost_reason", "value",
                 "product", "payment", "source", "rep", "experience", "no_show", "qualified_official", "jira_key",
                 "has_jira", "in_scope", "excl_reason", "days_to_win", "repeat_person"]
    jira_cols = ["key", "created", "due", "start", "start_src", "status", "group", "carson_signed", "carson_active",
                 "carson_inactive", "carson_class", "uc", "pi", "closed", "latest_uc", "uc_count", "closed_count",
                 "pi_count", "fell_out", "won_jira", "latest_status_date", "has_history", "assignee", "deals_sent",
                 "state", "jira_experience", "days_uc", "days_pi", "days_closed", "deal_id", "deal_found", "pd_status",
                 "pd_pipeline", "pd_won_date", "pd_created", "pd_product", "pd_payment", "pd_source", "pd_rep",
                 "pd_experience", "pd_value", "pd_stage"]
    deal_dates = ["created", "won_date", "lost_date"]
    jira_dates = ["created", "due", "start", "uc", "pi", "closed", "latest_uc", "won_jira", "latest_status_date", "pd_won_date", "pd_created"]

    first_month = min(deals["created"].min(), jira["start"].min()).strftime("%Y-%m")
    payload = {
        "meta": {
            "title": "STRSearch Business Data Explorer",
            "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "asof": asof.strftime("%Y-%m-%d"),
            "snapshot_label": f"Pipedrive {snap_pd[:10]} · Jira {snap_jira[:10]}",
            "snapshots": {"pipedrive": snap_pd, "jira": snap_jira},
            "first_month": max(first_month, "2024-01"),
            "sources": src_meta,
            "anonymized": bool(args.anonymize),
            "reports_folder": args.reports.name if args.anonymize else str(args.reports.relative_to(ROOT.parent)) if str(args.reports).startswith(str(ROOT.parent)) else args.reports.name,
            "counts": {"deals_pipeline3": int(len(deals)), "deals_in_scope": int(deals["in_scope"].sum()), "jira": int(len(jira))},
        },
        "defs": {
            "carson": {"signed_up": D.SIGNED_UP_STATUSES, "inactive": D.INACTIVE_STATUSES, "active": D.ACTIVE_STATUSES,
                       "effective_start": D.EFFECTIVE_START_RULE},
            "status_meta": D.STATUS_META,
            "status_groups": [{"name": n, "desc": d} for n, d in D.STATUS_GROUPS],
            "stages": frames["stages"][frames["stages"]["pipeline_id"] == D.STR_SEARCH_PIPELINE_ID]
                .sort_values("order_nr")[["id", "name", "order_nr"]].rename(columns={"order_nr": "order"}).to_dict("records"),
            "qualified_stages": D.OFFICIAL_QUALIFIED_STAGES,
            "excluded_lost_reasons": D.EXCLUDED_LOST_REASONS,
            "internal_domains": D.INTERNAL_EMAIL_DOMAINS,
            "options": {"product": D.SEARCH_PRODUCT_OPTIONS, "payment": D.PAYMENT_TYPE_OPTIONS},
            "new_experience_date": D.NEW_EXPERIENCE_DATE,
        },
        "deals": columnar(deals, deal_cols, deal_dates),
        "jira": columnar(jira, jira_cols, jira_dates),
        "quality": quality,
        "recon": recon,
        "expected": expected,
        "extras": extras,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    js = "/* Generated by pipeline/build.py. Do not edit by hand. */\nwindow.EXPLORER_DATA = " + \
         json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=str) + ";\n"
    args.out.write_text(js, encoding="utf-8")
    print(f"Wrote {args.out.name} ({len(js) / 1e6:.2f} MB) in {time.time() - t0:.1f}s")
    print(f"  deals (pipeline 3): {len(deals)} | in scope: {int(deals['in_scope'].sum())} | Jira issues: {len(jira)}")
    print(f"  as-of date: {asof.date()} | quality checks: {len(quality)}")


if __name__ == "__main__":
    main()
