"""Record-level enrichment for the 16 Nov 2026 Explorer (added 18 Nov 2026).

Reuses the Executive Report's pipeline (../STRSearch-Executive-Dashboard/pipeline) on the Explorer's own, already-loaded
foundation, so both sites share one set of matches and definitions:
  - onboarding budget: the onboarding form's "Total out-of-pocket capital available (all-in)" range (column M), matched to
    confirmed starts as in the report's chapter 5 (e-mail first, the form's deal id as a fallback; the answer given before
    the Under Contract date). Carson's rule: read the range at its upper end. Exported as the selected range only.
  - prior offer experience (form column AA): the one onboarding answer associated with speed in chapter 5.
  - client identity: won deals and Jira issues that share an e-mail (12 Nov extracts), a Pipedrive person id or a Jira link
    belong to one client (repeat.deal_people + records.people). Exported as a pseudonym (C0001), never as an e-mail.
  - audit resolution of won deals without a Jira match and the Cash Forecast group of every won deal (cash.assign_groups).
  - status-first stage (records.stage), contract fall-through evidence (fallout.classify) and STR Cribs evidence (Jira
    Designer Used + the Cribs tracker matched by property address).
Aggregates: monthly growth (pace.growth) and the cash bridge at the Cash Forecast's default assumptions (from the report's
published data file). Private sources never leave this module at record level except as the bands and labels above.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT.parent / "STRSearch-Executive-Dashboard"
SEARCH = ["Client Start", "2 Weeks", "4 Weeks", "6 Weeks", "8 Weeks"]

BUDGET_FIELD = "Total out-of-pocket capital available (all-in)"
BUDGET_MEASURES = "down payment + closing costs + renovation + furniture + amenities: all-in capital, not the purchase price"
BUDGET_THRESHOLD = 250
BANDS = ["$150K–$200K", "$200K–$250K", "$250K–$300K", "$300K–$350K", "$350K–$400K", "$400K–$450K", "$450K–$500K", "$400K+", "$500K+"]
CMP = ["Up to $250K", "Above $250K"]
STRICT = ["Below $250K", "Range ends at $250K", "Above $250K"]
OFFERS = {"0": "No offers before", "1-2": "1–2 offers before", "3+": "3+ offers before"}
AUDIT = {  # evidence label prefix -> (key, label)
    "Jira match": ("jira", "Jira match (reporting layer)"),
    "closing recorded on its own Jira issue": ("own_jira_closed", "Own Jira issue found by e-mail (closed)"),
    "e-mail matches its own Jira issue": ("own_jira", "Own Jira issue found by e-mail"),
    "separate purchase": ("separate", "Separate purchase with its own Jira issue"),
    "second deal under review": ("second_review", "Second deal under review"),
    "repeat purchase": ("repeat_no_issue", "Repeat purchase, no Jira issue of its own"),
    "client found in brokerage or lender closing records": ("closing_record", "Closing found in brokerage / lender records"),
    "no Jira issue, e-mail, or purchase record found": ("no_record", "No Jira issue or purchase record found"),
    "closing found in affiliate records by property address": ("closing_by_address", "Closing found in affiliate records (address)"),
    "post-close status, but no closing date": ("post_close_no_date", "Post-close status without a closing date"),
}
CASH_GROUPS = {"under_contract": "Under contract", "scheduled": "Closing scheduled", "noprop": "No property yet", "paused": "Paused / Additional Service",
               "refunded": "Refund already processed", "closed": "Closed (closing recorded)", "unverified_closing": "Post-close, closing unverified",
               "unverified_repeat": "Repeat purchase, no own Jira issue", "unverified_none": "No record found", "second_deal_review": "Second deal under review"}
STAGE_LABEL = {"purchased": "Completed purchase", "under_contract": "Under contract", "hunting": "Hunting", "paused": "Paused",
               "additional": "Additional Service", "refunded": "Refunded", "presale": "Pre-sale prospect", "declined": "Services Declined",
               "no_jira": "No Jira issue"}


def _report():
    p = str(REPORT / "pipeline")
    if not (REPORT / "pipeline" / "core.py").exists():
        raise SystemExit(f"Executive Report pipeline not found at {p}: the enrichment reuses its matches and definitions.")
    if p not in sys.path:
        sys.path.insert(0, p)
    import core as RC  # noqa: E402
    from chapters import cash, drivers, fallout, pace, records, repeat  # noqa: E402
    return RC, cash, drivers, fallout, pace, records, repeat


def band(label):
    """Form range label -> (normalised range, upper amount in $K, open-ended)."""
    if label is None or pd.isna(label):
        return None, None, None
    s = str(label).strip()
    nums = [int(x) for x in re.findall(r"\$(\d+)\s*K", s)]
    if not nums:
        return None, None, None
    up = nums[-1]
    if s.endswith("+"):
        return f"${up}K+", up, True
    lo = nums[0] - 1 if nums[0] % 50 == 1 else nums[0]        # "$351K–$400K" -> "$350K–$400K"
    return f"${lo}K–${up}K", up, False


def _union():
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)
    return find, union


def build(f) -> dict:
    """Returns {"eng": DataFrame indexed by deal id, "jira": DataFrame indexed by Jira key, "deals": DataFrame indexed by deal id,
    "aggregates": {...}, "report": the report's published data (for cross-checks)} ."""
    RC, cash, DR, FO, PACE, R, RP = _report()
    import definitions as D
    ctx = RC.from_foundation(f, ROOT, D)
    asof = ctx.asof
    eng, jira = f.eng.copy(), f.jira.copy()

    # ---------------------------------------------------------------- onboarding budget + offer experience (confirmed starts)
    co = ctx.cohort
    form = DR.load_form(RC.ROOT.parent / "12 Nov 26 Reports" / "DataDrive" / DR.WORKBOOK)
    ans, info = DR.match(co, form, DR.jira_email_hashes(ctx.explorer))
    b = pd.DataFrame([band(v) for v in ans.cap_label], index=ans.index, columns=["budget_band", "budget_upper", "budget_open"])
    b["id"] = co.id.values
    b["offers"] = [OFFERS.get(o) if m else None for o, m in zip(ans.offers, ans.matched)]
    b = b.set_index("id")
    out_e = pd.DataFrame(index=eng.id.values)
    out_e.index.name = "id"
    out_e["budget_band"] = b.budget_band
    out_e["budget_upper"] = b.budget_upper
    out_e["budget_open"] = b.budget_open
    up = out_e.budget_upper
    out_e["budget_cmp"] = np.where(up.isna(), None, np.where(up <= BUDGET_THRESHOLD, CMP[0], CMP[1]))
    out_e["budget_strict"] = np.where(up.isna(), None, np.where(up < BUDGET_THRESHOLD, STRICT[0], np.where(up == BUDGET_THRESHOLD, STRICT[1], STRICT[2])))
    out_e["offers"] = b.offers

    # ---------------------------------------------------------------- one client id across won deals and Jira issues
    j12 = R.jira12(ctx.explorer)
    sig = ctx.signed
    jpid = R.people(sig.key, j12)                                # Jira person (Pipedrive person id or primary e-mail)
    jpid_by_key = pd.Series(jpid.values, index=sig.key.values)
    e2, rc = RP.deal_people(ctx, j12, jpid_by_key)               # won deals linked by e-mail, Jira issue and that issue's client
    find, union = _union()
    _, d12 = cash._old_package(ctx.explorer)
    mail = d12.assign(i=pd.to_numeric(d12.Deal_ID, errors="coerce")).dropna(subset=["i"]).drop_duplicates("i").set_index("i").pd_primary_email.map(RP._hash)
    for i, k in zip(e2.id, e2.jira_key):
        find("d%d" % i)
        m = mail.get(i)
        if isinstance(m, str):
            union("d%d" % i, "e" + m)
        if isinstance(k, str):
            union("d%d" % i, "k" + k)
    for k, p in jpid_by_key.items():
        find("k" + k)
        union("k" + k, "p" + p)
    deal_root = pd.Series({int(i): find("d%d" % i) for i in e2.id})
    key_root = pd.Series({k: find("k" + k) for k in jpid_by_key.index})
    first_seen = {}
    for i, w in zip(eng.id, eng.won_date):
        r = deal_root[int(i)]
        first_seen[r] = min(first_seen.get(r, pd.Timestamp.max), w if pd.notna(w) else pd.Timestamp.max)
    for k, c in zip(sig.key, sig.created):
        r = key_root[k]
        first_seen[r] = min(first_seen.get(r, pd.Timestamp.max), c if pd.notna(c) else pd.Timestamp.max)
    order = sorted(first_seen, key=lambda r: (first_seen[r], r))
    pseudo = {r: f"C{n + 1:04d}" for n, r in enumerate(order)}
    out_e["client"] = [pseudo[deal_root[int(i)]] for i in out_e.index]
    ew = eng.set_index("id")
    tmp = pd.DataFrame({"client": out_e.client, "won": ew.won_date.reindex(out_e.index)})
    tmp["n"] = tmp.groupby("client").client.transform("size")
    tmp = tmp.sort_values(["client", "won"]).assign(k=lambda x: x.groupby("client").cumcount() + 1)
    out_e["client_deals"] = tmp.n.reindex(out_e.index)
    out_e["search_no"] = tmp.k.reindex(out_e.index)
    out_e["search_kind"] = np.where(out_e.search_no > 1, "Repeat search (2nd or later deal)", "First search")

    # ---------------------------------------------------------------- audit resolution + Cash Forecast group per won deal
    eg, rc2 = cash.assign_groups(ctx)
    eg = eg.set_index("id")

    def audit(ev):
        for pre, (k, lab) in AUDIT.items():
            if str(ev).startswith(pre):
                return k, lab
        return "other", str(ev)
    au = eg.evidence.map(audit)
    out_e["audit"] = [a[0] for a in au.reindex(out_e.index)]
    out_e["audit_label"] = [a[1] for a in au.reindex(out_e.index)]
    out_e["cash_group"] = eg.g.reindex(out_e.index)

    # ---------------------------------------------------------------- Jira: stage, fall-through, Cribs, purchases per client
    st = R.stage(sig).set_axis(sig.key.values)
    fo = FO.classify(ctx)
    raw = f.frames["jira"].assign(key=lambda x: x["key"].astype(str).str.upper()).set_index("key")
    cribs_at = RP.cribs_stages()
    out_j = pd.DataFrame(index=jira.key.values)
    out_j.index.name = "key"
    out_j["stage"] = pd.Series(st).reindex(out_j.index)
    nsig = jira.set_index("key")
    out_j.loc[out_j.stage.isna() & nsig.status.reindex(out_j.index).isin(D.PRESALE_STATUSES), "stage"] = "presale"
    out_j.loc[out_j.stage.isna() & nsig.status.reindex(out_j.index).isin(D.DECLINED_STATUSES), "stage"] = "declined"
    out_j["fallout"] = fo.grp.reindex(out_j.index)
    # Jira clients use the report's Jira grouping (same Pipedrive person id or primary e-mail in the Jira extract), so the
    # Jira-side counts equal the report's; won deals use the wider grouping above (e-mail, Jira link and that issue's client).
    jorder = sorted(set(jpid_by_key.values), key=lambda p: (min(sig.created[jpid.values == p].fillna(pd.Timestamp.max)), p))
    jpseudo = {p: f"JC{n + 1:04d}" for n, p in enumerate(jorder)}
    out_j["client"] = [jpseudo[jpid_by_key[k]] if k in jpid_by_key.index else None for k in out_j.index]
    done = st.eq("purchased")
    dj = sig.set_index("key").assign(done=done.reindex(sig.key.values).values, client=[jpseudo[jpid_by_key[k]] for k in sig.key])
    dj["order"] = dj.closed.fillna(dj.start).fillna(dj.created)
    dd = dj[dj.done].rename_axis("key").reset_index().sort_values(["client", "order", "key"]).set_index("key")   # ties by key, as the report
    dd["purchase_no"] = dd.groupby("client").cumcount() + 1
    out_j["purchase_no"] = dd.purchase_no.reindex(out_j.index)
    out_j["client_searches"] = dj.groupby("client").client.transform("size").reindex(out_j.index)
    out_j["client_purchases"] = dj.groupby("client").done.transform("sum").reindex(out_j.index)
    addr = raw.address_under_contract.reindex(out_j.index).map(cash._addr)
    out_j["cribs_tracker"] = addr.map(cribs_at)
    out_j.loc[~done.reindex(out_j.index).fillna(False).astype(bool), "cribs_tracker"] = None   # evidence is read on completed purchases only

    # engagement view of the Jira-side fields
    ji = out_j
    jk = ew.jira_key.reindex(out_e.index)
    out_e["stage"] = [ji.stage.get(k) if isinstance(k, str) and k in ji.index else "no_jira" for k in jk]
    out_e["stage"] = out_e.stage.fillna("no_jira")
    out_e["fallout"] = [ji.fallout.get(k) if isinstance(k, str) and k in ji.index else None for k in jk]
    out_e["purchase_no"] = [ji.purchase_no.get(k) if isinstance(k, str) and k in ji.index else None for k in jk]
    out_e["cribs_tracker"] = [ji.cribs_tracker.get(k) if isinstance(k, str) and k in ji.index else None for k in jk]
    # Jira rows carry the budget of the engagement that links to them (budget is matched at engagement level)
    by_key = out_e.assign(jira_key=jk.values).dropna(subset=["jira_key"]).drop_duplicates("jira_key").set_index("jira_key")
    for c in ["budget_band", "budget_upper", "budget_open", "budget_cmp", "budget_strict", "offers"]:
        out_j[c] = by_key[c].reindex(out_j.index)

    # deals: client and search number for won deals
    out_d = out_e[["client", "search_no", "search_kind", "budget_band", "budget_cmp", "budget_strict", "offers", "audit"]].copy()

    # ---------------------------------------------------------------- aggregates
    growth = PACE.growth(ctx)
    rep_path = REPORT / "docs" / "2026-11-16" / "data" / "story-data.json"
    report = json.loads(rep_path.read_text()) if rep_path.exists() else None
    bridge = cash_bridge(report, f) if report else None
    meta = {"form": {"field": BUDGET_FIELD, "column": "M", "since": "2026-04-20", "measures": BUDGET_MEASURES, "rule": "upper end of the selected range (Carson's interim rule, also being carried into Jira's budget field)",
                     "threshold_k": BUDGET_THRESHOLD, "matched": int(ans.matched.sum()), "confirmed_starts": int(len(co)),
                     "since_form": int((co.start >= pd.Timestamp("2026-04-20")).sum()),
                     "since_form_matched": int(((co.start >= pd.Timestamp("2026-04-20")) & ans.matched.reindex(co.index).fillna(False)).sum()),
                     "via_deal_only": info["via_deal_only"], "jira_budget_filled_signed": int(sig.budget.notna().sum()), "signed": int(len(sig))},
            "bands": BANDS, "cmp": CMP, "strict": STRICT, "offers": list(OFFERS.values()), "audit": {v[0]: v[1] for v in AUDIT.values()},
            "cash_groups": CASH_GROUPS, "stages": STAGE_LABEL, "resolution": rc2}
    return {"eng": out_e, "jira": out_j, "deals": out_d, "growth": growth, "bridge": bridge, "meta": meta, "report": report, "ctx": ctx}


def cash_bridge(report: dict, f) -> dict:
    """Booked fees -> contract balances -> expected collections -> forecast net cash, at the Cash Forecast's default assumptions
    (the same totals the Cash Forecast page shows before any control is moved)."""
    c = report["cash"]
    G, NP, PA, F, DEF = c["groups"], c["noprop"], c["paused"], c["fixed"], c["defaults"]
    pr, pf = DEF["paused_defaults"]["resume"] / 100, DEF["paused_defaults"]["refund"] / 100
    aff = DEF["affiliates"]
    fixed = float(sum(F["svc"]))
    service = fixed + NP["collect"] + pr * PA["second"]
    kn = {k: float(sum(F["known"][k])) for k in aff}
    un = {k: float(sum(F["unknown"][k])) for k in aff}
    affiliate = sum(aff[k]["rev"] * (kn[k] + aff[k]["conv"] * un[k]) for k in aff) \
        + sum(aff[k]["rev"] * (NP["aff"][k]["known"] + aff[k]["conv"] * NP["aff"][k]["unknown"]) for k in aff) \
        + sum(aff[k]["rev"] * pr * (PA["aff"][k]["known"] + aff[k]["conv"] * PA["aff"][k]["unknown"]) for k in aff)
    refunds = -(float(sum(F["refund_base"])) + NP["refund_base"] + pf * PA["paid"])
    eng = f.eng
    return {
        "booked_value_won_engagements": float(eng.value.sum()), "engagements": int(len(eng)),
        "contractual": float(c["view"]["assumed_collected"] + c["view"]["gross_outstanding"]),
        "assumed_collected": float(c["view"]["assumed_collected"]), "gross_outstanding": float(c["view"]["gross_outstanding"]),
        "groups": [{"key": k, "label": CASH_GROUPS.get(k, k), "n": g["n"], "outstanding": g["outstanding"], "second": g.get("second"), "paid": g.get("paid"),
                    "p_close": g.get("p_close")} for k, g in G.items()],
        "defaults": {"paused": DEF["paused_defaults"], "affiliates": aff, "expected_days": DEF["expected_days"]},
        "expected": {"service": round(service, 2), "service_parts": {"contracts": round(fixed, 2), "searching": NP["collect"], "paused": round(pr * PA["second"], 2)},
                     "affiliate": round(affiliate, 2), "refunds": round(refunds, 2), "net": round(service + affiliate + refunds, 2)},
        "searching": {"n": NP["n"], "p_close": NP["p_close"], "p_refund": NP["p_refund"], "p_pause": NP["p_pause"]},
        "unresolved": {"second_deal_review": c["resolution"]["second_deal_review"], "repeat": c["resolution"]["repeat"], "none": c["resolution"]["none"]},
    }
