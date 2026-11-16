"""One call that loads, models, rebuilds and checks the 16 Nov 2026 reporting version.

Both build.py (the Explorer data file) and the Executive Report's pipeline use load(), so the two sites share one
set of records, views and headline metrics.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
pd.set_option("future.no_silent_downcasting", True)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import definitions as D  # noqa: E402
import metrics as M  # noqa: E402
import model  # noqa: E402
import quality as Q  # noqa: E402
import sources  # noqa: E402
import views as V  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORTS = ROOT.parent / D.SOURCE_FOLDER


@dataclass
class Foundation:
    asof: pd.Timestamp
    frames: dict            # raw exported views (never published)
    meta: dict              # source description (file names, hashes, sheet sizes)
    deals: pd.DataFrame     # pipedrive_reporting_base, cleaned
    jira: pd.DataFrame      # jira_reporting_base, cleaned
    eng: pd.DataFrame       # won_clients_master + client_cash_forecast, cleaned
    events: pd.DataFrame    # client_events, rebuilt (reconciled with the export)
    daily: pd.DataFrame     # daily_client_activity, rebuilt
    monthly: pd.DataFrame   # SUM-by-month aggregation of daily
    cohort: pd.DataFrame    # client_cohort_performance, rebuilt (as-of pinned to the data date)
    cohort_monthly: pd.DataFrame
    expected: dict          # headline metrics shared by the Explorer and the Executive Report
    recon: list = field(default_factory=list)
    quality: list = field(default_factory=list)
    asof_evidence: dict = field(default_factory=dict)

    @property
    def recon_failures(self) -> list:
        return [r for r in self.recon if not r["ok"]]


def load(reports: Path | None = None, use_cache: bool = False, cache_dir: Path | None = None) -> Foundation:
    reports = Path(reports) if reports else DEFAULT_REPORTS
    frames, meta = sources.load(reports, cache_dir or (ROOT / ".cache"), use_cache)
    asof, evidence = sources.data_asof(frames)
    jira = model.build_jira(frames["jira"], asof)
    deals = model.build_deals(frames["deals"], jira)
    eng = model.build_engagements(frames["master"], frames["cash"], jira, deals, asof)
    ev = V.events(eng)
    daily = V.daily_activity(ev, asof)
    monthly = V.monthly_activity(daily)
    cohort = V.cohort_performance(eng, asof)
    cm = V.cohort_monthly(cohort)
    expected = M.expected(deals, jira, eng, cohort, monthly, cm, asof)
    f = Foundation(asof=asof, frames=frames, meta=meta, deals=deals, jira=jira, eng=eng, events=ev, daily=daily,
                   monthly=monthly, cohort=cohort, cohort_monthly=cm, expected=expected, asof_evidence=evidence)
    f.recon = Q.reconcile(frames, deals, jira, eng, ev, daily, cohort, asof)
    f.quality = Q.run_checks(deals, jira, eng, cohort, asof)
    return f
