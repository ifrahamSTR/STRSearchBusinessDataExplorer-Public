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
