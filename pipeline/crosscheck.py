"""Cross-checks against the Executive Report's published data for the same 16 Nov 2026 snapshot (added 18 Nov 2026).

The report (Client Journey + Cash Forecast) was audited; every figure the Explorer adds from the shared enrichment must
equal it. A failed hard check stops the build. Returns [{check, explorer, report, ok, hard}].
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Cash Forecast totals at its default assumptions (Batch 4D, independently verified to the cent; LLM_CONTEXT of the report)
CASH_DEFAULTS = {"service": 1360698.01, "affiliate": 896752.34, "refunds": -461303.78, "net": 1796146.57}


def run(f, enr, bud) -> list[dict]:
    rep = enr["report"]
    out = []

    def chk(name, got, want, hard=True):
        out.append({"check": name, "explorer": got, "report": want, "ok": got == want, "hard": hard})

    if rep is None:
        chk("Executive Report data file found next to the Explorer", False, True)
        return out
    chk("Same snapshot as the Executive Report", f.asof.strftime("%Y-%m-%d"), rep["meta"]["asof"])
    E, J = enr["eng"], enr["jira"]
    co = f.cohort

    # 1. budget groups in the report's chapter-4 grouping (upper end of the form range)
    def rgroup(up, opn):
        if pd.isna(up):
            return "Not recorded"
        return {200: "$200K", 250: "$250K", 300: "$300K", 350: "$350K–$400K", 400: "$350K–$400K"}.get(int(up), "$450K and above") if not (opn and up == 400) else "$450K and above"
    g = co.assign(grp=[rgroup(u, o) for u, o in zip(co.id.map(E.budget_upper), co.id.map(E.budget_open))])
    hunt = g.hunting.fillna(False).astype(bool)
    dtu = g.days_to_uc.where(g.uc.notna() & (g.days_to_uc >= 0))
    pool = pd.Series(np.where(hunt, ((f.asof + pd.Timedelta(days=1)) - g.start).dt.days, dtu), index=g.index)
    mine = {lab: (int((g.grp == lab).sum()), int(dtu[g.grp == lab].notna().sum()), round(float(dtu[g.grp == lab].mean()), 2), float(dtu[g.grp == lab].median()),
                  int(hunt[g.grp == lab].sum()), int(pool[g.grp == lab].notna().sum()), round(float(pool[g.grp == lab].mean()), 2), float(pool[g.grp == lab].median()))
            for lab in g.grp.unique()}
    theirs = {b["label"]: (b["clients"], b["recorded"]["n"], b["recorded"]["mean"], b["recorded"]["median"], b["hunting"], b["scenario"]["n"], b["scenario"]["mean"], b["scenario"]["median"])
              for b in rep["speed"]["scenario"]["budgets"]}
    chk("Budget groups (clients, recorded n / mean / median, hunting, UC-tomorrow n / mean / median) = report scene 4.4", mine, theirs)
    chk("Form matches = report", enr["meta"]["form"]["matched"], rep["speed"]["scenario"]["budget_rule"]["matched"])

    # 2. 14 / 30 / 60 / 90-day cohort shares, pooled before / since June (client-start clock) = report scene 3.3
    pooled = rep["pace"]["cohorts"]["clocks"]["start"]["pooled"]
    sm = co.start.dt.strftime("%Y-%m")
    el = (f.asof - co.start).dt.days
    d = co.days_to_uc

    def pool_w(w, lo, hi):
        ok = []
        for m in sorted(sm.unique()):
            if not (lo <= m <= hi):
                continue
            gm = sm == m
            if int((gm & (el >= w)).sum()) == int(gm.sum()) and gm.any():
                ok.append(m)
        mm = sm.isin(ok)
        return {"k": int((mm & (el >= w) & d.between(0, w)).sum()), "n": int((mm & (el >= w)).sum())}
    for w in (14, 30, 60, 90):
        chk(f"UC within {w} days, pooled Jan–May vs since Jun 2026 (k / n) = report scene 3.3",
            (pool_w(w, "2026-01", "2026-05"), pool_w(w, "2026-06", "9999-12")),
            ({"k": pooled[f"w{w}"]["before"]["k"], "n": pooled[f"w{w}"]["before"]["n"]}, {"k": pooled[f"w{w}"]["after"]["k"], "n": pooled[f"w{w}"]["after"]["n"]}))

    # 3. where signed-up clients stand (status first) = report scene 2.2
    st = J.stage[J.stage.isin(["purchased", "under_contract", "hunting", "paused", "additional", "refunded"])].value_counts().to_dict()
    chk("Signed-up clients by stage = report scene 2.2", {k: int(v) for k, v in sorted(st.items())}, dict(sorted(rep["outcomes"]["waiting"]["stages"].items())))

    # 4. repeat clients (Jira side by Jira client, Pipedrive side by won-deal client) = report chapter 7
    sig = J[J.stage.isin(["purchased", "under_contract", "hunting", "paused", "additional", "refunded"])]
    gj = sig.groupby("client")
    P = gj.size()
    done = gj.stage.apply(lambda s: int((s == "purchased").sum()))
    opn = gj.stage.apply(lambda s: int(s.isin(["hunting", "under_contract"]).sum()))
    rj = rep["repeat"]["jira"]
    chk("Jira clients: total / 2+ searches / 2+ completed purchases / pursuing the next = report 7.1",
        (int(len(P)), int((P >= 2).sum()), int((done >= 2).sum()), int(((done >= 1) & (opn >= 1) & (P >= 2)).sum())),
        (rj["clients"], rj["multi_clients"], rj["two_plus_purchases"], rj["pursuing"]))
    nE = E.groupby("client").size()
    rp = rep["repeat"]["pipedrive"]
    chk("Won-deal clients: total / 2+ won deals / their deals = report 7.1", (int(len(nE)), int((nE >= 2).sum()), int(nE[nE >= 2].sum())),
        (rp["clients"], rp["repeat_clients"], rp["repeat_client_deals"]))
    chk("Repeat deals without their own Jira issue (repeat purchases / second deals under review) = report 7.1 and Cash Forecast",
        (int((E.audit == "repeat_no_issue").sum()), int((E.audit == "second_review").sum())),
        (rp["no_own_jira"]["confirmed_repeat"]["deals"], rp["no_own_jira"]["second_deal_review"]["deals"]))

    # 5. STR Cribs on repeat buyers' purchases = report 7.2
    raw = f.frames["jira"].assign(key=lambda x: x["key"].astype(str).str.upper()).set_index("key")
    des = raw.designer_used.map({"STR Cribs": "cribs", "Other Designer": "other", "Other Designer-Bought Turnkey": "turnkey"}).fillna("unknown")
    buyers = J[(J.client_purchases >= 2) & J.purchase_no.notna()]
    first, later = buyers[buyers.purchase_no == 1], buyers[buyers.purchase_no > 1]
    cr = rep["repeat"]["cribs"]
    chk("STR Cribs: designer on first / later purchases and Cribs projects handed off = report 7.2",
        ({k: int((des.reindex(first.index) == k).sum()) for k in ["cribs", "other", "turnkey", "unknown"]},
         {k: int((des.reindex(later.index) == k).sum()) for k in ["cribs", "other", "turnkey", "unknown"]},
         int((first.cribs_tracker == "Handed off to PM").sum()), int((later.cribs_tracker == "Handed off to PM").sum())),
        (cr["first"], cr["later"], cr["tracker_handed_off"]["first"], cr["tracker_handed_off"]["later"]))

    # 6. contract fall-through evidence = report chapter 6
    chk("Fall-through evidence groups = report chapter 6", {k: int(v) for k, v in sorted(J.fallout.value_counts().items())},
        dict(sorted({k: v["n"] for k, v in rep["fallout"]["groups"].items()}.items())))

    # 7. Cash Forecast reconciliation: audit resolution, groups (n and outstanding), default totals
    res = rep["cash"]["resolution"]
    au = E.audit.value_counts()
    chk("Won deals without a Jira match, resolved (own issue / separate / second deal / repeat / closing record / none) = Cash Forecast",
        (int(au.get("own_jira", 0) + au.get("own_jira_closed", 0)), int(au.get("separate", 0)), int(au.get("second_review", 0)), int(au.get("repeat_no_issue", 0)),
         int(au.get("closing_record", 0)), int(au.get("no_record", 0))),
        (res["own_jira"], res["separate_purchase"], res["second_deal_review"], res["repeat"], res["purchase_record"], res["none"]))
    ew = f.eng.set_index("id")
    outst = ew.cash_outstanding_cash_balance.fillna(0.0)
    grp = {k: (int((E.cash_group == k).sum()), round(float(outst[E.index[E.cash_group == k]].sum()), 2)) for k in sorted(E.cash_group.dropna().unique())}
    chk("Cash Forecast groups (won deals, outstanding balance) = Cash Forecast", grp,
        {k: (v["n"], round(float(v["outstanding"]), 2)) for k, v in sorted(rep["cash"]["groups"].items())})
    ex = enr["bridge"]["expected"]
    chk("Cash bridge at the default assumptions = Cash Forecast defaults (to the cent)",
        all(abs(ex[k] - v) < 0.015 for k, v in CASH_DEFAULTS.items()), True)

    # 8. monthly growth table = report scene 3.2
    chk("Monthly Won / starts / UC and growth rows = report scene 3.2", enr["growth"]["rows"], rep["pace"]["growth"]["rows"])
    # 9. budget view internal consistency
    for k in ("cmp", "strict", "band", "henry"):
        chk(f"Budget view ({k}): groups add up to every confirmed start", sum(x["n"] for x in bud["groups"][k]), bud["n"])
    return out
