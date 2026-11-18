# LLM context — STRSearch Business Data Explorer (two reporting versions)

Two versions: **16 Nov 2026** (default, `docs/2026-11-16/`, Supabase reporting layer, data as of 2026-11-16; summary in `docs/2026-11-16/data/summary.json`) and **12 Nov 2026** (archived, `docs/2026-11-12/`, DIM extracts, data as of 2026-11-11). Record keys, deal ids and staff names are pseudonyms; no personal data is published. Figures differ by design between versions; `VERSIONS.md` explains why.

## 16 Nov 2026 definitions
client_start_date = due date for Jira issues created before 1 Jun 2026 (else created + 4 days), Pipedrive won date from 1 Jun 2026; Under Contract = latest valid contract (no first-contract history); CLOSED = closing date up to the data date (later dates are scheduled); durations use won engagements with a confirmed Jira start; client counts use the reporting-layer flags (Active includes closed and post-close clients; hunting = still searching); monthly throughput = daily_client_activity (net change is not a backlog); matured cohorts per client_cohort_performance; HENRY = total_oop <= $225K (recorded mostly at purchase); cash = modeled, not receipts.

## 16 Nov 2026 headline figures
- Pipedrive: 7,662 in-scope deals, 876 won engagements (829 with a Jira match, 825 confirmed starts, 51 Pipedrive-fallback starts).
- Jira: 1,591 issues; 843 signed-up = 648 Active + 195 Inactive; 123 hunting; 347 pre-sale and 401 declined prospects.
- Key question 1 (confirmed starts): median 37.5 days to Under Contract (mean 56.17), 73 to CLOSED (mean 92.82); Kaplan–Meier 76 / 117 days.
- Key question 2 (Jira issues): 464 of 648 Active clients reached UC, 438 CLOSED.
- Reconciliation: 36/36 checks against the export and the SQL reference.

## Added 18 Nov 2026 (16 Nov version): budget performance, cohort builder, depth
Definitions: **onboarding budget** = the onboarding form's "Total out-of-pocket capital available (all-in)" (column M, live since 20 Apr 2026: down payment + closing costs + renovation + furniture + amenities, not the purchase price), the selected range read at its upper end (Carson's rule), matched to confirmed starts by e-mail (form deal id as a fallback), answer given before the UC date. Up to $250K = upper end <= $250K; strict = Below $250K ($150K–$200K) / Range ends at $250K ($200K–$250K) / Above $250K. **HENRY (historical)** = Jira total_oop <= $225K (recorded mostly at purchase). Clients: won deals sharing an e-mail, Jira issue or that issue's client = one client (C####); Jira issues sharing a Pipedrive person id or primary e-mail = one Jira client (JC####). Every window share counts only eligible clients (the whole window has passed). Like-for-like = Mantel–Haenszel risk difference over start month x client experience x start-date rule.
- Budget coverage: 394 of 825 confirmed starts matched; 431 not recorded (416 started before the form).
- UC within 14 days: Up to $250K 13/194 (6.7%), Above $250K 12/191 (6.3%); like-for-like +0.3 pts (95% -4.7 to +5.4, 13 strata). Strict: Below $250K 7/117 (6.0%), Range ends at $250K 6/77 (7.8%).
- Later windows like-for-like (up to minus above): 30 d -4.2, 45 d +1.9, 60 d +5.8, 90 d -0.1 pts, none clear of zero. Closed within 60 / 90 / 120 d: -0.4 / -1.3 / +9.8 pts.
- Refunded within 30 d: Up to $250K 22/178 (12.4%) vs Above 11/176 (6.2%); like-for-like +5.9 pts (95% +0.1 to +11.8, 13 strata); within 60 d +5.9 pts (95% +0.4 to +11.3, 11 strata).
- Recorded days to UC (mean / median): Up to $250K 41.33 / 35, Above 41.09 / 32; UC tomorrow scenario medians 39 / 39.
- Cohort builder (`#cohorts`): entry event (deal created, won, client start, UC), date range, grouping, up to two outcomes with day windows; example: Jul–Sep 2026 starts, UC within 14 days 8/120 up to $250K vs 9/104 above; CLOSED within 90 days 22/60 vs 28/55 (eligible). Deals won within 30 days of creation: 520 of 7,279 eligible; 277 of those later bought a property.
- Cash bridge at the Cash Forecast defaults: $1,360,698.01 service + $896,752.34 affiliate − $461,303.78 refunds = $1,796,146.57.
- Cross-checks against the Executive Report for the same snapshot: 21/21; browser parity 885/885. All figures: `docs/2026-11-16/data/summary.json` (`expected.budget`, `growth`, `cash_bridge`, `definitions.terms`).

## 12 Nov 2026 version (archived). Everything below describes it, unchanged.

# Context for AI assistants

You are looking at an anonymized analytics build for **STRSearch**, a company that helps clients buy short-term-rental (STR) properties. The figures are a snapshot as of **2026-11-11**. Use only the numbers here and in `docs/data/`. Do not invent revenue, cash, CAC or historical events: the data does not contain them.

