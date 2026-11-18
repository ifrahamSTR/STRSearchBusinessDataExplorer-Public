#!/usr/bin/env python3
"""Build the Business Data Explorer data file for the 16 Nov 2026 reporting version.

    python pipeline/build.py [--reports "<.../16 Nov UpdatedReports>"] [--anonymize] [--cache] [--out <file>]

Reads the reporting-layer export (read-only), rebuilds the two non-exported views from their SQL, reconciles
everything against the exported views and the SQL reference (stops on any mismatch), and writes
docs/2026-11-16/data/explorer-data.js (window.EXPLORER_DATA = {...}).

Versions: each reporting version lives in its own folder (docs/<version>/) and is described by
versions/<version>/version.json. A version marked "frozen" can never be overwritten by this script; the archived
12 Nov 2026 version is rebuilt only by its own frozen pipeline in versions/2026-11-12/pipeline/.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
pd.set_option("future.no_silent_downcasting", True)
import budget as BUD  # noqa: E402
import crosscheck  # noqa: E402
import definitions as D  # noqa: E402
import enrich  # noqa: E402
import foundation  # noqa: E402
import glossary  # noqa: E402
import privacy as P  # noqa: E402

ROOT = foundation.ROOT
OUT_JS = ROOT / "docs" / D.VERSION_ID / "data" / "explorer-data.js"


def iso(s: pd.Series) -> list:
    return [None if pd.isna(v) else pd.Timestamp(v).strftime("%Y-%m-%d") for v in s]


def plain(v):
    if v is None or v is pd.NA or (isinstance(v, float) and np.isnan(v)) or (isinstance(v, pd.Timestamp) and pd.isna(v)):
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return int(v) if float(v).is_integer() else round(float(v), 4)
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    return v


def columnar(df: pd.DataFrame, cols: list[str], dates: list[str]) -> dict:
    conv = {c: (iso(df[c]) if c in dates else [plain(v) for v in df[c].tolist()]) for c in cols}
    return {"columns": cols, "date_columns": [c for c in cols if c in dates],
            "rows": [[conv[c][i] for c in cols] for i in range(len(df))]}


def frozen_outputs() -> dict[str, str]:
    out = {}
    for vj in (ROOT / "versions").glob("*/version.json"):
        v = json.loads(vj.read_text())
        if v.get("frozen"):
            for rel in v.get("outputs", {}):
                out[str((ROOT / rel).resolve())] = v["id"]
    return out


def jsonable(obj):
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    return plain(obj)


COMPAT = {  # field names the Explorer front end already uses, mapped onto the reporting-layer fields
    "deals": {"source": "channel", "qualified_official": "pd_qualified", "repeat_person": "repeat_client"},
    "jira": {"start_src": "start_rule", "assignee": "acq_lead", "pd_payment": "pd_payment_recorded"},
}


def compat(tables: dict) -> None:
    for name, cols in COMPAT.items():
        for alias, src in cols.items():
            tables[name][alias] = tables[name][src]
    j, d = tables["jira"], tables["deals"].set_index("id")
    j["pd_source"] = j["deal_id"].map(lambda x: d["channel"].get(int(x)) if x is not None and x == x and int(x) in d.index else None)
    j["klass"] = ["Active" if a else "Inactive" if i else "Not signed" for a, i in zip(j["active"], j["inactive"])]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reports", type=Path, default=foundation.DEFAULT_REPORTS, help="Folder holding the reporting-layer export")
    ap.add_argument("--out", type=Path, default=OUT_JS)
    ap.add_argument("--anonymize", action="store_true", help="Pseudonymise record keys and staff names (public builds)")
    ap.add_argument("--cache", action="store_true", help="Cache parsed sheets in .cache/")
    args = ap.parse_args()

    out = args.out.resolve()
    locked = frozen_outputs()
    if str(out) in locked:
        raise SystemExit(f"Refusing to overwrite {out}: it belongs to the frozen {locked[str(out)]} version.")

    t0 = time.time()
    print(f"Reading the reporting-layer export from: {args.reports}")
    f = foundation.load(args.reports, args.cache)
    if f.recon_failures:
        for r in f.recon_failures:
            print(f"  RECONCILIATION FAILED: {r['check']}: got {r['got']} want {r['want']}")
        raise SystemExit(1)

    # enrichment shared with the Executive Report (onboarding budget, clients, audit, cash groups, fall-through, Cribs)
    enr = enrich.build(f)
    bud = BUD.build(f, enr)
    cross = crosscheck.run(f, enr, bud)
    for c in cross:
        if not c["ok"]:
            print(f"  {'CROSS-CHECK FAILED' if c['hard'] else 'NOTE'}: {c['check']}: explorer {c['explorer']} vs report {c['report']}")
    if any(c["hard"] and not c["ok"] for c in cross):
        raise SystemExit(1)
    src = {"deals": f.deals.join(enr["deals"], on="id"), "jira": f.jira.join(enr["jira"], on="key"), "engagements": f.eng.join(enr["eng"], on="id")}
    tables = {name: src[name][P.EXPORT[name]["cols"]].copy() for name in ("deals", "jira", "engagements")}
    compat(tables)
    quality = [dict(q) for q in f.quality]
    if args.anonymize:
        P.anonymize(tables)
        for q in quality:
            q["keys"] = []
    if args.anonymize:
        P.assert_no_staff_names(tables)               # also removes the helper table `__people__`; stops the build if a raw staff name is left
    P.assert_clean(tables)

    monthly = f.monthly.drop(columns=["activity_month"])
    weekly = f.daily.groupby("activity_week")[["clients_won", "clients_started", "clients_went_uc", "properties_closed",
                                               "clients_refunded", "net_client_change"]].sum().reset_index()
    weekly["week"] = weekly.activity_week.dt.strftime("%Y-%m-%d")
    payload = {
        "meta": {
            "title": "STRSearch Business Data Explorer",
            "version": {"id": D.VERSION_ID, "label": D.PACKAGE_LABEL, "title": D.PACKAGE_TITLE, "status": "current"},
            "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "asof": f.asof.strftime("%Y-%m-%d"),
            "asof_evidence": f.asof_evidence,
            "snapshot_label": f"Reporting layer refreshed {f.asof:%d %b %Y}",
            "first_month": "2024-01",
            "sources": f.meta,
            "anonymized": bool(args.anonymize),
            "counts": {"deals": int(len(f.deals)), "deals_in_scope": int(f.deals.in_scope.sum()), "jira": int(len(f.jira)),
                       "engagements": int(len(f.eng)), "events": int(len(f.events))},
        },
        "defs": {
            "statuses": {"signed_up": D.SIGNED_UP_STATUSES, "active": D.ACTIVE_STATUSES, "inactive": D.INACTIVE_STATUSES,
                         "hunting": D.HUNTING_STATUSES, "presale": D.PRESALE_STATUSES, "declined": D.DECLINED_STATUSES},
            "status_meta": D.STATUS_META,
            "status_groups": [{"name": n, "desc": d} for n, d in D.STATUS_GROUPS],
            "start_rule": D.START_RULE_TEXT, "start_rules": D.START_RULES,
            "new_experience_date": D.NEW_EXPERIENCE_DATE, "start_rule_date": D.START_RULE_DATE,
            "milestones": D.MILESTONES, "event_types": [t for _, t in D.EVENT_TYPES], "reported_event_types": D.REPORTED_EVENT_TYPES,
            "cohort_windows": D.COHORT_WINDOWS, "daily_from": D.DAILY_FROM,
            "henry": D.HENRY_TEXT, "henry_oop_max": D.HENRY_OOP_MAX, "cash": D.CASH_TEXT,
            "capital_bands": [b[2] for b in D.CAPITAL_BANDS],
            "stages": [{"name": n, "order": i + 1} for i, n in enumerate(
                D.PIPELINE_STAGES + sorted(set(f.deals.stage.dropna()) - set(D.PIPELINE_STAGES)))], "excluded_lost_reasons": D.EXCLUDED_LOST_REASONS,
            "limits": {"oop_valid_max": D.OOP_VALID_MAX, "budget_valid_min": D.BUDGET_VALID_MIN, "deals_sent_valid_max": D.DEALS_SENT_VALID_MAX},
            "views": {k: v for k, v in D.SHEETS.items()}, "not_exported_views": D.NOT_EXPORTED_VIEWS,
            "sql_reference": {"file": D.SQL_REFERENCE, "dated": D.SQL_REFERENCE_DATE},
            "budget": {k: v for k, v in enr["meta"].items() if k != "resolution"},
            "terms": glossary.TERMS,
        },
        "deals": columnar(tables["deals"], P.EXPORT["deals"]["cols"] + list(COMPAT["deals"]), P.EXPORT["deals"]["dates"]),
        "jira": columnar(tables["jira"], P.EXPORT["jira"]["cols"] + list(COMPAT["jira"]) + ["pd_source", "klass"], P.EXPORT["jira"]["dates"]),
        "engagements": columnar(tables["engagements"], P.EXPORT["engagements"]["cols"], P.EXPORT["engagements"]["dates"]),
        "views": {
            "monthly": jsonable(monthly.to_dict("records")),
            "weekly": jsonable(weekly.drop(columns=["activity_week"]).to_dict("records")),
            "cohort_monthly": jsonable(f.cohort_monthly.to_dict("records")),
            "growth": jsonable(enr["growth"]),
            "cash_bridge": jsonable(enr["bridge"]),
        },
        "quality": quality,
        "recon": f.recon,
        "expected": jsonable(dict(f.expected, budget=bud)),
        "crosschecks": jsonable(cross),
        "extras": {"sdr_moves": []},
    }
    changes = OUT_JS.parent / "version-changes.json"     # written by compare_versions.py (aggregates only)
    if changes.exists():
        payload["changes"] = json.loads(changes.read_text())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    js = "/* Generated by pipeline/build.py (16 Nov 2026 reporting version). Do not edit by hand. */\nwindow.EXPLORER_DATA = " + \
         json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=str) + ";\n"
    args.out.write_text(js, encoding="utf-8")
    if args.anonymize:      # aggregates for other AI assistants, next to the public data file
        summary = {"version": payload["meta"]["version"], "asof": payload["meta"]["asof"], "sources": f.meta, "counts": payload["meta"]["counts"],
                   "definitions": {"start_rule": D.START_RULE_TEXT, "milestones": D.MILESTONES, "henry": D.HENRY_TEXT, "cash": D.CASH_TEXT,
                                   "statuses": payload["defs"]["statuses"], "budget": payload["defs"]["budget"], "terms": glossary.TERMS},
                   "expected": payload["expected"], "growth": payload["views"]["growth"], "cash_bridge": payload["views"]["cash_bridge"],
                   "reconciliation": f.recon, "crosschecks_vs_executive_report": payload["crosschecks"], "quality": quality,
                   "changes_vs_2026_11_12": payload.get("changes")}
        (args.out.parent / "summary.json").write_text(json.dumps(jsonable(summary), indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"Wrote {args.out} ({len(js) / 1e6:.2f} MB) in {time.time() - t0:.1f}s")
    print(f"  cross-checks against the Executive Report: {sum(c['ok'] for c in cross)}/{len(cross)} ok")
    print(f"  deals {len(f.deals)} | Jira issues {len(f.jira)} | engagements {len(f.eng)} | as-of {f.asof.date()} | "
          f"reconciliation {len(f.recon)}/{len(f.recon)} ok | findings {len(quality)}")


if __name__ == "__main__":
    main()
