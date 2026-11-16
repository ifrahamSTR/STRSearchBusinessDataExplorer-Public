"""Read the reporting-layer export (read-only) and describe what was read.

The workbook holds one sheet per SQL view. Sheets are cached as pickles in .cache/ keyed on the file's path,
modification time and size, so a changed workbook is always re-read.
"""
from __future__ import annotations

import hashlib
import time
import warnings
from datetime import datetime
from pathlib import Path

import pandas as pd

import definitions as D

warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load(reports: Path, cache_dir: Path, use_cache: bool) -> tuple[dict[str, pd.DataFrame], dict]:
    path = reports / D.SOURCE_WORKBOOK
    if not path.exists():
        raise SystemExit(f"Missing source workbook: {path}")
    stamp = hashlib.md5(f"{path}:{path.stat().st_mtime}:{path.stat().st_size}".encode()).hexdigest()[:10]
    cached = {k: cache_dir / f"v{D.VERSION_ID}-{k}-{stamp}.pkl" for k in D.SHEETS}
    if use_cache and all(p.exists() for p in cached.values()):
        frames = {k: pd.read_pickle(p) for k, p in cached.items()}
    else:
        t = time.time()
        sheets = pd.read_excel(path, sheet_name=list(D.SHEETS.values()))
        frames = {k: sheets[s] for k, s in D.SHEETS.items()}
        print(f"  read {path.name} ({len(D.SHEETS)} sheets) in {time.time() - t:.1f}s")
        if use_cache:
            cache_dir.mkdir(exist_ok=True)
            for k, df in frames.items():
                df.to_pickle(cached[k])
    ref = reports / D.SQL_REFERENCE
    meta = {
        "folder": reports.name,
        "workbook": {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256(path),
                     "modified": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M")},
        "sql_reference": {"file": ref.name, "present": ref.exists(), "dated": D.SQL_REFERENCE_DATE,
                          **({"bytes": ref.stat().st_size, "sha256": sha256(ref)} if ref.exists() else {})},
        "sheets": [{"key": k, "sheet": D.SHEETS[k], "rows": int(len(df)), "columns": int(df.shape[1])} for k, df in frames.items()],
    }
    return frames, meta


def data_asof(frames: dict[str, pd.DataFrame]) -> tuple[pd.Timestamp, dict]:
    """The date the views were refreshed/queried, read from the views' own 'today' arithmetic.

    won_clients_master.days_to_uc_projected = (refresh date + 1) - client_start_date for hunting clients with no UC,
    and client_cash_forecast.days_since_client_start = query date - client_start_date. Both must agree.
    """
    m, c = frames["master"], frames["cash"]
    h = m[(m.hunting_clients == 1) & m.property_uc_date.isna() & m.days_to_uc_projected.notna()]
    refresh = (pd.to_datetime(h.client_start_date) + pd.to_timedelta(h.days_to_uc_projected - 1, unit="D")).dt.normalize()
    query = (pd.to_datetime(c.client_start_date) + pd.to_timedelta(c.days_since_client_start, unit="D")).dt.normalize()
    dates = sorted(set(refresh.dropna()) | set(query.dropna()))
    evidence = {"master_refresh": sorted({d.strftime("%Y-%m-%d") for d in refresh.dropna()}),
                "cash_query": sorted({d.strftime("%Y-%m-%d") for d in query.dropna()})}
    if len(dates) != 1:
        raise SystemExit(f"Views disagree on their as-of date: {evidence}")
    return dates[0], evidence
