# STRSearch Business Data Explorer

How STRSearch's sales (Pipedrive) and client acquisition (Jira) data fit together. Two reporting versions are published (see [`VERSIONS.md`](VERSIONS.md)):
- **16 Nov 2026 · Updated reporting (default):** `docs/2026-11-16/`, built from the Supabase reporting layer (`16 Nov UpdatedReports`) with `pipeline/` (`foundation.py` loads, rebuilds `daily_client_activity` and `client_cohort_performance`, and reconciles; `build.py` writes the data file, `--anonymize` for this public build).
- **12 Nov 2026 · Original reporting (archived, frozen):** `docs/2026-11-12/`, rebuilt only by `versions/2026-11-12/pipeline/`.

Live: https://ifrahamstr.github.io/STRSearchBusinessDataExplorer-Public/ (opens the default; /2026-11-16/ and /2026-11-12/ are stable version links). Data for other AI assistants: `docs/2026-11-16/data/summary.json` and `docs/2026-11-12/data/summary.json`, plus [`LLM_CONTEXT.md`](LLM_CONTEXT.md).

## 16 Nov 2026 at a glance
- Pipedrive: 7,662 in-scope deals, 876 won engagements (829 with a Jira match, 825 confirmed starts, 51 Pipedrive-fallback starts).
- Jira: 1,591 issues; 843 signed-up = 648 Active + 195 Inactive; 123 hunting; 347 pre-sale and 401 declined prospects.
- Key question 1 (confirmed starts): median 37.5 days to Under Contract (mean 56.17), 73 to CLOSED (mean 92.82); Kaplan–Meier 76 / 117 days.
- Key question 2 (Jira issues): 464 of 648 Active clients reached UC, 438 CLOSED.
- Reconciliation: 36/36 checks against the export and the SQL reference.

