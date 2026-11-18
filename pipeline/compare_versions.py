#!/usr/bin/env python3
"""Explain why 12 Nov 2026 and 16 Nov 2026 figures differ (aggregates only).

    python pipeline/compare_versions.py [--old-pipeline versions/2026-11-12/pipeline] [--cache]

Loads the archived version through its own frozen pipeline (12 Nov DIM extracts, original definitions) and the
current version through foundation.py (reporting layer), matches Jira issues by key, and writes
docs/2026-11-16/data/version-changes.json: record-coverage changes, definition effects (start date, Under
Contract, closing date) and the headline figures side by side. No record-level data is written.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
pd.set_option("future.no_silent_downcasting", True)
import definitions as D  # noqa: E402
import foundation  # noqa: E402

ROOT = foundation.ROOT
OUT = ROOT / "docs" / D.VERSION_ID / "data" / "version-changes.json"


def load_old(pipeline_dir: Path, use_cache: bool):
    spec = importlib.util.spec_from_file_location("explorer_build_20261112", pipeline_dir / "build.py")
    mod = importlib.util.module_from_spec(spec)
    saved = {k: sys.modules.pop(k) for k in ("definitions", "metrics", "quality") if k in sys.modules}
    sys.modules["explorer_build_20261112"] = mod
    spec.loader.exec_module(mod)
    M_old = sys.modules["metrics"]
    frames, meta = mod.load_sources(mod.DEFAULT_REPORTS, use_cache)
    jira_keys = set(mod.clean_str(frames["jira"]["key"]).str.upper().dropna())
    deals_all = mod.build_deals_all(frames["deals"])
    deals = mod.build_deals(frames["deals"], frames["stages"], jira_keys)
    jira = mod.build_jira(frames["jira"], deals_all)
    snap = {m["key"]: m["snapshot"] for m in meta}
    asof = min(pd.Timestamp(snap["jira"]), pd.Timestamp(snap["deals"])).normalize()
    expected = M_old.expected(deals, jira, asof)
    for k in ("definitions", "metrics", "quality"):
        sys.modules.pop(k, None)
    sys.modules.update(saved)
    return jira, expected, asof


def pct(a, b):
    return None if not b else round(a / b, 4)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old-pipeline", type=Path, default=ROOT / "versions" / "2026-11-12" / "pipeline")
    ap.add_argument("--reports", type=Path, default=foundation.DEFAULT_REPORTS)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--cache", action="store_true")
    args = ap.parse_args()

    oj, oe, oasof = load_old(args.old_pipeline.resolve(), args.cache)
    f = foundation.load(args.reports, args.cache)
    nj, ne = f.jira, f.expected
    oj = oj.assign(key=oj.key.astype(str).str.upper())
    both = oj.merge(nj, on="key", how="outer", indicator=True, suffixes=("_old", ""))
    b = both[both._merge == "both"]
    gone = both[both._merge == "left_only"]
    new = both[both._merge == "right_only"]

    sx, sn = b.signed_list.astype(bool), b.signed.astype(bool)
    ss = b[sn & b.start.notna() & b.start_old.notna()]
    shift = (ss.start - ss.start_old).dt.days
    post = ss.created >= pd.Timestamp(D.START_RULE_DATE)
    uc = b[b.uc_old.notna() & b.uc.notna()]
    ucd = (uc.uc - uc.uc_old).dt.days
    cl = b[b.closed_old.notna() | b.closed_raw.notna()]
    cld = (cl.closed_raw - cl.closed_old).dt.days

    out = {
        "versions": {"old": {"id": "2026-11-12", "data_asof": oasof.strftime("%Y-%m-%d")},
                     "new": {"id": D.VERSION_ID, "data_asof": f.asof.strftime("%Y-%m-%d")}},
        "records": {
            "jira_old": int(len(oj)), "jira_new": int(len(nj)), "jira_both": int(len(b)),
            "dropped": {"n": int(len(gone)), "signed": int(gone.signed_list.astype(bool).sum()),
                        "by_status": {k: int(v) for k, v in gone.status_old.value_counts().items()} if "status_old" in gone else {},
                        "created_2024": int((gone.created_old.dt.year == 2024).sum())},
            "added": {"n": int(len(new)), "created_before_old_asof": int((new.created < oasof).sum()),
                      "by_status": {k: int(v) for k, v in new.status.value_counts().items()}},
            "signed_changes": {"was_signed_now_not": int((sx & ~sn).sum()), "newly_signed": int((~sx & sn).sum())},
        },
        "start_date": {
            "signed_compared": int(len(ss)), "same": int((shift == 0).sum()), "differ": int((shift != 0).sum()),
            "pre_june_plus4": int(((~post) & (shift == D.CREATED_OFFSET_DAYS)).sum()),
            "pre_june_other": int(((~post) & (shift != 0) & (shift != D.CREATED_OFFSET_DAYS)).sum()),
            "post_june": {"n": int(post.sum()), "differ": int((post & (shift != 0)).sum()),
                          "later": int((post & (shift > 0)).sum()), "earlier": int((post & (shift < 0)).sum()),
                          "median_shift": float(shift[post].median()) if post.any() else None,
                          "p10": float(shift[post].quantile(.1)) if post.any() else None,
                          "p90": float(shift[post].quantile(.9)) if post.any() else None},
        },
        "under_contract": {
            "compared": int(len(uc)), "same": int((ucd == 0).sum()), "moved": int((ucd != 0).sum()),
            "moved_later": int((ucd > 0).sum()), "median_move_days": float(ucd[ucd != 0].median()) if (ucd != 0).any() else None,
            "max_move_days": float(ucd.max()) if len(ucd) else None,
            "new_only": int((b.uc_old.isna() & b.uc.notna()).sum()), "old_only": int((b.uc_old.notna() & b.uc.isna()).sum()),
            "old_had_repeat_contracts": int((b.uc_count > 1).sum()),
        },
        "closing": {
            "compared": int((cl.closed_old.notna() & cl.closed_raw.notna()).sum()), "same": int((cld == 0).sum()),
            "differ": int(((cld != 0) & cld.notna()).sum()), "earlier": int((cld < 0).sum()), "later": int((cld > 0).sum()),
            "median_diff_days": float(cld[(cld != 0) & cld.notna()].median()) if ((cld != 0) & cld.notna()).any() else None,
            "new_only": int((cl.closed_old.isna() & cl.closed_raw.notna()).sum()),
            "scheduled_after_asof": int(f.jira.closed_scheduled.sum()),
        },
        "headline": {
            "old": {"signed": oe["jira"]["signed"], "active": oe["jira"]["active"], "inactive": oe["jira"]["inactive"],
                    "uc_median": oe["q1"]["uc"]["median"], "uc_mean": oe["q1"]["uc"]["mean"], "uc_n": oe["q1"]["uc"]["n"],
                    "closed_median": oe["q1"]["closed"]["median"], "closed_mean": oe["q1"]["closed"]["mean"], "closed_n": oe["q1"]["closed"]["n"],
                    "km_uc": oe["q1"]["km_uc_signed"], "km_closed": oe["q1"]["km_closed_signed"],
                    "active_uc_share": pct(oe["q2"]["active_uc"], oe["q2"]["active"]),
                    "active_closed_share": pct(oe["q2"]["active_closed"], oe["q2"]["active"])},
            "new": {"signed": ne["jira"]["signed"], "active": ne["jira"]["active"], "inactive": ne["jira"]["inactive"],
                    "hunting": ne["jira"]["hunting"],
                    "uc_median": ne["q1"]["uc"]["median"], "uc_mean": ne["q1"]["uc"]["mean"], "uc_n": ne["q1"]["uc"]["n"],
                    "closed_median": ne["q1"]["closed"]["median"], "closed_mean": ne["q1"]["closed"]["mean"], "closed_n": ne["q1"]["closed"]["n"],
                    "km_uc": ne["q1"]["km_uc"], "km_closed": ne["q1"]["km_closed"],
                    "active_uc_share": pct(ne["q2"]["active_uc"], ne["q2"]["active"]),
                    "active_closed_share": pct(ne["q2"]["active_closed"], ne["q2"]["active"])},
            "populations": {"old": "Q1: every Jira issue with a first UC / CLOSED date; KM and Q2: signed-up Jira issues",
                            "new": "Q1 and KM: won engagements with a confirmed Jira start; Q2: Jira issues by reporting-layer flags"},
        },
        "monthly": [],
    }
    oq = {r["month"]: r for r in oe["q3"]}
    for r in ne["q3"]:
        o = oq.get(r["month"])
        if r["month"] >= "2026-01" and o:
            out["monthly"].append({"month": r["month"], "starts_old": o["new_signed_start"], "starts_new": r["started"],
                                   "uc_old": o["uc"], "uc_new": r["uc"], "closed_old": o["closed"], "closed_new": r["closed"],
                                   "gap_old": o["new_signed_start"] - o["uc"], "gap_new": r["net_client_change"]})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")
    print(f"Wrote {args.out}")
    print(json.dumps(out["headline"], indent=1, default=str))


if __name__ == "__main__":
    main()