## The business flow
1. **Sale (Pipedrive, pipeline 3 "STR Search").** A lead books a call, which creates a deal. The deal is won when the client buys a search package: **Complete** (option 203) or **Core** (option 202).
2. **Client acquisition (Jira).** Each client gets a Jira issue that moves through statuses: Client Start → 2/4/6/8 Weeks (searching) → Under Contract (UC) → Passed Inspection → CLOSED → Photography Shared / Listed (post-close).
3. **Link.** The Jira issue stores the Pipedrive deal ID, so the two systems join on it.
4. **Change on 2026-05-27 ("New Client Experience").** From this date, Jira issues open at the onboarding call, *before* the sale. Those pre-sale issues sit in statuses not covered by the status lists below: New Clients, Onboarding Completed, Services Declined.

## Definitions (verbatim business rules)
- **Signed-up statuses:** Client Start, 2 Weeks, 4 Weeks, 6 Weeks, 8 Weeks, Additional Service, under Contract, Under Contract, Passed Inspection, CLOSED, Photography Shared, Listed, Paused, Refunded, Content Pulled.
- **Inactive:** Refunded, Paused, Additional Service.
- **Active** = Signed-up minus Inactive. This includes CLOSED and post-close clients.
- **Effective start date** = `COALESCE(issue_due_date, issue_created_date)`. `issue_due_date` is the onboarding-call date.
- **UC / CLOSED date** = the first date the issue entered that status, from the Jira changelog.
- **Deals in scope** = pipeline 3 after the official reporting filter, which drops deals marked not to keep.

## Headline numbers (as of 2026-11-11)
| Metric | Value |
|---|---|
| Pipedrive deals, pipeline 3, in scope | 7,628 (871 won, 5,723 lost, 1,034 open) |
| Booked value of won deals | $15.70M. This is booked deal value, not revenue or cash. |
| Median days from deal created to won | 21 |
| Jira issues | 1,556: 850 signed-up (644 Active, 206 Inactive), 706 outside the lists (mostly pre-sale) |

### Q1. Days from effective start to milestone (clients who reached it)
| Milestone | n | Mean | Median | P25 | P75 | P90 |
|---|---|---|---|---|---|---|
| Under Contract | 499 | 53.8 | 36 | 20 | 63.5 | 105 |
| Passed Inspection | 353 | 75.9 | 56 | 38 | 85 | 130 |
| CLOSED | 432 | 96.3 | 77 | 59 | 113.5 | 152 |

These describe only clients who got there. Counting clients still searching (Kaplan-Meier, censored at 2026-11-11), the median time for a signed-up client is **77 days to UC** and **127 days to CLOSED**.

### Q2. Share of clients reaching milestones
- **Active clients (644):** 464 reached UC (72%) and 429 reached CLOSED (67%).
- **All signed-up clients (850):** 497 reached UC (58%) and 430 reached CLOSED (51%).
- **Caveat:** "Active" is a current-status snapshot. It already includes closed clients and excludes refunds, so it overstates conversion. Use start-month cohorts with a maturity window for true conversion; the dashboard shows both.

### Q3. Monthly flow, 2026 (new signed-up clients by effective start vs UC and CLOSED events by event month)
| Month | New signed-up | All Jira issues created | UC events | CLOSED events |
|---|---|---|---|---|
| Jan | 31 | 36 | 13 | 13 |
| Feb | 23 | 22 | 13 | 9 |
| Mar | 32 | 35 | 22 | 14 |
| Apr | 28 | 31 | 29 | 22 |
| May | 34 | 42 | 21 | 26 |
| Jun | 65 | 165 | 17 | 25 |
| Jul | 92 | 196 | 44 | 14 |
| Aug | 82 | 264 | 55 | 43 |
| Sep | 76 | 233 | 59 | 44 |
| Oct | 52 | 164 | 58 | 64 |
| Nov (to 11th) | 9 | 36 | 17 | 10 |

This is calendar throughput: a month's UC events come from clients who started in earlier months. The jump in "all issues created" from June onward is the onboarding-first change, not a jump in sales.

## Data caveats that change conclusions
- Since June 2026, no-show bookings move from pipeline 3 to the SDR Setter pipeline (1,387 Calendly-booked deals). This understates recent deal counts and inflates recent win rates.
- 61 closed clients have no first UC date because of changelog truncation. 115 issues have no status history at all.
- Early Jira cohorts (2024 to mid-2025) contain only surviving issues; about 288 early key numbers are missing.
- The ETL's own `days_to_*` fields count from the due date only, not the COALESCE rule.
- Payment Type options 214/215 have no labels in the source. They are shown as "Likely Split Pay" / "Likely Full Pay" (inferred). 486 of 871 won deals have no package recorded.
- There is no stage history (no stage-to-stage conversion), no payment, refund-amount or ad-spend data. Revenue, CAC and channel ROI are therefore **not** derivable.
- Milestone dates are UTC calendar dates (±1 day).

## Files
- `docs/data/summary.json`: definitions, headline metrics (`expected`), the full monthly Q3 table, data-quality checks (`quality`), FCT reconciliation (`recon`) and SDR moves (`extras`).
- `docs/data/explorer-data.js`: the above plus row-level tables in columnar form (`deals`, `jira`: `{columns, date_columns, rows}`). Date columns (listed in `date_columns`) are ISO `YYYY-MM-DD` strings.
- `pipeline/definitions.py`: the business rules in code.
- Pseudonyms: `J####` = Jira issue, `D####` = Pipedrive deal, `Rep ####` / `Assignee ####` = staff.