## Added 18 Nov 2026: budget performance, cohort builder and depth
- **Budget performance** (`#budget`): onboarding-form all-in out-of-pocket capital range (column M, since 20 Apr 2026) read at its upper end (the stated rule); up to vs above $250K, strict below / range ends at / above $250K, every range, and the historical HENRY flag (Jira total_oop <= $225K). 14-day UC first, then 30 / 45 / 60 / 90 days, KM curves, time to UC and UC -> close, the UC-tomorrow scenario, today's stages, refunds, and a like-for-like check (Mantel-Haenszel over start month x client experience x start rule). Headline at the snapshot: UC within 14 days 13/194 = 6.7% up to $250K vs 12/191 = 6.3% above; like-for-like +0.3 pts (95% -4.7 to +5.4); refunds within 30 / 60 days like-for-like +5.9 / +5.9 pts.
- **Cohort builder** (`#cohorts`): entry event (deal created, won, client start, Under Contract), date range, grouping (budget, HENRY, channel, package, payment, rep, setter, acquisition lead, experience, start rule, first vs repeat search, offer experience, Pipedrive capital, stage, month, quarter) and up to two outcomes with day windows; eligible denominators, maturity by entry month, KM curves, CSV export.
- **Depth**: monthly Won / starts / UC with MoM / YoY growth and comparability notes, the hunting backlog, qualification, open-deal age, time to win / loss, the Pipedrive -> Jira handoff, audit-recovered deals, repeat service sales / searches / purchases, STR Cribs selection vs verified handoff, contract fall-through evidence, and booked fees -> expected collections -> forecast cash ($1,360,698.01 + $896,752.34 − $461,303.78 = $1,796,146.57 at the Cash Forecast defaults). Business terms open on demand (unit, date basis, source, calculation); full glossary in Definitions.
- **How it is built**: `pipeline/enrich.py` reuses the Executive Report's pipeline (../STRSearch-Executive-Dashboard/pipeline: form matching, client identity, audit resolution, Cash Forecast groups, fall-through, Cribs tracker) on this build's own foundation; `budget.py` is the Python reference for the budget view; `crosscheck.py` compares 21 figures with the report's published data for the same snapshot (the build stops on any mismatch); `SX.parity()` compares the browser with Python (885 checks at default filters). `--anonymize` also writes `summary.json`.
- **Reconciliation fix (18 Nov 2026, with the Executive Report's 18 Nov 2026 update)**: "All time" now keeps Jira issues without a client start date, so the default views equal the reference figures and the report (843 signed-up, 648 Active, 123 hunting, 108 paused, 82 refunded; attainment 72% / 68%), where they had shown 826 / 635 / 110. Hunting ages skip the 13 hunting clients with no start date (no won deal linked) instead of aging them from 1970: the 110 with a start date have waited a median 59 days and 33 more than 90 (previously shown as 68 days and 46). Any bounded period still needs the date. Data file unchanged; SX.parity 885/885.
- **Public build and staff names (18 Nov 2026)**: the raw Jira `assignee` column (the same person as `acq_lead`) was reaching the public data with real names; it now takes the same pseudonym as `acq_lead` (Lead 01…), and `--anonymize` stops the build if any raw staff name is left in an exported cell (`privacy.assert_no_staff_names`). The archived 12 Nov version was re-frozen with reviewer names removed from wording and field names (`carson_*` became `signed_list` / `active_list` / `inactive_list` / `status_class`); figures are unchanged and the frozen pipeline rebuilds it exactly.

## The archived 12 Nov 2026 version (original README below, unchanged)

# STRSearch Business Data Explorer (public, anonymized)

An interactive dashboard showing how STRSearch's **sales (Pipedrive)** and **client acquisition (Jira)** data fit together. It covers the lifecycle, trends, milestone timing, conversion and data quality, and it answers three operating questions about Jira client milestones.

**Live:** https://ifrahamstr.github.io/STRSearchBusinessDataExplorer-Public/

**Using this repo with an AI assistant?** Start with [`LLM_CONTEXT.md`](LLM_CONTEXT.md) (definitions, headline numbers, caveats). For machine-readable results without the 2 MB record file, use [`docs/data/summary.json`](docs/data/summary.json).

## This public build
- **Anonymized.** Jira keys, Pipedrive deal IDs and staff names are replaced with stable pseudonyms (`J0001`, `D0001`, `Rep 0001`, `Assignee 0001`). The "affected records" lists in the data-health checks are removed.
- **No customer data.** No names, emails, phone numbers, addresses, purchase prices or free text.
- **Business figures are real.** Deal counts, win rates, booked deal value and milestone timing are STRSearch's actual numbers as of 2026-11-11.
- Raw workbooks are not in this repository, so `pipeline/` documents the method but cannot be re-run from here.

## What's inside
| Section | Answers |
|---|---|
| Overview | Headline KPIs and lifecycle counts for the filtered slice, plus key takeaways |
| How it works | Systems, the two clocks (sale vs property), the May 27 2026 onboarding-first change, how records link |
| Key questions | Q1 days to Under Contract / CLOSED (mean, median, Kaplan-Meier); Q2 share of Active clients reaching UC / CLOSED plus cohort view; Q3 monthly new clients vs UC events plus same-cohort conversion |
| Sales | STR Search pipeline: volume, win-rate cohorts, open stages, lost reasons, sources, package/payment, value, reps, SDR pipeline moves |
| Acquisition | Jira status map, search aging, onboarding-first funnel, assignee workload |
| Connected | Sankey from deal to sale, Jira client, UC and CLOSED; event timing; outcomes by Pipedrive attribute |
| Data health | Automated checks, reconciliation with the existing FCT report, metric support matrix |
| Explorer | Pseudonymized record tables with search and CSV export |
| Definitions | Status lists (verbatim), status map, metric definitions, open questions |

One filter row scopes every section: period, package, payment, lead source, sales rep and client experience.

## Files
- `docs/`: the static site (open `docs/index.html` directly or serve the folder). ECharts is vendored; no build step.
- `docs/data/explorer-data.js`: one row per deal and per Jira issue, plus definitions, checks and expected metrics.
- `docs/data/summary.json`: everything except the record rows.
- `pipeline/definitions.py`: every business rule (status lists, effective start date, pipeline filter, option-ID labels).
- `pipeline/build.py`, `metrics.py`, `quality.py`: load and normalise, headline metrics, data-quality checks.

The page runs `SX.parity()` in the browser to compare its own numbers with the Python build's. In the console it should return `ok: true`.

Built 2026-11-13 from the 12 Nov 2026 reporting extracts.
